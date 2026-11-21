// Shared by the C# 5 build helper and installer. Windows 8+ cabinet.dll, LZMS
// buffer mode (algorithm 5, without COMPRESS_RAW):
// https://learn.microsoft.com/windows/win32/cmpapi/using-the-compression-api-in-buffer-mode
//
// All integers are little endian. Outer stream: ASCII "TVMLZMS1", Int64 raw
// container length, then blocks: Int32 raw length, Int32 compressed length,
// SHA-256 of raw bytes (32 bytes), compressed bytes. Blocks are at most 32 MiB;
// compression is solid across file boundaries within each block. No terminator:
// the raw lengths must add up exactly, and trailing bytes are rejected.
// Inner container: ASCII "TVMFILE1", Int32 file count, then each file's Int32
// UTF-8 path byte length, path bytes, Int64 file length, and file bytes.
// Only files are stored. Empty directories are unnecessary for this package.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

static class Payload
{
    internal const int BlockSize = 32 * 1024 * 1024;
    const long MaxContainerSize = 16L * 1024 * 1024 * 1024;
    static readonly byte[] OuterMagic = Encoding.ASCII.GetBytes("TVMLZMS1");
    static readonly byte[] InnerMagic = Encoding.ASCII.GetBytes("TVMFILE1");
    static readonly Encoding Utf8 = new UTF8Encoding(false, true);

    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool CreateCompressor(uint algorithm, IntPtr allocator, out IntPtr handle);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool Compress(IntPtr handle, byte[] input, UIntPtr inputSize,
        byte[] output, UIntPtr outputSize, out UIntPtr written);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool CloseCompressor(IntPtr handle);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool SetCompressorInformation(IntPtr handle, int informationClass, ref uint value, UIntPtr size);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool CreateDecompressor(uint algorithm, IntPtr allocator, out IntPtr handle);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool Decompress(IntPtr handle, byte[] input, UIntPtr inputSize,
        byte[] output, UIntPtr outputSize, out UIntPtr written);
    [DllImport("cabinet.dll", SetLastError = true)]
    static extern bool CloseDecompressor(IntPtr handle);

