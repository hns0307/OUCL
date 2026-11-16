using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

internal static class RelativeNative
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
    internal sealed class Proof { public string dev, ino, sha256; public long size; public uint links; }
    internal sealed class VolumeProfile { public string root, fileSystem; public uint driveType, serial; }
    internal sealed class NtFailure : Exception
    {
        internal readonly int Status; internal readonly uint Win32;
        internal NtFailure(int status) : base("NTSTATUS=0x" + ((uint)status).ToString("x8") + ";Win32=" + RtlNtStatusToDosError(status))
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
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(SafeFileHandle handle, uint code, byte[] input, uint length, IntPtr output, uint outputLength, out uint returned, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool MoveFileExW(string source, string target, uint flags);
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
    internal static SafeFileHandle OpenRelative(SafeFileHandle parent, string leaf, bool directory, uint directoryAccess, bool metadataFile = false, uint share = 1)
    {
        Leaf(leaf); IntPtr name = Marshal.StringToHGlobalUni(leaf), unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
        try
        {
            var text = new Unicode { Length = (ushort)(leaf.Length * 2), MaximumLength = (ushort)(leaf.Length * 2 + 2), Buffer = name };
            Marshal.StructureToPtr(text, unicode, false);
            var attributes = new Attributes { Length = (uint)Marshal.SizeOf(typeof(Attributes)), RootDirectory = parent.DangerousGetHandle(), ObjectName = unicode, Flags = 0x40 | 0x1000 };
            IoStatus io; IntPtr result;
            int status = NtCreateFile(out result, directory ? directoryAccess : metadataFile ? 0x80u | Sync : Read | Delete | Sync, ref attributes, out io, IntPtr.Zero, 0, metadataFile ? 7u : share, 1,
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
        internal Graph(string mode) { separateGuard = mode == "metadata"; Access = mode == "strong" ? Read | 2u | Sync : 0x20u | 0x80u | Sync; }
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
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
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
    internal static Proof Capture(SafeFileHandle file, uint maximumLinks)
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
            return new Proof { dev = before.Volume.ToString(), ino = Inode(before), size = size, links = before.Links, sha256 = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() };
        }
    }
    internal static void Verify(SafeFileHandle file, Proof expected)
    {
        Proof actual = Capture(file, expected.links);
        if (actual.dev != expected.dev || actual.ino != expected.ino || actual.sha256 != expected.sha256 || actual.size != expected.size || actual.links != expected.links)
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
    internal static object SetJunction(string directory, string target, uint desired)
    {
        using (var handle = CreateFileW(directory, desired, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero))
        {
            if (handle.IsInvalid) return new { opened = false, desired = desired, error = Marshal.GetLastWin32Error(), set = false };
            byte[] substitute = Encoding.Unicode.GetBytes("\\??\\" + Path.GetFullPath(target)), print = Encoding.Unicode.GetBytes(Path.GetFullPath(target));
            byte[] data = new byte[16 + substitute.Length + 2 + print.Length + 2];
            Array.Copy(BitConverter.GetBytes(0xA0000003u), 0, data, 0, 4); Array.Copy(BitConverter.GetBytes((ushort)(data.Length - 8)), 0, data, 4, 2);
            Array.Copy(BitConverter.GetBytes((ushort)substitute.Length), 0, data, 10, 2); Array.Copy(BitConverter.GetBytes((ushort)(substitute.Length + 2)), 0, data, 12, 2);
            Array.Copy(BitConverter.GetBytes((ushort)print.Length), 0, data, 14, 2); Array.Copy(substitute, 0, data, 16, substitute.Length); Array.Copy(print, 0, data, 18 + substitute.Length, print.Length);
            uint returned; bool success = DeviceIoControl(handle, 0x900A4, data, (uint)data.Length, IntPtr.Zero, 0, out returned, IntPtr.Zero);
            return new { opened = true, desired = desired, error = success ? 0 : Marshal.GetLastWin32Error(), set = success };
        }
    }
}
