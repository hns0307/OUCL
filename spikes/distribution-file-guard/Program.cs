using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
using System.Web.Script.Serialization;

// Bounded Windows-only admission spike. This executable has no application IPC or production integration.
internal static class Program
{
    const uint Read = 0x80000000, Delete = 0x00010000, Attributes = 0x80;
    const uint ShareRead = 1, ShareWrite = 2, OpenExisting = 3;
    const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    [StructLayout(LayoutKind.Sequential)]
    struct Info
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info information);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadFile(SafeFileHandle file, byte[] bytes, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, IntPtr information, uint size);

    static SafeFileHandle Open(string file, bool directory)
    {
        var handle = CreateFileW(file, directory ? Attributes : Read | Delete, directory ? ShareRead | ShareWrite : ShareRead,
            IntPtr.Zero, OpenExisting, OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        Info info = Information(handle);
        if ((info.Attributes & 0x400) != 0 || directory != ((info.Attributes & 0x10) != 0) || !directory && info.Links != 1)
        { handle.Dispose(); throw new InvalidOperationException("UNSAFE_FILE"); }
        return handle;
    }
    static Info Information(SafeFileHandle handle)
    {
        Info info; if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error()); return info;
    }
    static string Identity(Info info) { return info.Volume + ":" + info.IndexHigh + ":" + info.IndexLow; }
    static string Hash(SafeFileHandle handle)
    {
        long position; if (!SetFilePointerEx(handle, 0, out position, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        using (var hash = SHA256.Create())
        {
            var chunk = new byte[65536]; uint count;
            while (true)
            {
                if (!ReadFile(handle, chunk, (uint)chunk.Length, out count, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (count == 0) break; hash.TransformBlock(chunk, 0, checked((int)count), chunk, 0);
            }
            hash.TransformFinalBlock(new byte[0], 0, 0); return BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
        }
    }
    static int Rename(SafeFileHandle file, string destination)
    {
        // FILE_RENAME_INFO layout: BOOLEAN/union at0, aligned HANDLE, DWORD name bytes, WCHAR name[].
        // Absolute path + NULL RootDirectory; immediate source/target parents remain held without SHARE_DELETE.
        byte[] name = Encoding.Unicode.GetBytes(destination); int rootOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = rootOffset + IntPtr.Size, nameOffset = lengthOffset + 4;
        IntPtr data = Marshal.AllocHGlobal(nameOffset + name.Length);
        try
        {
            for (int i = 0; i < nameOffset; i++) Marshal.WriteByte(data, i, 0);
            Marshal.WriteIntPtr(data, rootOffset, IntPtr.Zero); Marshal.WriteInt32(data, lengthOffset, name.Length);
            Marshal.Copy(name, 0, IntPtr.Add(data, nameOffset), name.Length);
            return SetFileInformationByHandle(file, 3, data, (uint)(nameOffset + name.Length)) ? 0 : Marshal.GetLastWin32Error();
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    static int MarkDelete(SafeFileHandle file)
    {
        IntPtr data = Marshal.AllocHGlobal(1);
        try { Marshal.WriteByte(data, 1); return SetFileInformationByHandle(file, 4, data, 1) ? 0 : Marshal.GetLastWin32Error(); }
        finally { Marshal.FreeHGlobal(data); }
    }
    static int Denied(Action action)
    {
        try { action(); return 0; }
        catch (IOException e) { return e.HResult & 0xffff; }
        catch (UnauthorizedAccessException e) { return e.HResult & 0xffff; }
    }
    static void Require(bool condition, string reason) { if (!condition) throw new InvalidOperationException(reason); }
    static readonly List<object> Results = new List<object>();
    static int failures;
    static void Case(string name, Action action)
    {
        try { action(); Results.Add(new { name = name, pass = true }); }
        catch (Exception e) { failures++; Results.Add(new { name = name, pass = false, error = e.GetType().Name, message = e.Message }); }
    }
    static int Main(string[] args)
    {
        if (args.Length != 1 || Environment.OSVersion.Platform != PlatformID.Win32NT || !Environment.Is64BitProcess) return 2;
        string parent = Path.GetFullPath(args[0]); Directory.CreateDirectory(parent);
        string root = Path.Combine(parent, "case-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        string sourceParent = Path.Combine(root, "source"), targetParent = Path.Combine(root, "target");
        Directory.CreateDirectory(sourceParent); Directory.CreateDirectory(targetParent);
        Case("source exact handle denies competing write-delete-rename and parent rename", delegate {
            string source = Path.Combine(sourceParent, "guarded.txt"); File.WriteAllText(source, "owned");
            using (var sourceDirectory = Open(sourceParent, true)) using (var targetDirectory = Open(targetParent, true)) using (var held = Open(source, false))
            {
                string identity = Identity(Information(held)), hash = Hash(held);
                int write = Denied(delegate { File.WriteAllText(source, "foreign"); });
                int delete = Denied(delegate { File.Delete(source); });
                int move = Denied(delegate { File.Move(source, Path.Combine(sourceParent, "moved.txt")); });
                int sourceMove = Denied(delegate { Directory.Move(sourceParent, sourceParent + "-moved"); });
                int targetMove = Denied(delegate { Directory.Move(targetParent, targetParent + "-moved"); });
                Require(write != 0 && delete != 0 && move != 0 && sourceMove != 0 && targetMove != 0, "CONFLICT_NOT_BLOCKED");
                Require(identity == Identity(Information(held)) && hash == Hash(held), "HELD_FILE_CHANGED");
                Results.Add(new { detail = "sharing conflict errors", write = write, delete = delete, rename = move, sourceParentRename = sourceMove, targetParentRename = targetMove });
            }
            Require(File.ReadAllText(source) == "owned", "SOURCE_NOT_RETAINED");
        });
        Case("native rename without replace preserves concurrently occupied destination", delegate {
            string source = Path.Combine(sourceParent, "occupied-source.txt"), destination = Path.Combine(targetParent, "occupied.txt");
            File.WriteAllText(source, "owned");
            using (var sourceDirectory = Open(sourceParent, true)) using (var targetDirectory = Open(targetParent, true)) using (var held = Open(source, false))
            {
                string hash = Hash(held), identity = Identity(Information(held));
                // Destination is occupied after all guards and source verification, immediately before the atomic operation.
                File.WriteAllText(destination, "foreign-winner"); int error = Rename(held, destination);
                Require(error == 80 || error == 183, "EXPECTED_FILE_EXISTS_GOT_" + error);
                Require(hash == Hash(held) && identity == Identity(Information(held)), "SOURCE_CHANGED");
                Results.Add(new { detail = "destination conflict", nativeError = error });
            }
            Require(File.ReadAllText(source) == "owned" && File.ReadAllText(destination) == "foreign-winner", "CONFLICT_BYTES_LOST");
        });
        Case("native rename moves the verified inode into a missing destination", delegate {
            string source = Path.Combine(sourceParent, "rename-source.txt"), destination = Path.Combine(targetParent, "renamed.txt");
            File.WriteAllText(source, "rename-owned"); string expectedIdentity, expectedHash;
            using (var sourceDirectory = Open(sourceParent, true)) using (var targetDirectory = Open(targetParent, true)) using (var held = Open(source, false))
            {
                expectedIdentity = Identity(Information(held)); expectedHash = Hash(held);
                int error = Rename(held, destination); Require(error == 0, "RENAME_ERROR_" + error);
                Require(expectedIdentity == Identity(Information(held)) && expectedHash == Hash(held), "RENAMED_HANDLE_CHANGED");
            }
            Require(!File.Exists(source), "OLD_NAME_SURVIVED");
            using (var renamed = Open(destination, false)) Require(expectedIdentity == Identity(Information(renamed)) && expectedHash == Hash(renamed), "DESTINATION_PROOF_MISMATCH");
        });
        Case("native delete disposition removes only the held verified file", delegate {
            string source = Path.Combine(sourceParent, "delete-source.txt"); File.WriteAllText(source, "delete-owned");
            using (var directory = Open(sourceParent, true)) using (var held = Open(source, false))
            {
                string before = Hash(held); int replace = Denied(delegate { File.Delete(source); File.WriteAllText(source, "replacement"); });
                Require(replace != 0 && before == Hash(held), "REPLACEMENT_NOT_BLOCKED");
                int error = MarkDelete(held); Require(error == 0, "DISPOSITION_ERROR_" + error);
            }
            Require(!File.Exists(source), "DISPOSITION_NOT_APPLIED_ON_CLOSE");
            File.WriteAllText(source, "post-close-new-file"); Require(File.ReadAllText(source) == "post-close-new-file", "POST_CLOSE_CREATION_FAILED");
        });
        Console.WriteLine(new JavaScriptSerializer().Serialize(new { platform = "Windows-x64", root = root, cases = 4, failures = failures, results = Results }));
        return failures == 0 ? 0 : 1;
    }
}
