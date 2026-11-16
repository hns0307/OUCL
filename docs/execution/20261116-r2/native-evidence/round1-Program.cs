using System;
using System.IO;
using System.Text;
using System.Reflection;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class Program
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly List<object> Results = new List<object>();
    static int failures, unreachable;
    static string root;
    sealed class Unreachable : Exception { internal Unreachable(string message) : base(message) {} }
    static void Require(bool condition, string reason) { if (!condition) throw new InvalidOperationException(reason); }
    static bool IsConflict(int code) { return code == 32 || code == 5 || code == 33; }
    static string DirectoryAt(string caseRoot, string name) { string result = Path.Combine(caseRoot, name); Directory.CreateDirectory(result); return result; }
    static string Write(string directory, string name, string bytes) { string file = Path.Combine(directory, name); File.WriteAllText(file, bytes); return file; }
    static int Attempt(Action action)
    {
        try { action(); return 0; }
        catch (IOException error) { return error.HResult & 0xffff; }
        catch (UnauthorizedAccessException error) { return error.HResult & 0xffff; }
    }
    static void Case(string name, Action<string, Dictionary<string, object>> action)
    {
        string directory = DirectoryAt(root, "case-" + Guid.NewGuid().ToString("N")); var details = new Dictionary<string, object>();
        string status = "PASS", error = null;
        try { action(directory, details); }
        catch (Unreachable e) { unreachable++; status = "NOT_EXERCISED"; error = e.Message; }
        catch (Exception e) { failures++; status = "FAIL"; error = e.GetType().Name + ": " + e.Message; }
        Results.Add(new { name = name, status = status, error = error, directory = directory, details = details });
    }
    static int Compete(string action, string source, string target)
    {
        int code = Attempt(delegate {
            if (action == "write") File.WriteAllText(source, "foreign-write");
            else if (action == "delete") File.Delete(source);
            else if (action == "rename") File.Move(source, target);
            else if (action == "replace") { if (!NativeGuard.MoveFileExW(target, source, 1)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
            else throw new InvalidOperationException("UNKNOWN_ACTION");
        });
        return code;
    }
    static int Competitor(string action, string source, string target, Dictionary<string, object> details)
    {
        var start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,
            "--compete " + action + " \"" + source + "\" \"" + target + "\"");
        start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        using (var process = Process.Start(start))
        {
            string stdout = process.StandardOutput.ReadToEnd(), stderr = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(5000)) throw new InvalidOperationException("COMPETITOR_TIMEOUT");
            var value = Json.Deserialize<Dictionary<string, object>>(stdout); details[action] = value;
            Require(process.ExitCode == 0 && stderr.Length == 0, "COMPETITOR_FAILED"); return Convert.ToInt32(value["nativeError"]);
        }
    }
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 4 && args[0] == "--compete")
        {
            int code;
            try { code = Compete(args[1], args[2], args[3]); }
            catch (Win32Exception e) { code = e.NativeErrorCode; }
            Console.WriteLine(Json.Serialize(new { action = args[1], nativeError = code })); return 0;
        }
        if (args.Length != 1 || Environment.OSVersion.Platform != PlatformID.Win32NT || !Environment.Is64BitProcess) return 2;
        string allowed = Path.GetFullPath("D:/MC_start/OUCL/tmp/file-guard-r2-20261116");
        string parent = Path.GetFullPath(args[0]);
        if (!parent.StartsWith(allowed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 2;
        root = DirectoryAt(parent, "run-" + Guid.NewGuid().ToString("N"));
        Case("empty target parent and ancestor rename are blocked by GENERIC_READ chains", delegate(string directory, Dictionary<string, object> details) {
            string ancestor = DirectoryAt(directory, "ancestor"), target = DirectoryAt(ancestor, "empty-target");
            using (var chain = new NativeGuard.Chain(target))
            {
                int parentRename = Attempt(delegate { Directory.Move(target, target + "-moved"); });
                int ancestorRename = Attempt(delegate { Directory.Move(ancestor, ancestor + "-moved"); });
                details["parentError"] = parentRename; details["ancestorError"] = ancestorRename; details["heldDirectories"] = chain.Paths;
                Require(IsConflict(parentRename) && IsConflict(ancestorRename), "DIRECTORY_RENAME_NOT_BLOCKED"); chain.Verify();
            }
            Require(Directory.Exists(target) && Directory.Exists(ancestor), "NAMESPACE_CHANGED");
        });
        Case("separate processes cannot write-delete-rename-replace a verified source handle", delegate(string directory, Dictionary<string, object> details) {
            string sourceParent = DirectoryAt(directory, "source"), source = Write(sourceParent, "owned.txt", "owned");
            string replacement = Write(sourceParent, "replacement.txt", "foreign");
            using (var chain = new NativeGuard.Chain(sourceParent)) using (var held = NativeGuard.Open(source, false))
            {
                var proof = NativeGuard.Capture(held); details["proof"] = proof;
                foreach (string action in new string[] { "write", "delete", "rename", "replace" })
                    Require(IsConflict(Competitor(action, source, action == "replace" ? replacement : source + ".moved", details)), "SOURCE_CONFLICT_NOT_BLOCKED_" + action);
                NativeGuard.Verify(held, proof); chain.Verify();
            }
            Require(File.ReadAllText(source) == "owned" && File.ReadAllText(replacement) == "foreign", "COMPETITOR_BYTES_CHANGED");
        });
        Case("destination occupied after verification is preserved by atomic no-replace rename", delegate(string directory, Dictionary<string, object> details) {
            string sourceParent = DirectoryAt(directory, "source"), targetParent = DirectoryAt(directory, "target");
            string source = Write(sourceParent, "owned.txt", "owned"), target = Path.Combine(targetParent, "winner.txt");
            using (var sourceChain = new NativeGuard.Chain(sourceParent)) using (var targetChain = new NativeGuard.Chain(targetParent)) using (var held = NativeGuard.Open(source, false))
            {
                var proof = NativeGuard.Capture(held); File.WriteAllText(target, "foreign-winner");
                int error = NativeGuard.Rename(held, proof, sourceChain, targetChain, target); details["nativeError"] = error;
                Require(error == 80 || error == 183, "EXPECTED_DESTINATION_EXISTS"); NativeGuard.Verify(held, proof);
            }
            Require(File.ReadAllText(source) == "owned" && File.ReadAllText(target) == "foreign-winner", "OCCUPIED_BYTES_LOST");
        });
        Case("normal native rename retains exact inode and same-handle hash", delegate(string directory, Dictionary<string, object> details) {
            string sourceParent = DirectoryAt(directory, "source"), targetParent = DirectoryAt(directory, "target");
            string source = Write(sourceParent, "owned.txt", "rename-owned"), target = Path.Combine(targetParent, "renamed.txt"); NativeGuard.Proof proof;
            using (var sourceChain = new NativeGuard.Chain(sourceParent)) using (var targetChain = new NativeGuard.Chain(targetParent)) using (var held = NativeGuard.Open(source, false))
            {
                proof = NativeGuard.Capture(held); int error = NativeGuard.Rename(held, proof, sourceChain, targetChain, target);
                details["nativeError"] = error; details["proof"] = proof; details["target"] = target; Require(error == 0, "NATIVE_RENAME_FAILED");
            }
            Require(!File.Exists(source), "SOURCE_NAME_RETAINED"); using (var result = NativeGuard.Open(target, false)) NativeGuard.Verify(result, proof);
        });
        Case("normal same-handle disposition deletes the verified object and leaves later creation intact", delegate(string directory, Dictionary<string, object> details) {
            string parentDirectory = DirectoryAt(directory, "source"), source = Write(parentDirectory, "owned.txt", "delete-owned");
            using (var chain = new NativeGuard.Chain(parentDirectory)) using (var held = NativeGuard.Open(source, false))
            {
                var proof = NativeGuard.Capture(held); int error = NativeGuard.DeleteExact(held, proof, chain); details["nativeError"] = error; Require(error == 0, "NATIVE_DELETE_FAILED");
            }
            Require(!File.Exists(source), "DELETE_NOT_SETTLED"); File.WriteAllText(source, "new-after-close"); Require(File.ReadAllText(source) == "new-after-close", "NEW_FILE_LOST");
        });
        Case("pre-open replacement fails expected proof and preserves the new file", delegate(string directory, Dictionary<string, object> details) {
            string parentDirectory = DirectoryAt(directory, "source"), source = Write(parentDirectory, "owned.txt", "old"), replacement = Write(parentDirectory, "replacement.txt", "foreign");
            NativeGuard.Proof expected; using (var before = NativeGuard.Open(source, false)) expected = NativeGuard.Capture(before);
            File.Delete(source); File.Move(replacement, source); bool rejected = false;
            using (var chain = new NativeGuard.Chain(parentDirectory)) using (var held = NativeGuard.Open(source, false))
            {
                try { NativeGuard.DeleteExact(held, expected, chain); } catch (InvalidOperationException e) { rejected = e.Message == "PROOF_MISMATCH"; }
                details["oldProof"] = expected; details["actualProof"] = NativeGuard.Capture(held);
            }
            Require(rejected && File.ReadAllText(source) == "foreign", "REPLACEMENT_NOT_PRESERVED");
        });
        Case("hard-linked source is refused before mutation", delegate(string directory, Dictionary<string, object> details) {
            string source = Write(directory, "owned.txt", "owned"), alias = Path.Combine(directory, "alias.txt");
            if (!NativeGuard.CreateHardLinkW(alias, source, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error()); bool rejected = false;
            try { using (var held = NativeGuard.Open(source, false)) {} } catch (InvalidOperationException e) { rejected = e.Message == "UNSAFE_REPARSE_TYPE_OR_LINKS"; }
            Require(rejected && File.ReadAllText(source) == "owned" && File.ReadAllText(alias) == "owned", "HARDLINK_NOT_REJECTED");
        });
        Case("exclusive hardlink publish preserves occupied target and then links the protected source inode", delegate(string directory, Dictionary<string, object> details) {
            string sourceParent = DirectoryAt(directory, "source"), targetParent = DirectoryAt(directory, "target");
            string source = Write(sourceParent, "owned.txt", "link-owned"), occupied = Write(targetParent, "occupied.txt", "foreign"), target = Path.Combine(targetParent, "published.txt");
            using (var sourceChain = new NativeGuard.Chain(sourceParent)) using (var targetChain = new NativeGuard.Chain(targetParent)) using (var held = NativeGuard.Open(source, false))
            {
                var proof = NativeGuard.Capture(held); int occupiedError = NativeGuard.LinkExact(held, proof, sourceChain, targetChain, source, occupied);
                details["occupiedError"] = occupiedError; Require(occupiedError == 80 || occupiedError == 183, "LINK_OCCUPIED_NOT_REJECTED");
                int error = NativeGuard.LinkExact(held, proof, sourceChain, targetChain, source, target); details["publishError"] = error; Require(error == 0, "LINK_PUBLISH_FAILED");
                var linked = NativeGuard.Capture(held, 2); details["linkedProof"] = linked;
                Require(linked.Links == 2 && linked.Inode == proof.Inode && linked.Sha256 == proof.Sha256, "LINKED_INODE_MISMATCH");
            }
            Require(File.ReadAllText(occupied) == "foreign" && File.ReadAllText(target) == "link-owned", "LINK_BYTES_CHANGED");
            using (var published = NativeGuard.Open(target, false, 2)) details["publishedProof"] = NativeGuard.Capture(published, 2);
        });
        Case("unknown three-link source is refused even with the private two-link limit", delegate(string directory, Dictionary<string, object> details) {
            string source = Write(directory, "owned.txt", "owned");
            if (!NativeGuard.CreateHardLinkW(Path.Combine(directory, "alias-one.txt"), source, IntPtr.Zero)
                || !NativeGuard.CreateHardLinkW(Path.Combine(directory, "alias-two.txt"), source, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            bool rejected = false; try { using (var held = NativeGuard.Open(source, false, 2)) {} }
            catch (InvalidOperationException e) { rejected = e.Message == "UNSAFE_REPARSE_TYPE_OR_LINKS"; }
            Require(rejected, "UNKNOWN_LINKS_NOT_REJECTED");
        });
        Case("reparse directory ancestor and reparse source are refused", delegate(string directory, Dictionary<string, object> details) {
            string external = DirectoryAt(directory, "external"), link = Path.Combine(directory, "alias");
            string source = Write(external, "sentinel.txt", "preserve");
            if (!NativeGuard.CreateSymbolicLinkW(link, external, 1 | 2)) throw new Unreachable("directory symlink creation error=" + Marshal.GetLastWin32Error());
            bool ancestorRejected = false; try { using (var chain = new NativeGuard.Chain(link)) {} } catch (InvalidOperationException e) { ancestorRejected = e.Message == "UNSAFE_REPARSE_TYPE_OR_LINKS"; }
            string fileLink = Path.Combine(directory, "file-alias.txt");
            if (!NativeGuard.CreateSymbolicLinkW(fileLink, source, 2)) throw new Unreachable("file symlink creation error=" + Marshal.GetLastWin32Error());
            bool fileRejected = false; try { using (var held = NativeGuard.Open(fileLink, false)) {} } catch (InvalidOperationException e) { fileRejected = e.Message == "UNSAFE_REPARSE_TYPE_OR_LINKS"; }
            Require(ancestorRejected && fileRejected && File.ReadAllText(source) == "preserve", "REPARSE_NOT_REJECTED");
        });
        Case("real distinct volume is refused by guard before any cross-volume mutation", delegate(string directory, Dictionary<string, object> details) {
            using (var sourceChain = new NativeGuard.Chain(directory)) using (var otherChain = new NativeGuard.Chain("C:\\"))
            {
                details["sourceVolume"] = sourceChain.Volume; details["otherVolume"] = otherChain.Volume;
                if (sourceChain.Volume == otherChain.Volume) throw new Unreachable("C and D expose the same volume identifier");
                bool rejected = false; try { NativeGuard.SameVolume(sourceChain, otherChain); } catch (InvalidOperationException e) { rejected = e.Message == "CROSS_VOLUME"; }
                Require(rejected, "CROSS_VOLUME_NOT_REJECTED"); details["mutationAttempted"] = false;
            }
        });
        Console.WriteLine(Json.Serialize(new { platform = "Windows-x64", root = root, cases = Results.Count, pass = Results.Count - failures - unreachable, fail = failures,
            notExercised = unreachable, admission = failures == 0 && unreachable == 0 ? "BOUNDED_SPIKE_PASS" : "NOT_READY", results = Results }));
        return failures > 0 ? 1 : unreachable > 0 ? 2 : 0;
    }
}
