using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
internal static class BootstrapTests {
    static int checks;
    static object Invoke(string name, params object[] args) { return typeof(Launcher).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args); }
    static void Assert(bool value) { checks++; if (!value) throw new Exception("ASSERTION_FAILED"); }
    static MemoryStream Zip(params string[] names) {
        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true)) foreach (var name in names) using (var writer = new StreamWriter(zip.CreateEntry(name).Open())) writer.Write("test");
        stream.Position = 0; return stream;
    }
    static void Reject(string root, params string[] names) {
        bool refused = false;
        try { using (var stream = Zip(names)) Invoke("Extract", stream, root); }
        catch (TargetInvocationException ex) { refused = ex.InnerException is IOException; }
        Assert(refused);
    }
    [STAThread] static void Main(string[] args) {
        string root = Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
        Assert(Launcher.EnvironmentRoot(Path.Combine(root, "portable", "OUCL.exe")) == Path.Combine(root, "portable", "OUCL.runtime"));
        string originalDirectory = Environment.CurrentDirectory;
        Environment.CurrentDirectory = root;
        Assert(Launcher.EnvironmentRoot(Path.Combine(root, "elsewhere", "OUCL.exe")) == Path.Combine(root, "elsewhere", "OUCL.runtime"));
        Environment.CurrentDirectory = originalDirectory;
        using (var context = new BootstrapContext()) {
            var window = (DownloadWindow)typeof(BootstrapContext).GetField("window", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(context);
            Assert(window.IsHandleCreated && !window.Visible);
        }
        Reject(Path.Combine(root, "traversal"), "../escape"); Reject(Path.Combine(root, "absolute"), "/escape");
        Reject(Path.Combine(root, "drive"), "C:/escape"); Reject(Path.Combine(root, "ads"), "file:stream");
        Reject(Path.Combine(root, "reserved"), "CON.txt"); Reject(Path.Combine(root, "alias"), "file.");
        Reject(Path.Combine(root, "duplicate"), "file", "FILE"); Reject(Path.Combine(root, "backslash"), "a\\b");
        string valid = Path.Combine(root, "valid"); using (var stream = Zip("bin/java.exe")) Invoke("Extract", stream, valid);
        string digest = Launcher.Hash(Path.Combine(valid, "bin/java.exe")); string manifest = digest + "  bin/java.exe\n";
        Assert((bool)Invoke("Verify", valid, manifest));
        File.WriteAllText(Path.Combine(valid, "untrusted.dll"), "extra"); Assert(!(bool)Invoke("Verify", valid, manifest)); File.Delete(Path.Combine(valid, "untrusted.dll"));
        File.WriteAllText(Path.Combine(valid, "bin/java.exe"), "corrupt");
        Assert(!(bool)Invoke("Verify", valid, manifest)); Assert(!File.Exists(Path.Combine(root, "escape")));
        Assert((string)Invoke("Quote", "D:\\space path\\") == "\"D:\\space path\\\\\"");
        Assert((string)Invoke("Quote", "a\"b") == "\"a\\\"b\"");
        string cancelledStaging = Path.Combine(root, ".download-cancel-test");
        Directory.CreateDirectory(cancelledStaging); Launcher.Cancel.Cancel();
        bool cancelled = false;
        try { using (var stream = Zip("runtime/electron.exe")) Invoke("Extract", stream, cancelledStaging); }
        catch (TargetInvocationException ex) { cancelled = ex.InnerException is OperationCanceledException; }
        Assert(cancelled && !File.Exists(Path.Combine(cancelledStaging, "runtime/electron.exe")));
        Invoke("SafeCleanup", root, cancelledStaging); Assert(!Directory.Exists(cancelledStaging));
        Console.WriteLine("PASS " + checks + " bootstrap archive/hash/quoting checks");
    }
}
