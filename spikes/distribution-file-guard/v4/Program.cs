using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Reflection;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class Program
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly List<object> Results = new List<object>();
    static string root, mode; static int failures, notExercised;
    sealed class Missing : Exception { internal Missing(string message) : base(message) {} }
    static void Require(bool valid, string code) { if (!valid) throw new InvalidOperationException(code); }
    static string Dir(string parent, string name) { string result = Path.Combine(parent, name); Directory.CreateDirectory(result); return result; }
    static string Write(string parent, string name, string bytes) { string result = Path.Combine(parent, name); File.WriteAllText(result, bytes); return result; }
    static object Status(int status) { return new { ntstatus = "0x" + ((uint)status).ToString("x8"), win32 = RelativeNative.RtlNtStatusToDosError(status) }; }
    static void Case(string name, Action<string, Dictionary<string, object>> action)
    {
        string directory = Dir(root, Guid.NewGuid().ToString("N")); var details = new Dictionary<string, object>(); string state = "PASS", error = null;
        try { action(directory, details); }
        catch (Missing e) { state = "NOT_EXERCISED"; error = e.Message; notExercised++; }
        catch (Exception e) { state = "FAIL"; error = e.GetType().Name + ":" + e.Message; failures++; }
        Results.Add(new { name = name, status = state, error = error, directory = directory, details = details });
    }
    static int Attempt(Action action)
    { try { action(); return 0; } catch (IOException e) { return e.HResult & 0xffff; } catch (UnauthorizedAccessException e) { return e.HResult & 0xffff; } }
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 3 && args[0] == "--compete")
        {
            string file = args[1], replacement = args[2];
            int write = Attempt(delegate { File.WriteAllText(file, "foreign"); });
            int delete = Attempt(delegate { File.Delete(file); });
            int rename = Attempt(delegate { File.Move(file, file + ".moved"); });
            bool replace = RelativeNative.MoveFileExW(replacement, file, 1); int replaceError = replace ? 0 : System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            Console.WriteLine(Json.Serialize(new { write = write, delete = delete, rename = rename, replace = replaceError })); return 0;
        }
        if (args.Length != 3 || !Environment.Is64BitProcess || Environment.OSVersion.Platform != PlatformID.Win32NT) return 2;
        mode = args[1]; if (mode != "strong" && mode != "metadata") return 2;
        string allowed = Path.GetFullPath("D:/MC_start/OUCL/tmp/file-guard-v4-20261116");
        if (!Path.GetFullPath(args[0]).StartsWith(allowed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 2;
        root = Dir(args[0], "run-" + Guid.NewGuid().ToString("N"));
        Case("relative child open and native rename preserve exact proof", delegate(string directory, Dictionary<string, object> details) {
            string sourceDirectory = Dir(directory, "source"), targetDirectory = Dir(directory, "target"); Write(sourceDirectory, "old.txt", "owned");
            using (var graph = new RelativeNative.Graph(mode))
            {
                var sourceParent = graph.Directory(sourceDirectory); var targetParent = graph.Directory(targetDirectory);
                using (var source = RelativeNative.OpenRelative(sourceParent, "old.txt", false, graph.Access))
                {
                    var proof = RelativeNative.Capture(source, 1); int status = RelativeNative.Name(source, proof, targetParent, "renamed.txt", 10); details["result"] = Status(status);
                    Require(status >= 0, "RENAME_FAILED"); RelativeNative.Verify(source, proof); graph.Verify();
                    details["proof"] = proof; details["target"] = Path.Combine(targetDirectory, "renamed.txt");
                }
            }
            Require(!File.Exists(Path.Combine(sourceDirectory, "old.txt")) && File.ReadAllText(Path.Combine(targetDirectory, "renamed.txt")) == "owned", "RENAME_BYTES_MISMATCH");
        });
        Case("relative no-replace rename preserves an already occupied target", delegate(string directory, Dictionary<string, object> details) {
            string s = Dir(directory, "source"), t = Dir(directory, "target"); Write(s, "old.txt", "owned"); Write(t, "occupied.txt", "foreign");
            using (var graph = new RelativeNative.Graph(mode))
            {
                var sp = graph.Directory(s); var tp = graph.Directory(t);
                using (var source = RelativeNative.OpenRelative(sp, "old.txt", false, graph.Access))
                {
                    var proof = RelativeNative.Capture(source, 1); int status = RelativeNative.Name(source, proof, tp, "occupied.txt", 10); details["result"] = Status(status);
                    Require(status < 0 && RelativeNative.RtlNtStatusToDosError(status) == 183, "OCCUPIED_RENAME_NOT_COLLISION"); RelativeNative.Verify(source, proof);
                }
            }
            Require(File.ReadAllText(Path.Combine(s, "old.txt")) == "owned" && File.ReadAllText(Path.Combine(t, "occupied.txt")) == "foreign", "OVERWROTE_OCCUPIED");
        });
        Case("relative FileLinkInformation creates same inode and does not replace an occupied target", delegate(string directory, Dictionary<string, object> details) {
            string s = Dir(directory, "source"), t = Dir(directory, "target"); Write(s, "old.txt", "owned"); Write(t, "occupied.txt", "foreign");
            using (var graph = new RelativeNative.Graph(mode))
            {
                var sp = graph.Directory(s); var tp = graph.Directory(t);
                using (var source = RelativeNative.OpenRelative(sp, "old.txt", false, graph.Access))
                {
                    var proof = RelativeNative.Capture(source, 1); int occupied = RelativeNative.Name(source, proof, tp, "occupied.txt", 11); details["occupied"] = Status(occupied);
                    Require(occupied < 0 && RelativeNative.RtlNtStatusToDosError(occupied) == 183, "OCCUPIED_LINK_NOT_COLLISION");
                    int status = RelativeNative.Name(source, proof, tp, "linked.txt", 11); details["result"] = Status(status); Require(status >= 0, "LINK_FAILED");
                    var after = RelativeNative.Capture(source, 2); Require(after.links == 2 && after.ino == proof.ino && after.sha256 == proof.sha256, "LINK_PROOF_MISMATCH"); details["proof"] = after; graph.Verify();
                }
            }
            Require(File.ReadAllText(Path.Combine(t, "occupied.txt")) == "foreign" && File.ReadAllText(Path.Combine(t, "linked.txt")) == "owned", "LINK_BYTES_MISMATCH");
        });
        Case("relative source same-handle FileDispositionInformation deletes only its object", delegate(string directory, Dictionary<string, object> details) {
            Write(directory, "old.txt", "owned");
            using (var graph = new RelativeNative.Graph(mode)) using (var source = RelativeNative.OpenRelative(graph.Directory(directory), "old.txt", false, graph.Access))
            { int status = RelativeNative.DisposeExact(source, RelativeNative.Capture(source, 1)); details["result"] = Status(status); Require(status >= 0, "DELETE_FAILED"); }
            Require(!File.Exists(Path.Combine(directory, "old.txt")), "DELETE_NOT_SETTLED"); Write(directory, "old.txt", "after-close");
        });
        Case("source process conflicts and empty parent rename cannot redirect the guarded operation", delegate(string directory, Dictionary<string, object> details) {
            string s = Dir(directory, "source"), t = Dir(directory, "target"), sourcePath = Write(s, "old.txt", "owned"), replacement = Write(s, "replacement.txt", "foreign");
            using (var graph = new RelativeNative.Graph(mode))
            {
                var sp = graph.Directory(s); graph.Directory(t);
                using (var source = RelativeNative.OpenRelative(sp, "old.txt", false, graph.Access))
                {
                    var start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--compete \"" + sourcePath + "\" \"" + replacement + "\"")
                    { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                    using (var process = Process.Start(start))
                    {
                        string output = process.StandardOutput.ReadToEnd(), error = process.StandardError.ReadToEnd(); process.WaitForExit();
                        var conflicts = Json.Deserialize<Dictionary<string, object>>(output); details["sourceConflicts"] = conflicts;
                        Require(process.ExitCode == 0 && error.Length == 0, "COMPETITOR_FAILED");
                        foreach (string key in new string[] { "write", "delete", "rename", "replace" }) Require(Convert.ToInt32(conflicts[key]) != 0, "SOURCE_NOT_BLOCKED");
                    }
                    int parent = Attempt(delegate { Directory.Move(t, t + "-moved"); }); details["emptyParentRename"] = parent;
                    Require(parent != 0, "PARENT_RENAME_NOT_BLOCKED"); graph.Verify(); RelativeNative.Verify(source, RelativeNative.Capture(source, 1));
                }
            }
        });
        Case("preexisting actual junction is refused by relative component open", delegate(string directory, Dictionary<string, object> details) {
            bool rejected = false;
            try { using (var graph = new RelativeNative.Graph(mode)) graph.Directory(args[2]); }
            catch (RelativeNative.NtFailure e) { rejected = true; details["nativeRejection"] = Status(e.Status); }
            catch (InvalidOperationException e) { rejected = e.Message == "REPARSE_OR_TYPE_REJECTED"; details["rejection"] = e.Message; }
            Require(rejected, "PREEXISTING_REPARSE_ACCEPTED");
        });
        Case("in-place FSCTL parent redirection cannot send a relative rename to external", delegate(string directory, Dictionary<string, object> details) {
            string s = Dir(directory, "source"), t = Dir(directory, "empty-target"), external = Dir(directory, "external");
            Write(s, "old.txt", "owned"); Write(external, "sentinel.txt", "preserve");
            using (var graph = new RelativeNative.Graph(mode))
            {
                var sp = graph.Directory(s); var tp = graph.Directory(t);
                using (var source = RelativeNative.OpenRelative(sp, "old.txt", false, graph.Access))
                {
                    var proof = RelativeNative.Capture(source, 1); bool set = false;
                    foreach (uint desired in new uint[] { 0x100, 0x40000000 })
                    {
                        var result = Json.Deserialize<Dictionary<string, object>>(Json.Serialize(RelativeNative.SetJunction(t, external, desired)));
                        details["attack-" + desired] = result; if ((bool)result["set"]) { set = true; break; }
                    }
                    if (!set) throw new Missing("No FSCTL_SET_REPARSE_POINT mutation succeeded with tested competitor rights");
                    details["attributesAfterAttack"] = RelativeNative.Information(tp).Attributes;
                    bool checkedOperationRefused = false; try { graph.Verify(); } catch (InvalidOperationException) { checkedOperationRefused = true; }
                    details["normalGuardRefused"] = checkedOperationRefused;
                    // Diagnostic only: exercise the original target HANDLE even after its name became a junction.
                    // Production would already stop at Verify. No absolute target pathname is passed here.
                    int status = RelativeNative.Name(source, proof, tp, "escaped.txt", 10); details["diagnosticRelativeRename"] = Status(status);
                    if (status >= 0) using (var result = RelativeNative.OpenRelative(tp, "escaped.txt", false, graph.Access, true))
                    {
                        var info = RelativeNative.Information(result); var sourceInfo = RelativeNative.Information(source);
                        Require(info.Volume == sourceInfo.Volume && info.IndexHigh == sourceInfo.IndexHigh && info.IndexLow == sourceInfo.IndexLow, "DIAGNOSTIC_PARENT_ID_MISMATCH");
                        RelativeNative.Verify(source, proof);
                    }
                    Require(!File.Exists(Path.Combine(external, "escaped.txt")) && File.ReadAllText(Path.Combine(external, "sentinel.txt")) == "preserve", "EXTERNAL_ESCAPE");
                    details["externalUnchanged"] = true; Require(checkedOperationRefused, "REPARSE_CHANGE_NOT_DETECTED");
                }
            }
        });
        Console.WriteLine(Json.Serialize(new { mode = mode, root = root, volume = RelativeNative.Volume(Path.GetPathRoot(root)), cases = Results.Count, pass = Results.Count - failures - notExercised, fail = failures, notExercised = notExercised, results = Results }));
        return failures > 0 ? 1 : notExercised > 0 ? 2 : 0;
    }
}
