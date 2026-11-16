using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Independent one-case probe; compiled against unchanged round2 NativeGuard.cs.
internal static class JunctionProbe
{
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        string allowed = Path.GetFullPath("D:/MC_start/OUCL/tmp/file-guard-r2-20261116");
        if (args.Length != 1 || !Path.GetFullPath(args[0]).StartsWith(allowed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 2;
        bool rejected = false; string error = null;
        int attributes = (int)File.GetAttributes(args[0]);
        try { using (var chain = new NativeGuard.Chain(args[0])) {} }
        catch (InvalidOperationException e) { error = e.Message; rejected = error == "UNSAFE_REPARSE_TYPE_OR_LINKS"; }
        catch (Exception e) { error = e.GetType().Name + ": " + e.Message; }
        bool pass = rejected && (attributes & 0x400) != 0;
        Console.WriteLine(new JavaScriptSerializer().Serialize(new { probe = "independent-junction-reparse-rejection", pass = pass, rejected = rejected, attributes = attributes, error = error }));
        return pass ? 0 : 1;
    }
}
