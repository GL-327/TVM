// C# 5 format regression tests. Every output stays below the supplied build folder.
using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;

static class PayloadTests
{
    static int checks;
    static string work;
    static readonly Action<int, string> IgnoreProgress = delegate { };

    static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        checks++;
    }

    static void Reject(Action action, string message)
    {
        try { action(); }
        catch (InvalidDataException) { checks++; return; }
        catch (EndOfStreamException) { checks++; return; }
        catch (DecoderFallbackException) { checks++; return; }
        catch (System.ComponentModel.Win32Exception) { checks++; return; }
        throw new Exception("Accepted invalid payload: " + message);
    }

    static void Extract(string path, string name)
    {
        using (Stream stream = File.OpenRead(path)) Payload.Extract(stream, Path.Combine(work, name), IgnoreProgress);
    }

    static string Container(string label, string[] names, long declaredLength, byte[] data, bool extra)
    {
        string path = Path.Combine(work, label + ".lzms");
        using (MemoryStream raw = new MemoryStream())
        {
            using (BinaryWriter writer = new BinaryWriter(raw, Encoding.UTF8, true))
            {
                writer.Write(Encoding.ASCII.GetBytes("TVMFILE1"));
                writer.Write(names.Length);
                foreach (string name in names)
                {
                    byte[] encoded = Encoding.UTF8.GetBytes(name);
                    writer.Write(encoded.Length); writer.Write(encoded);
                    writer.Write(declaredLength); writer.Write(data);
                }
                if (extra) writer.Write((byte)1);
            }
            raw.Position = 0;
            Payload.CompressContainer(raw, path);
        }
        return path;
    }

    static int Main(string[] args)
    {
        try
        {
            work = Path.GetFullPath(args[0]);
            Directory.CreateDirectory(work);
            foreach (string unsafeName in new string[] {
                "../escape", "a/../escape", "a\\..\\escape", "/absolute", "\\absolute", "C:\\absolute", "C:relative",
                "//server/share", "a:stream", "a//b", "./a", "a/./b", "a.", "a ", "CON", "nul.txt", "x/COM1", "a\0b"
            })
                Reject(delegate { Payload.TargetPath(work, unsafeName); }, unsafeName);
            Check(Payload.TargetPath(work, "core/a..b.js").StartsWith(work), "Safe relative name rejected");

            string input = Path.Combine(work, "input");
            Directory.CreateDirectory(Path.Combine(input, "unicode-\u00e9"));
            byte[] bytes = new byte[Payload.BlockSize + 531];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)(i % 251);
            File.WriteAllBytes(Path.Combine(input, "large.bin"), bytes);
            File.WriteAllText(Path.Combine(input, "unicode-\u00e9", "\u96ea.txt"), "TVM \u96ea", new UTF8Encoding(false));
            File.WriteAllBytes(Path.Combine(input, "empty"), new byte[0]);
            string packed = Path.Combine(work, "roundtrip.lzms");
            Payload.Pack(input, packed);
            int lastProgress = 0;
            using (Stream stream = File.OpenRead(packed)) Payload.Extract(stream, Path.Combine(work, "roundtrip"), delegate(int value, string text) {
                if (value < lastProgress || value < 0 || value > 100) throw new Exception("Progress regressed");
                lastProgress = value;
            });
            Check(lastProgress == 100, "Progress did not finish");
            using (SHA256 hash = SHA256.Create())
                Check(Convert.ToBase64String(hash.ComputeHash(bytes)) == Convert.ToBase64String(hash.ComputeHash(File.ReadAllBytes(Path.Combine(work, "roundtrip", "large.bin")))), "Block-spanning file changed");
            Check(File.ReadAllText(Path.Combine(work, "roundtrip", "unicode-\u00e9", "\u96ea.txt")) == "TVM \u96ea", "UTF-8 path changed");
            Check(new FileInfo(Path.Combine(work, "roundtrip", "empty")).Length == 0, "Empty file changed");

            byte[] compressed = File.ReadAllBytes(packed);
            byte[] damaged = (byte[])compressed.Clone(); damaged[24] ^= 1;
            string checksum = Path.Combine(work, "checksum.lzms"); File.WriteAllBytes(checksum, damaged);
            Reject(delegate { Extract(checksum, "bad-checksum"); }, "checksum");
            damaged = (byte[])compressed.Clone(); Buffer.BlockCopy(BitConverter.GetBytes(int.MaxValue), 0, damaged, 16, 4);
            string size = Path.Combine(work, "size.lzms"); File.WriteAllBytes(size, damaged);
            Reject(delegate { Extract(size, "bad-size"); }, "oversized block");
            string truncated = Path.Combine(work, "truncated.lzms");
            using (FileStream stream = File.Create(truncated)) stream.Write(compressed, 0, compressed.Length - 1);
            Reject(delegate { Extract(truncated, "bad-truncated"); }, "truncation");
            string trailing = Path.Combine(work, "trailing.lzms");
            using (FileStream stream = File.Create(trailing)) { stream.Write(compressed, 0, compressed.Length); stream.WriteByte(1); }
            Reject(delegate { Extract(trailing, "bad-trailing"); }, "outer trailing data");

            string unsafePayload = Container("unsafe", new string[] { "../escape" }, 0, new byte[0], false);
            Reject(delegate { Extract(unsafePayload, "bad-path"); }, "archive traversal");
            Check(!File.Exists(Path.Combine(work, "escape")), "Traversal wrote outside extraction directory");
            string duplicate = Container("duplicate", new string[] { "a", "A" }, 0, new byte[0], false);
            Reject(delegate { Extract(duplicate, "bad-duplicate"); }, "case-insensitive duplicate");
            string negative = Container("negative", new string[] { "a" }, -1, new byte[0], false);
            Reject(delegate { Extract(negative, "bad-negative"); }, "negative file length");
            string missing = Container("missing", new string[] { "a" }, 100, new byte[0], false);
            Reject(delegate { Extract(missing, "bad-missing"); }, "missing file data");
            string innerTrailing = Container("inner-trailing", new string[] { "a" }, 0, new byte[0], true);
            Reject(delegate { Extract(innerTrailing, "bad-inner-trailing"); }, "inner trailing data");
            Console.WriteLine("Passed {0} payload checks (including a file crossing the 32 MiB boundary).", checks);
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