    static Exception NativeError(string action)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), "LZMS " + action + " failed");
    }

    internal static string TargetPath(string root, string name)
    {
        // Reject both slash styles, drive-relative paths, ADS, traversal, and
        // Windows aliases (trailing spaces/dots and device filenames).
        if (string.IsNullOrEmpty(name) || name.IndexOfAny(Path.GetInvalidPathChars()) >= 0 ||
            Path.IsPathRooted(name) || name.IndexOf(':') >= 0)
            throw new InvalidDataException("Unsafe payload path: " + name);
        string[] parts = name.Replace('\\', '/').Split('/');
        foreach (string part in parts)
        {
            if (part.Length == 0 || part == "." || part == ".." || part.TrimEnd(' ', '.') != part ||
                part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new InvalidDataException("Unsafe payload path: " + name);
            string stem = part.Split('.')[0].ToUpperInvariant();
            if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
                (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) &&
                 stem[3] >= '0' && stem[3] <= '9'))
                throw new InvalidDataException("Unsafe payload path: " + name);
        }
        string prefix = Path.GetFullPath(root).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        string target = Path.GetFullPath(Path.Combine(prefix, string.Join("\\", parts)));
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Unsafe payload path: " + name);
        return target;
    }

    internal static byte[] ReadExactly(Stream stream, int count)
    {
        byte[] data = new byte[count];
        ReadExactly(stream, data, count);
        return data;
    }

    static void ReadExactly(Stream stream, byte[] data, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(data, offset, count - offset);
            if (read == 0) throw new EndOfStreamException("The TVM payload is truncated.");
            offset += read;
        }
    }

    static void Magic(Stream stream, byte[] expected)
    {
        byte[] actual = ReadExactly(stream, expected.Length);
        if (!Equal(actual, expected)) throw new InvalidDataException("Unknown TVM payload format.");
    }

    static bool Equal(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    internal static void Pack(string directory, string output)
    {
        string root = Path.GetFullPath(directory).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        string[] files = Directory.GetFiles(root, "*", SearchOption.AllDirectories);
        Array.Sort(files, StringComparer.Ordinal);
        // A disk-backed intermediate keeps managed memory independent of package size.
        string rawPath = output + ".raw";
        try
        {
            using (FileStream raw = new FileStream(rawPath, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            {
                using (BinaryWriter writer = new BinaryWriter(raw, Utf8, true))
                {
                    writer.Write(InnerMagic);
                    writer.Write(files.Length);
                    foreach (string file in files)
                    {
                        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                            throw new InvalidDataException("Payload files must not be links.");
                        string name = file.Substring(root.Length).Replace('\\', '/');
                        TargetPath(root, name);
                        byte[] path = Utf8.GetBytes(name);
                        writer.Write(path.Length);
                        writer.Write(path);
                        using (FileStream input = File.OpenRead(file))
                        {
                            writer.Write(input.Length);
                            writer.Flush();
                            input.CopyTo(raw);
                        }
                    }
                }
                raw.Position = 0;
                CompressContainer(raw, output);
            }
        }
        finally { if (File.Exists(rawPath)) File.Delete(rawPath); }
    }

    // Also used by the format tests to create intentionally malformed containers.
    internal static void CompressContainer(Stream raw, string output)
    {
        if (raw.Length < 12 || raw.Length > MaxContainerSize)
            throw new InvalidDataException("Invalid TVM container size.");
        IntPtr compressor;
        if (!CreateCompressor(5, IntPtr.Zero, out compressor)) throw NativeError("initialization");
        try
        {
            // Buffer mode otherwise uses a smaller internal dictionary. Match
            // it to our bounded outer blocks so compression is solid over 32 MiB.
            uint blockSize = BlockSize;
            if (!SetCompressorInformation(compressor, 1, ref blockSize, (UIntPtr)4)) throw NativeError("block size configuration");
            using (BinaryWriter writer = new BinaryWriter(File.Create(output)))
            using (SHA256 hash = SHA256.Create())
            {
                writer.Write(OuterMagic);
                writer.Write(raw.Length);
                byte[] buffer = new byte[BlockSize];
                while (raw.Position < raw.Length)
                {
                    int count = (int)Math.Min(BlockSize, raw.Length - raw.Position);
                    ReadExactly(raw, buffer, count);
                    UIntPtr needed;
                    bool success = Compress(compressor, buffer, (UIntPtr)count, null, UIntPtr.Zero, out needed);
                    if (success || Marshal.GetLastWin32Error() != 122) throw NativeError("size query");
                    if (needed.ToUInt64() == 0 || needed.ToUInt64() > 2UL * BlockSize)
                        throw new InvalidDataException("Invalid LZMS compressed size.");
                    byte[] compressed = new byte[(int)needed.ToUInt64()];
                    UIntPtr written;
                    if (!Compress(compressor, buffer, (UIntPtr)count, compressed, needed, out written))
                        throw NativeError("compression");
                    writer.Write(count);
                    writer.Write(checked((int)written.ToUInt64()));
                    writer.Write(hash.ComputeHash(buffer, 0, count));
                    writer.Write(compressed, 0, (int)written.ToUInt64());
                    Console.WriteLine("Compressed {0:N1} / {1:N1} MiB", raw.Position / 1048576.0, raw.Length / 1048576.0);
                }
            }
        }
        finally { CloseCompressor(compressor); }
    }

    internal static void Extract(Stream source, string directory, Action<int, string> progress)
    {
        Directory.CreateDirectory(directory);
        using (BlockStream raw = new BlockStream(source, progress))
        using (BinaryReader reader = new BinaryReader(raw, Utf8, true))
        {
            Magic(raw, InnerMagic);
            int count = reader.ReadInt32();
            if (count < 1 || count > 100000) throw new InvalidDataException("Invalid payload file count.");
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            byte[] buffer = new byte[81920];
            for (int i = 0; i < count; i++)
            {
                int pathLength = reader.ReadInt32();
                if (pathLength < 1 || pathLength > 32768) throw new InvalidDataException("Invalid payload path length.");
                string name = Utf8.GetString(ReadExactly(raw, pathLength));
                string target = TargetPath(directory, name);
                if (!names.Add(target)) throw new InvalidDataException("Duplicate payload path: " + name);
                long length = reader.ReadInt64();
                if (length < 0 || length > raw.Length - raw.Position)
                    throw new InvalidDataException("Invalid payload file length.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    while (length > 0)
                    {
                        int read = raw.Read(buffer, 0, (int)Math.Min(buffer.Length, length));
                        if (read == 0) throw new EndOfStreamException("The TVM payload is truncated.");
                        output.Write(buffer, 0, read);
                        length -= read;
                        progress((int)(raw.Position * 100 / raw.Length), "Unpacking " + (i + 1) + " of " + count + " files");
                    }
                    output.Flush(true);
                }
            }
            if (raw.ReadByte() != -1 || source.ReadByte() != -1)
                throw new InvalidDataException("Unexpected data after TVM payload.");
            progress(100, "Unpacked " + count + " files");
        }
    }

    sealed class BlockStream : Stream
    {
        readonly BinaryReader reader;
        readonly Action<int, string> progress;
        readonly long length;
        IntPtr decompressor;
        byte[] block = new byte[0];
        int offset;
        long position;

        internal BlockStream(Stream source, Action<int, string> report)
        {
            Magic(source, OuterMagic);
            reader = new BinaryReader(source, Utf8, true);
            length = reader.ReadInt64();
            if (length < 12 || length > MaxContainerSize) throw new InvalidDataException("Invalid payload size.");
            progress = report;
            if (!CreateDecompressor(5, IntPtr.Zero, out decompressor)) throw NativeError("initialization");
        }

        public override int Read(byte[] buffer, int start, int count)
        {
            if (count == 0 || position == length) return 0;
            if (offset == block.Length)
            {
                int rawLength = reader.ReadInt32();
                int compressedLength = reader.ReadInt32();
                if (rawLength < 1 || rawLength > BlockSize || rawLength > length - position ||
                    compressedLength < 1 || compressedLength > 2 * BlockSize)
                    throw new InvalidDataException("Invalid payload block size.");
                byte[] expectedHash = ReadExactly(reader.BaseStream, 32);
                byte[] compressed = ReadExactly(reader.BaseStream, compressedLength);
                progress((int)(position * 100 / length), "Decompressing TVM");
                block = new byte[rawLength];
                UIntPtr written;
                if (!Decompress(decompressor, compressed, (UIntPtr)compressedLength,
                    block, (UIntPtr)rawLength, out written)) throw NativeError("decompression");
                if (written.ToUInt64() != (ulong)rawLength) throw new InvalidDataException("Incorrect payload block length.");
                using (SHA256 hash = SHA256.Create())
                    if (!Equal(expectedHash, hash.ComputeHash(block))) throw new InvalidDataException("TVM payload checksum mismatch.");
                offset = 0;
            }
            int copied = Math.Min(count, block.Length - offset);
            Buffer.BlockCopy(block, offset, buffer, start, copied);
            offset += copied;
            position += copied;
            return copied;
        }

        protected override void Dispose(bool disposing)
        {
            if (decompressor != IntPtr.Zero) { CloseDecompressor(decompressor); decompressor = IntPtr.Zero; }
            if (disposing) reader.Dispose();
            base.Dispose(disposing);
        }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }
        public override long Position { get { return position; } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override long Seek(long value, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] value, int start, int count) { throw new NotSupportedException(); }
    }
}
