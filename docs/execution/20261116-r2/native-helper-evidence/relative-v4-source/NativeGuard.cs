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
    internal const uint Read = 0x80000000, Delete = 0x10000, Sync = 0x100000;
    [StructLayout(LayoutKind.Sequential)] internal struct Info
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] struct Unicode { internal ushort Length, MaximumLength; internal IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes
    {
        internal uint Length; internal IntPtr RootDirectory, ObjectName; internal uint Flags;
        internal IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoStatus { internal IntPtr Status; internal UIntPtr Information; }
    internal sealed class Proof { public string Volume, Inode, Sha256; public long Size; public uint Links; }
    internal sealed class VolumeProfile { public string root, fileSystem; public uint driveType, serial; }
    internal sealed class NtFailure : Win32Exception
    {
        internal readonly int Status; internal readonly uint Win32;
        internal NtFailure(int status) : base((int)RtlNtStatusToDosError(status))
        { Status = status; Win32 = RtlNtStatusToDosError(status); }
    }
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out IntPtr handle, uint desired, ref Attributes attributes, out IoStatus io,
        IntPtr allocation, uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle handle, out IoStatus io, IntPtr data, uint size, int kind);
    [DllImport("ntdll.dll")] internal static extern uint RtlNtStatusToDosError(int status);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafeFileHandle CreateFileW(string name, uint desired, uint share, IntPtr security, uint disposition, uint options, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle handle, byte[] bytes, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetFilePointerEx(SafeFileHandle handle, long distance, out long position, uint method);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetVolumeInformationW(string root, StringBuilder label, uint labelLength, out uint serial, out uint maximumComponent, out uint flags, StringBuilder fileSystem, uint fileSystemLength);
    internal static VolumeProfile Volume(string root)
    {
        uint serial, component, flags; var fileSystem = new StringBuilder(64); uint kind = GetDriveTypeW(root);
        if (!GetVolumeInformationW(root, null, 0, out serial, out component, out flags, fileSystem, 64)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (kind != 3 || fileSystem.ToString() != "NTFS") throw new InvalidOperationException("FIXED_NTFS_ONLY");
        return new VolumeProfile { root = root, driveType = kind, serial = serial, fileSystem = fileSystem.ToString() };
    }

    internal static void Leaf(string leaf)
    {
        if (String.IsNullOrEmpty(leaf) || leaf == "." || leaf == ".." || leaf.IndexOfAny(new char[] { '\\', '/', ':', '\0' }) >= 0 || leaf.Length > 200)
            throw new InvalidOperationException("SINGLE_COMPONENT_REQUIRED");
    }
    internal static Info Information(SafeFileHandle file)
    { Info info; if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception(Marshal.GetLastWin32Error()); return info; }
    static string Inode(Info info) { return (((ulong)info.IndexHigh << 32) | info.IndexLow).ToString(); }
    internal static SafeFileHandle OpenRelative(SafeFileHandle parent, string leaf, bool directory, uint directoryAccess, bool metadataFile = false, uint share = 1, bool leaseReadOnly = false)
    {
        Leaf(leaf); IntPtr name = Marshal.StringToHGlobalUni(leaf), unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
        try
        {
            var text = new Unicode { Length = (ushort)(leaf.Length * 2), MaximumLength = (ushort)(leaf.Length * 2 + 2), Buffer = name };
            Marshal.StructureToPtr(text, unicode, false);
            var attributes = new Attributes { Length = (uint)Marshal.SizeOf(typeof(Attributes)), RootDirectory = parent.DangerousGetHandle(), ObjectName = unicode, Flags = 0x40 | 0x1000 };
            IoStatus io; IntPtr result;
            int status = NtCreateFile(out result, directory ? directoryAccess : metadataFile ? 0x80u | Sync : Read | (leaseReadOnly ? 0u : Delete) | Sync, ref attributes, out io, IntPtr.Zero, 0, metadataFile ? 7u : share, 1,
                0x200000 | 0x20u | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
            if (status < 0) throw new NtFailure(status);
            var handle = new SafeFileHandle(result, true);
            try { Info info = Information(handle); CheckType(info, directory); return handle; } catch { handle.Dispose(); throw; }
        }
        finally { Marshal.FreeHGlobal(unicode); Marshal.FreeHGlobal(name); }
    }
    static void CheckType(Info info, bool directory)
    {
        if ((info.Attributes & 0x400) != 0 || directory != ((info.Attributes & 0x10) != 0) || Inode(info) == "0") throw new InvalidOperationException("REPARSE_OR_TYPE_REJECTED");
    }
    internal sealed class Graph : IDisposable
    {
        readonly Dictionary<string, SafeFileHandle> handles = new Dictionary<string, SafeFileHandle>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, SafeFileHandle> guards = new Dictionary<string, SafeFileHandle>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, Info> identities = new Dictionary<string, Info>(StringComparer.OrdinalIgnoreCase);
        readonly List<string> order = new List<string>();
        internal readonly uint Access;
        readonly bool separateGuard;
        internal Graph() { separateGuard = true; Access = 0x20u | 0x80u | Sync; }
        internal SafeFileHandle Directory(string directory)
        {
            string full = Path.GetFullPath(directory), root = Path.GetPathRoot(full);
            if (root.Length != 3 || root[1] != ':') throw new InvalidOperationException("LOCAL_VOLUME_REQUIRED");
            SafeFileHandle handle;
            if (!handles.TryGetValue(root, out handle))
            {
                VolumeProfile volume = Volume(root);
                SafeFileHandle guard = null;
                if (separateGuard)
                {
                    guard = CreateFileW(root, Read | Sync, 3, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
                    if (guard.IsInvalid) { guard.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
                }
                handle = CreateFileW(root, Access, separateGuard ? 3u : 1u, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
                if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); if (guard != null) guard.Dispose(); throw new Win32Exception(error); }
                if (Information(handle).Volume != volume.serial) { handle.Dispose(); if (guard != null) guard.Dispose(); throw new InvalidOperationException("VOLUME_CHANGED"); } Add(root, handle, guard);
            }
            string current = root;
            foreach (string part in full.Substring(root.Length).Split(new char[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string next = Path.Combine(current, part); SafeFileHandle child;
                if (!handles.TryGetValue(next, out child))
                {
                    SafeFileHandle guard = null;
                    if (separateGuard) guard = OpenRelative(handle, part, true, Read | Sync, false, 3);
                    try { child = OpenRelative(handle, part, true, Access, false, separateGuard ? 3u : 1u); } catch { if (guard != null) guard.Dispose(); throw; }
                    Add(next, child, guard);
                }
                handle = child; current = next;
            }
            return handle;
        }
        void Add(string name, SafeFileHandle handle, SafeFileHandle guard)
        {
            try
            {
                Info info = Information(handle); CheckType(info, true);
                if (guard != null)
                {
                    Info protectedInfo = Information(guard); CheckType(protectedInfo, true);
                    if (info.Volume != protectedInfo.Volume || Inode(info) != Inode(protectedInfo)) throw new InvalidOperationException("ANCHOR_GUARD_MISMATCH");
                }
                if (order.Count > 0 && info.Volume != identities[order[0]].Volume) throw new InvalidOperationException("CROSS_VOLUME");
                handles.Add(name, handle); identities.Add(name, info); order.Add(name);
                if (guard != null) guards.Add(name, guard);
            }
            catch { handle.Dispose(); if (guard != null) guard.Dispose(); throw; }
        }
        internal void Verify()
        {
            foreach (string path in order)
            {
                Info before = identities[path], after = Information(handles[path]);
                if (before.Volume != after.Volume || Inode(before) != Inode(after) || (after.Attributes & 0x400) != 0) throw new InvalidOperationException("DIRECTORY_CHANGED");
                SafeFileHandle guard;
                if (guards.TryGetValue(path, out guard))
                {
                    Info protectedInfo = Information(guard);
                    if (before.Volume != protectedInfo.Volume || Inode(before) != Inode(protectedInfo) || (protectedInfo.Attributes & 0x400) != 0) throw new InvalidOperationException("GUARDED_DIRECTORY_CHANGED");
                }
            }
        }
        public void Dispose()
        {
            for (int i = order.Count - 1; i >= 0; i--) { handles[order[i]].Dispose(); SafeFileHandle guard; if (guards.TryGetValue(order[i], out guard)) guard.Dispose(); }
            handles.Clear(); guards.Clear(); order.Clear();
        }
    }
    internal static Proof Capture(SafeFileHandle file, uint maximumLinks = 1)
    {
        Info before = Information(file); CheckType(before, false);
        if (maximumLinks < 1 || maximumLinks > 2 || before.Links < 1 || before.Links > maximumLinks) throw new InvalidOperationException("LINK_LIMIT");
        long size = ((long)before.SizeHigh << 32) | before.SizeLow, position;
        if (size > 1024L * 1024 * 1024 || !SetFilePointerEx(file, 0, out position, 0)) throw new InvalidOperationException("SIZE_OR_SEEK");
        using (var hash = SHA256.Create())
        {
            byte[] bytes = new byte[65536]; long total = 0; uint read;
            while (true)
            {
                if (!ReadFile(file, bytes, (uint)bytes.Length, out read, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (read == 0) break; total += read; if (total > size) throw new InvalidOperationException("FILE_CHANGED"); hash.TransformBlock(bytes, 0, (int)read, bytes, 0);
            }
            hash.TransformFinalBlock(new byte[0], 0, 0); Info after = Information(file);
            if (size != total || before.Volume != after.Volume || Inode(before) != Inode(after) || before.Links != after.Links || before.SizeHigh != after.SizeHigh || before.SizeLow != after.SizeLow)
                throw new InvalidOperationException("FILE_CHANGED");
            return new Proof { Volume = before.Volume.ToString(), Inode = Inode(before), Size = size, Links = before.Links, Sha256 = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() };
        }
    }
    internal static void Verify(SafeFileHandle file, Proof expected)
    {
        Proof actual = Capture(file, expected.Links);
        if (actual.Volume != expected.Volume || actual.Inode != expected.Inode || actual.Sha256 != expected.Sha256 || actual.Size != expected.Size || actual.Links != expected.Links)
            throw new InvalidOperationException("PROOF_MISMATCH");
    }
    internal static int Name(SafeFileHandle source, Proof expected, SafeFileHandle targetParent, string leaf, int kind)
    {
        Leaf(leaf); Verify(source, expected);
        if (Information(source).Volume != Information(targetParent).Volume) throw new InvalidOperationException("CROSS_VOLUME");
        byte[] name = Encoding.Unicode.GetBytes(leaf); int offset = 20, length = Math.Max(24, offset + name.Length + 2);
        IntPtr data = Marshal.AllocHGlobal(length);
        try
        {
            for (int i = 0; i < length; i++) Marshal.WriteByte(data, i, 0);
            Marshal.WriteIntPtr(data, 8, targetParent.DangerousGetHandle()); Marshal.WriteInt32(data, 16, name.Length); Marshal.Copy(name, 0, IntPtr.Add(data, offset), name.Length);
            IoStatus io; return NtSetInformationFile(source, out io, data, (uint)length, kind);
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    internal static int DisposeExact(SafeFileHandle source, Proof expected)
    {
        Verify(source, expected); IntPtr data = Marshal.AllocHGlobal(1);
        try { Marshal.WriteByte(data, 1); IoStatus io; return NtSetInformationFile(source, out io, data, 1, 13); }
        finally { Marshal.FreeHGlobal(data); }
    }
    internal sealed class Chain : IDisposable
    {
        readonly Graph graph = new Graph();
        internal readonly List<string> Paths = new List<string>();
        internal readonly SafeFileHandle LastHandle;
        internal uint Volume { get { return LastIdentity.Volume; } }
        internal Info LastIdentity { get { return Information(LastHandle); } }
        internal Chain(string directory)
        {
            try { string full = Path.GetFullPath(directory); LastHandle = graph.Directory(full); Paths.Add(full); }
            catch { graph.Dispose(); throw; }
        }
        internal void Verify() { graph.Verify(); }
        public void Dispose() { graph.Dispose(); }
    }
    internal static SafeFileHandle Open(Chain parent, string leaf, uint maximumLinks = 1, bool leaseReadOnly = false)
    {
        parent.Verify(); var file = OpenRelative(parent.LastHandle, leaf, false, 0, false, 1, leaseReadOnly);
        try { Info info = Information(file); if (maximumLinks < 1 || maximumLinks > 2 || info.Links < 1 || info.Links > maximumLinks) throw new InvalidOperationException("LINK_LIMIT"); return file; }
        catch { file.Dispose(); throw; }
    }
    internal static SafeFileHandle Open(string file, bool directory, uint maximumLinks = 1, bool leaseReadOnly = false)
    {
        if (directory) throw new InvalidOperationException("USE_DIRECTORY_CHAIN");
        using (var parent = new Chain(Path.GetDirectoryName(file))) return Open(parent, Path.GetFileName(file), maximumLinks, leaseReadOnly);
    }
    internal static string LeaseToken(SafeFileHandle file)
    {
        Info before = Information(file); long position;
        if (before.SizeHigh != 0 || before.SizeLow != 36 || before.Links != 1 || (before.Attributes & (0x10 | 0x400)) != 0
            || !SetFilePointerEx(file, 0, out position, 0)) throw new GuardError("LEASE_MISMATCH");
        var bytes = new byte[37]; uint read;
        if (!ReadFile(file, bytes, (uint)bytes.Length, out read, IntPtr.Zero) || read != 36) throw new GuardError("LEASE_MISMATCH");
        Info after = Information(file);
        if (before.Volume != after.Volume || Inode(before) != Inode(after) || after.SizeLow != 36 || after.SizeHigh != 0 || after.Links != 1) throw new GuardError("LEASE_MISMATCH");
        return new UTF8Encoding(false, true).GetString(bytes, 0, (int)read);
    }
    internal static void SameVolume(Chain source, Chain destination)
    { source.Verify(); destination.Verify(); if (source.Volume != destination.Volume) throw new InvalidOperationException("CROSS_VOLUME"); }
    static string TargetLeaf(Chain destination, string path)
    {
        if (!String.Equals(Path.GetFullPath(Path.GetDirectoryName(path)), destination.Paths[0], StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("DESTINATION_OUT_OF_CHAIN");
        string leaf = Path.GetFileName(path); Leaf(leaf); return leaf;
    }
    internal static int Rename(SafeFileHandle source, Proof expected, Chain sourceChain, Chain destination, string target)
    {
        SameVolume(sourceChain, destination);
        int status = Name(source, expected, destination.LastHandle, TargetLeaf(destination, target), 10);
        Verify(source, expected); sourceChain.Verify(); destination.Verify(); return status < 0 ? (int)RtlNtStatusToDosError(status) : 0;
    }
    internal static int LinkExact(SafeFileHandle source, Proof expected, Chain sourceChain, Chain destination, string sourcePath, string target)
    {
        SameVolume(sourceChain, destination); if (expected.Links != 1) throw new InvalidOperationException("LINK_LIMIT");
        if (!String.Equals(Path.GetFullPath(Path.GetDirectoryName(sourcePath)), sourceChain.Paths[0], StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("SOURCE_OUT_OF_CHAIN");
        int status = Name(source, expected, destination.LastHandle, TargetLeaf(destination, target), 11);
        Proof actual = Capture(source, 2);
        if (actual.Volume != expected.Volume || actual.Inode != expected.Inode || actual.Sha256 != expected.Sha256 || actual.Size != expected.Size || actual.Links != (status < 0 ? 1u : 2u)) throw new InvalidOperationException("PROOF_MISMATCH");
        sourceChain.Verify(); destination.Verify(); return status < 0 ? (int)RtlNtStatusToDosError(status) : 0;
    }
    internal static int DeleteExact(SafeFileHandle source, Proof expected, Chain sourceChain)
    { sourceChain.Verify(); int status = DisposeExact(source, expected); sourceChain.Verify(); return status < 0 ? (int)RtlNtStatusToDosError(status) : 0; }
}
