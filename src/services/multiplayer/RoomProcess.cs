using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class RoomProcess
{
    private const int KillOnJobClose = 0x2000;
    private const int ExtendedLimitInformation = 9;
    private const int TcpTableOwnerPidAll = 5;
    private const int AfInet = 2;
    private const int AfInet6 = 23;
    private const int InsufficientBuffer = 122;
    private const int MaximumConfigBytes = 16384;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessTime, PerJobTime;
        public int Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public int ActiveProcesses;
        public UIntPtr Affinity;
        public int Priority, Scheduling;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("iphlpapi.dll")]
    private static extern int GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);

    private static bool ReadExact(Stream stream, byte[] bytes)
    {
        int offset = 0;
        while (offset < bytes.Length)
        {
            int count = stream.Read(bytes, offset, bytes.Length - offset);
            if (count == 0) return false;
            offset += count;
        }
        return true;
    }

    private static int RunEngine(string executable, int rpcPort)
    {
        if (!Path.IsPathRooted(executable) || Path.GetFileName(executable) != "easytier-core.exe") return 2;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return 3;
        try
        {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = KillOnJobClose;
            if (!SetInformationJobObject(job, ExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(ExtendedLimits)))
                || !AssignProcessToJobObject(job, GetCurrentProcess())) return 3;

            Stream owner = Console.OpenStandardInput();
            byte[] size = new byte[4];
            if (!ReadExact(owner, size)) return 2;
            int count = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(size, 0));
            if (count < 1 || count > MaximumConfigBytes) return 2;
            byte[] config = new byte[count];
            if (!ReadExact(owner, config)) return 2;

            // Once the owning main process disappears, the pipe closes and the job kills the engine.
            var lifetime = new Thread(delegate()
            {
                try { owner.ReadByte(); }
                catch (IOException) { }
                finally { Environment.Exit(0); }
            });
            lifetime.IsBackground = true;
            lifetime.Start();

            var settings = new ProcessStartInfo(executable);
            settings.WorkingDirectory = Path.GetDirectoryName(executable);
            settings.Arguments = "-c - --secure-mode --rpc-portal 127.0.0.1:"
                + rpcPort.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + " --rpc-portal-whitelist 127.0.0.1/32 --console-log-level off --file-log-level off";
            settings.UseShellExecute = false;
            settings.CreateNoWindow = true;
            settings.RedirectStandardInput = true;
            settings.RedirectStandardOutput = true;
            settings.RedirectStandardError = true;
            using (Process child = Process.Start(settings))
            {
                child.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
                child.StandardError.BaseStream.CopyToAsync(Stream.Null);
                child.StandardInput.BaseStream.Write(config, 0, config.Length);
                Array.Clear(config, 0, config.Length);
                child.StandardInput.Close();
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        finally { CloseHandle(job); }
    }

    private static int PortAt(IntPtr row, int offset)
    {
        return ((int)Marshal.ReadByte(row, offset) << 8) | Marshal.ReadByte(row, offset + 1);
    }

    private static bool IsLoopbackAt(IntPtr row, int offset, int family, bool allowAny)
    {
        byte[] address = new byte[family == AfInet ? 4 : 16];
        Marshal.Copy(IntPtr.Add(row, offset), address, 0, address.Length);
        var ip = new IPAddress(address);
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return IPAddress.IsLoopback(ip) || allowAny && (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any));
    }

    private static bool OwnsSocket(int family, int pid, int port, int clientPort)
    {
        int size = 0;
        if (GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, TcpTableOwnerPidAll, 0) != InsufficientBuffer
            || size < 4 || size > 16 * 1024 * 1024) return false;
        IntPtr memory = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(memory, ref size, false, family, TcpTableOwnerPidAll, 0) != 0) return false;
            int rows = Marshal.ReadInt32(memory);
            int width = family == AfInet ? 24 : 56;
            if (rows < 0 || rows > (size - 4) / width) return false;
            for (int i = 0; i < rows; i++)
            {
                IntPtr row = IntPtr.Add(memory, 4 + i * width);
                int state = Marshal.ReadInt32(row, family == AfInet ? 0 : 48);
                int localAddressOffset = family == AfInet ? 4 : 0;
                if (state != (clientPort == 0 ? 2 : 5) || Marshal.ReadInt32(row, family == AfInet ? 20 : 52) != pid
                    || PortAt(row, family == AfInet ? 8 : 20) != port
                    || !IsLoopbackAt(row, localAddressOffset, family, clientPort == 0)) continue;
                if (clientPort == 0 || PortAt(row, family == AfInet ? 16 : 44) == clientPort
                    && IsLoopbackAt(row, family == AfInet ? 12 : 24, family, false)) return true;
            }
            return false;
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private static int Main(string[] args)
    {
        try
        {
            int value, port;
            if (args.Length == 3 && args[0] == "run" && Int32.TryParse(args[2], out port) && port > 0 && port <= 65535)
                return RunEngine(args[1], port);
            if ((args.Length == 3 || args.Length == 4) && args[0] == "verify" && Int32.TryParse(args[1], out value)
                && value > 0 && Int32.TryParse(args[2], out port) && port > 0 && port <= 65535)
            {
                int clientPort = 0;
                if (args.Length == 4 && (!Int32.TryParse(args[3], out clientPort) || clientPort < 1 || clientPort > 65535)) return 2;
                return OwnsSocket(AfInet, value, port, clientPort) || OwnsSocket(AfInet6, value, port, clientPort) ? 0 : 1;
            }
        }
        catch (Exception) { return 3; }
        return 2;
    }
}
