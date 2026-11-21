using System;

static class PackPayload
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) throw new ArgumentException("Usage: PackPayload.exe <directory> <payload.lzms>");
            Payload.Pack(args[0], args[1]);
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
