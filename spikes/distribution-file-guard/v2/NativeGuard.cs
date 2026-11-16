using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

internal static class NativeGuard
{
    const uint Read = 0x80000000, Delete = 0x00010000, ShareRead = 1, ShareWrite = 2;
    const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    [StructLayout(LayoutKind.Sequential)] internal struct Info
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    internal sealed class Proof
    {
        public string Volume, Inode, Sha256;
        public long Size;
        public uint Links;
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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool CreateHardLinkW(string file, string existing, IntPtr security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.I1)]
    internal static extern bool CreateSymbolicLinkW(string link, string target, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool MoveFileExW(string source, string target, uint flags);

    internal static Info Information(SafeFileHandle file)
    {
        Info info; if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception(Marshal.GetLastWin32Error()); return info;
    }
    static string Inode(Info value) { return (((ulong)value.IndexHigh << 32) | value.IndexLow).ToString(); }
    static bool EqualInfo(Info left, Info right)
    {
        return left.Volume == right.Volume && Inode(left) == Inode(right) && left.Attributes == right.Attributes
            && left.SizeHigh == right.SizeHigh && left.SizeLow == right.SizeLow && left.Links == right.Links;
    }
    internal static SafeFileHandle Open(string file, bool directory, uint maximumLinks = 1)
    {
        var handle = CreateFileW(file, directory ? Read : Read | Delete, directory ? ShareRead | ShareWrite : ShareRead,
            IntPtr.Zero, 3, OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid) { int code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
        try
        {
            Info info = Information(handle);
            if (maximumLinks < 1 || maximumLinks > 2 || (info.Attributes & 0x400) != 0 || directory != ((info.Attributes & 0x10) != 0) || !directory && (info.Links < 1 || info.Links > maximumLinks))
                throw new InvalidOperationException("UNSAFE_REPARSE_TYPE_OR_LINKS");
            if (Inode(info) == "0") throw new InvalidOperationException("UNKNOWN_FILE_ID"); return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    internal static Proof Capture(SafeFileHandle file, uint maximumLinks = 1)
    {
        Info before = Information(file); long position;
        if (maximumLinks < 1 || maximumLinks > 2 || (before.Attributes & (0x10 | 0x400)) != 0 || before.Links < 1 || before.Links > maximumLinks) throw new InvalidOperationException("UNSAFE_FILE");
        long size = ((long)before.SizeHigh << 32) | before.SizeLow;
        if (size > 1024L * 1024 * 1024 || !SetFilePointerEx(file, 0, out position, 0)) throw new InvalidOperationException("UNSAFE_SIZE_OR_SEEK");
        using (var hash = SHA256.Create())
        {
            var buffer = new byte[65536]; uint read; long total = 0;
            while (true)
            {
                if (!ReadFile(file, buffer, (uint)buffer.Length, out read, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (read == 0) break; total += read;
                if (total > size) throw new InvalidOperationException("FILE_CHANGED");
                hash.TransformBlock(buffer, 0, (int)read, buffer, 0);
            }
            hash.TransformFinalBlock(new byte[0], 0, 0);
            if (total != size || !EqualInfo(before, Information(file))) throw new InvalidOperationException("FILE_CHANGED");
            return new Proof { Volume = before.Volume.ToString(), Inode = Inode(before), Size = size, Links = before.Links,
                Sha256 = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() };
        }
    }
    internal static void Verify(SafeFileHandle file, Proof expected)
    {
        var actual = Capture(file, expected.Links);
        if (actual.Volume != expected.Volume || actual.Inode != expected.Inode || actual.Size != expected.Size || actual.Sha256 != expected.Sha256 || actual.Links != expected.Links)
            throw new InvalidOperationException("PROOF_MISMATCH");
    }
    internal sealed class Chain : IDisposable
    {
        readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
        readonly List<Info> identities = new List<Info>();
        internal readonly List<string> Paths = new List<string>();
        internal uint Volume;
        internal Chain(string directory)
        {
            string full = Path.GetFullPath(directory), root = Path.GetPathRoot(full);
            if (root.Length != 3 || root[1] != ':' || !Path.IsPathRooted(full)) throw new InvalidOperationException("LOCAL_VOLUME_ONLY");
            try
            {
                Add(root);
                string current = root;
                foreach (string part in full.Substring(root.Length).Split(new char[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (part == "." || part == ".." || part.IndexOf(':') >= 0) throw new InvalidOperationException("UNSAFE_COMPONENT");
                    current = Path.Combine(current, part); Add(current);
                }
                Verify();
            }
            catch { Dispose(); throw; }
        }
        void Add(string path)
        {
            var handle = Open(path, true); Info info = Information(handle);
            if (handles.Count > 0 && info.Volume != Volume) { handle.Dispose(); throw new InvalidOperationException("CROSS_VOLUME"); }
            Volume = info.Volume; handles.Add(handle); identities.Add(info); Paths.Add(path);
        }
        internal void Verify()
        {
            for (int i = 0; i < handles.Count; i++) if (!EqualInfo(identities[i], Information(handles[i]))) throw new InvalidOperationException("DIRECTORY_ID_CHANGED");
        }
        public void Dispose() { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); handles.Clear(); }
    }
    internal static void SameVolume(Chain source, Chain destination)
    {
        source.Verify(); destination.Verify(); if (source.Volume != destination.Volume) throw new InvalidOperationException("CROSS_VOLUME");
    }
    internal static int Rename(SafeFileHandle file, Proof expected, Chain source, Chain destination, string target)
    {
        SameVolume(source, destination); Verify(file, expected);
        string parent = Path.GetFullPath(Path.GetDirectoryName(target));
        if (!String.Equals(parent, destination.Paths[destination.Paths.Count - 1], StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("DESTINATION_OUT_OF_CHAIN");
        byte[] name = Encoding.Unicode.GetBytes(Path.GetFullPath(target)); int rootOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = rootOffset + IntPtr.Size, nameOffset = lengthOffset + 4;
        IntPtr data = Marshal.AllocHGlobal(nameOffset + name.Length + 2);
        try
        {
            for (int i = 0; i < nameOffset + name.Length + 2; i++) Marshal.WriteByte(data, i, 0);
            Marshal.WriteIntPtr(data, rootOffset, IntPtr.Zero); Marshal.WriteInt32(data, lengthOffset, name.Length);
            Marshal.Copy(name, 0, IntPtr.Add(data, nameOffset), name.Length);
            int error = SetFileInformationByHandle(file, 3, data, (uint)(nameOffset + name.Length + 2)) ? 0 : Marshal.GetLastWin32Error();
            Verify(file, expected); source.Verify(); destination.Verify(); return error;
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    internal static int DeleteExact(SafeFileHandle file, Proof expected, Chain source)
    {
        source.Verify(); Verify(file, expected); IntPtr data = Marshal.AllocHGlobal(1);
        try { Marshal.WriteByte(data, 1); return SetFileInformationByHandle(file, 4, data, 1) ? 0 : Marshal.GetLastWin32Error(); }
        finally { Marshal.FreeHGlobal(data); }
    }
    internal static int LinkExact(SafeFileHandle file, Proof expected, Chain source, Chain destination, string sourcePath, string target)
    {
        SameVolume(source, destination); Verify(file, expected);
        if (expected.Links >= 2) throw new InvalidOperationException("LINK_LIMIT");
        if (!String.Equals(Path.GetFullPath(Path.GetDirectoryName(sourcePath)), source.Paths[source.Paths.Count - 1], StringComparison.OrdinalIgnoreCase)
            || !String.Equals(Path.GetFullPath(Path.GetDirectoryName(target)), destination.Paths[destination.Paths.Count - 1], StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("LINK_OUT_OF_CHAIN");
        int error = CreateHardLinkW(target, sourcePath, IntPtr.Zero) ? 0 : Marshal.GetLastWin32Error();
        var after = Capture(file, 2);
        if (after.Volume != expected.Volume || after.Inode != expected.Inode || after.Sha256 != expected.Sha256 || after.Size != expected.Size
            || after.Links != (error == 0 ? 2u : expected.Links)) throw new InvalidOperationException("LINK_PROOF_CHANGED");
        source.Verify(); destination.Verify(); return error;
    }
}
