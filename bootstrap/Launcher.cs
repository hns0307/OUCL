using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// Windows-only bootstrap. All executable content is either embedded or bound to a build-time SHA256.
internal static class Launcher {
    internal static readonly CancellationTokenSource Cancel = new CancellationTokenSource();
    internal static string[] Arguments;
    [STAThread] static void Main(string[] args) {
        Arguments = args;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var context = new BootstrapContext()) Application.Run(context);
    }
    internal static string TextResource(string name) {
        using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream(name))) return reader.ReadToEnd();
    }
    internal static string Hash(string file) {
        Guard(file);
        using (var stream = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    internal static void Guard(string file) {
        var full = Path.GetFullPath(file);
        for (string current = full; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("UNSAFE_CACHE_PATH");
        }
    }
    static string SafeFile(string root, string relative) {
        if (String.IsNullOrEmpty(relative) || relative.IndexOf('\\') >= 0 || relative.IndexOf(':') >= 0 || relative.StartsWith("/")) throw new IOException("INVALID_ARCHIVE_PATH");
        var parts = relative.TrimEnd('/').Split('/');
        foreach (var part in parts) {
            var stem = part.Split('.')[0].ToUpperInvariant();
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || new[] {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}.Contains(stem)) throw new IOException("INVALID_ARCHIVE_PATH");
        }
        string result = Path.GetFullPath(Path.Combine(root, String.Join(Path.DirectorySeparatorChar.ToString(), parts)));
        if (!result.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("INVALID_ARCHIVE_PATH");
        Guard(result); return result;
    }
    static void Extract(Stream stream, string root) {
        Guard(root); Directory.CreateDirectory(root);
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
            long total = 0; var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (zip.Entries.Count > 15000) throw new IOException("ARCHIVE_LIMIT");
            foreach (var entry in zip.Entries) {
                Cancel.Token.ThrowIfCancellationRequested();
                var target = SafeFile(root, entry.FullName);
                if (!seen.Add(target) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new IOException("INVALID_ARCHIVE_ENTRY");
                total += entry.Length;
                if (entry.Length > 512L * 1024 * 1024 || total > 1024L * 1024 * 1024) throw new IOException("ARCHIVE_LIMIT");
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target)); Guard(target);
                using (var input = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    var buffer = new byte[65536]; int count; long written = 0;
                    while ((count = input.Read(buffer, 0, buffer.Length)) != 0) {
                        Cancel.Token.ThrowIfCancellationRequested(); written += count;
                        if (written > entry.Length) throw new IOException("ARCHIVE_LIMIT"); output.Write(buffer, 0, count);
                    }
                    if (written != entry.Length) throw new IOException("TRUNCATED_ARCHIVE");
                }
            }
        }
    }
    static bool Verify(string root, string manifest) {
        if (!Directory.Exists(root)) return false;
        Guard(root);
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in manifest.Split(new[] {'\n'}, StringSplitOptions.RemoveEmptyEntries)) {
            Cancel.Token.ThrowIfCancellationRequested(); var digest = line.Substring(0, 64); var relative = line.Substring(66).TrimEnd('\r');
            var file = SafeFile(root, relative);
            allowed.Add(file);
            if (!File.Exists(file) || Hash(file) != digest) return false;
        }
        Func<string, bool> inspect = null;
        inspect = folder => {
            Guard(folder);
            foreach (var item in Directory.EnumerateFileSystemEntries(folder)) {
                Guard(item);
                if (Directory.Exists(item)) { if (!inspect(item)) return false; }
                else if (!allowed.Contains(Path.GetFullPath(item))) return false;
            }
            return true;
        };
        if (!inspect(root)) return false;
        return true;
    }
    static string FindCache(string root, string name, string manifest) {
        string primary = Path.Combine(root, name);
        if (Verify(primary, manifest)) return primary;
        foreach (string candidate in Directory.EnumerateDirectories(root, name + "-*").Take(32)) if (Verify(candidate, manifest)) return candidate;
        return null;
    }
    static void Download(string address, string destination, Action<string> progress) {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        for (int redirects = 0; redirects < 5; redirects++) {
            var uri = new Uri(address);
            if (uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo != "" || (uri.Host != "github.com" && uri.Host != "release-assets.githubusercontent.com" && uri.Host != "objects.githubusercontent.com")) throw new IOException("UNTRUSTED_DOWNLOAD");
            var request = (HttpWebRequest)WebRequest.Create(uri); request.AllowAutoRedirect = false; request.Timeout = 30000; request.ReadWriteTimeout = 30000; request.UserAgent = "OUCL-Bootstrap";
            using (Cancel.Token.Register(request.Abort)) using (var response = (HttpWebResponse)request.GetResponse()) {
                if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400) { address = new Uri(uri, response.Headers["Location"]).AbsoluteUri; continue; }
                if (response.StatusCode != HttpStatusCode.OK || response.ContentLength > 512L * 1024 * 1024) throw new IOException("BAD_RESPONSE");
                using (var input = response.GetResponseStream()) using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    var buffer = new byte[65536]; long done = 0; int count;
                    while ((count = input.Read(buffer, 0, buffer.Length)) != 0) {
                        Cancel.Token.ThrowIfCancellationRequested(); done += count; if (done > 512L * 1024 * 1024) throw new IOException("DOWNLOAD_LIMIT");
                        output.Write(buffer, 0, count); progress("正在下载运行环境：" + (done / 1048576) + " MB" + (response.ContentLength > 0 ? " / " + (response.ContentLength / 1048576) + " MB" : ""));
                    }
                    if (response.ContentLength >= 0 && done != response.ContentLength) throw new IOException("TRUNCATED_DOWNLOAD");
                }
                return;
            }
        }
        throw new IOException("REDIRECT_LIMIT");
    }
    static string Quote(string text) {
        // Windows CommandLineToArgvW escaping; no shell is involved.
        var result = new System.Text.StringBuilder("\""); int slashes = 0;
        foreach (char c in text) { if (c == '\\') { slashes++; continue; } result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); result.Append(c); slashes = 0; }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    internal static string EnvironmentRoot(string executable) {
        return Path.Combine(Path.GetDirectoryName(Path.GetFullPath(executable)), "OUCL.runtime");
    }
    // Isolate portable metadata from other OUCL copies and the legacy desktop profile.
    internal static string[] ApplicationArguments(string executable, string[] args) {
        for (int index = 0; index < args.Length; index++) {
            if (args[index] == "--user-data-dir") {
                if (index + 1 >= args.Length || String.IsNullOrWhiteSpace(args[index + 1]) || args[index + 1].StartsWith("--")) throw new ArgumentException("MISSING_PROFILE_DIRECTORY");
                return args;
            }
            if (args[index].StartsWith("--user-data-dir=", StringComparison.Ordinal)) {
                if (String.IsNullOrWhiteSpace(args[index].Substring("--user-data-dir=".Length))) throw new ArgumentException("MISSING_PROFILE_DIRECTORY");
                return args;
            }
        }
        return args.Concat(new[] {"--user-data-dir=" + Path.Combine(EnvironmentRoot(executable), "profile")}).ToArray();
    }
    internal static void Run(Action<string> progress, string testRoot = null, Action needsDownload = null) {
        var configuration = TextResource("configuration").Trim().Split('\n');
        string runtimeHash = configuration[0].Trim(), url = configuration[1].Trim(), appHash = configuration[2].Trim();
        string root = testRoot ?? EnvironmentRoot(Assembly.GetExecutingAssembly().Location);
        Guard(root); Directory.CreateDirectory(root);
        // Open-handle lock is released by Windows after a crash; it never deletes user/application leases.
        string lockFile = Path.Combine(root, "bootstrap.lock"); Guard(lockFile);
        using (var fileLock = new FileStream(lockFile, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
            progress("正在检查本地运行环境……");
            string runtime = FindCache(root, "electron-" + runtimeHash, TextResource("runtime-manifest"));
            if (runtime == null) {
                runtime = Path.Combine(root, "electron-" + runtimeHash);
                // Corruption never causes replacement of a potentially running runtime. A fresh immutable namespace is used.
                if (Directory.Exists(runtime)) runtime += "-" + Guid.NewGuid().ToString("N");
                string staging = Path.Combine(root, ".download-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(staging);
                string archive = Path.Combine(staging, "runtime.zip");
                try {
                    if (needsDownload != null) needsDownload();
                    Download(url, archive, progress); progress("正在校验运行环境……");
                    if (Hash(archive) != runtimeHash) throw new IOException("HASH_MISMATCH");
                    using (var stream = File.OpenRead(archive)) Extract(stream, Path.Combine(staging, "runtime"));
                    if (!Verify(Path.Combine(staging, "runtime"), TextResource("runtime-manifest"))) throw new IOException("RUNTIME_MISMATCH");
                    Directory.Move(Path.Combine(staging, "runtime"), runtime);
                } finally { SafeCleanup(root, staging); }
            }
            progress("正在准备 OUCL……");
            string application = FindCache(root, "app-" + appHash, TextResource("app-manifest"));
            if (application == null) {
                application = Path.Combine(root, "app-" + appHash);
                if (Directory.Exists(application)) application += "-" + Guid.NewGuid().ToString("N");
                string staging = Path.Combine(root, ".app-" + Guid.NewGuid().ToString("N"));
                try {
                    using (var embedded = Assembly.GetExecutingAssembly().GetManifestResourceStream("application")) Extract(embedded, staging);
                    if (!Verify(staging, TextResource("app-manifest"))) throw new IOException("APPLICATION_MISMATCH");
                    Directory.Move(staging, application);
                } finally { SafeCleanup(root, staging); }
            }
            Cancel.Token.ThrowIfCancellationRequested();
            var start = new ProcessStartInfo(Path.Combine(runtime, "electron.exe")); start.UseShellExecute = false; start.WorkingDirectory = application;
            start.Arguments = Quote(application) + " " + String.Join(" ", ApplicationArguments(Assembly.GetExecutingAssembly().Location, Arguments).Select(Quote));
            start.EnvironmentVariables["OUCL_PORTABLE_ROOT"] = Path.GetDirectoryName(Path.GetFullPath(Assembly.GetExecutingAssembly().Location));
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("ELECTRON_OVERRIDE_DIST_PATH");
            Process.Start(start);
        }
    }
    static void SafeCleanup(string root, string directory) {
        if (!Directory.Exists(directory)) return;
        Guard(directory);
        if (Path.GetDirectoryName(directory) != root || (!Path.GetFileName(directory).StartsWith(".download-") && !Path.GetFileName(directory).StartsWith(".app-"))) throw new IOException("UNSAFE_CLEANUP");
        // Inspect the whole tree before recursive removal; never follow a reparse point.
        Action<string> inspect = null; inspect = folder => { Guard(folder); foreach (var item in Directory.EnumerateFileSystemEntries(folder)) { Guard(item); if (Directory.Exists(item)) inspect(item); } }; inspect(directory);
        Directory.Delete(directory, true);
    }
}
internal sealed class BootstrapContext : ApplicationContext {
    readonly DownloadWindow window = new DownloadWindow();
    internal BootstrapContext() {
        // Create a message target without ever making the preparation window visible.
        var handle = window.Handle;
        window.FormClosed += (sender, args) => ExitThread();
        Application.Idle += Begin;
    }
    async void Begin(object sender, EventArgs args) {
        Application.Idle -= Begin;
        await window.Start();
    }
    protected override void Dispose(bool disposing) {
        if (disposing) { Application.Idle -= Begin; window.Dispose(); }
        base.Dispose(disposing);
    }
}
internal sealed class DownloadWindow : Form {
    readonly Label heading = new Label { Left = 28, Top = 24, Width = 440, Height = 40, Text = "OUCL", ForeColor = System.Drawing.Color.FromArgb(26, 67, 59), Font = new System.Drawing.Font("Microsoft YaHei UI", 21, System.Drawing.FontStyle.Bold) };
    readonly Label status = new Label { Left = 30, Top = 82, Width = 456, Height = 48, Text = "正在准备运行环境……" };
    readonly Label detail = new Label { Left = 30, Top = 174, Width = 310, Height = 45, Text = "首次准备后，将直接进入启动器。\n运行文件保存在 EXE 同级的 OUCL.runtime。", ForeColor = System.Drawing.Color.FromArgb(105, 118, 113), Font = new System.Drawing.Font("Microsoft YaHei UI", 8.5F) };
    readonly ProgressBar progress = new ProgressBar { Left = 30, Top = 142, Width = 456, Height = 6, Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 24 };
    readonly Button retry = new Button { Left = 360, Top = 178, Width = 126, Height = 34, Text = "重试", Visible = false, FlatStyle = FlatStyle.Flat, BackColor = System.Drawing.Color.FromArgb(33, 104, 85), ForeColor = System.Drawing.Color.White };
    readonly Button cancel = new Button { Left = 360, Top = 178, Width = 126, Height = 34, Text = "取消", FlatStyle = FlatStyle.Flat, BackColor = System.Drawing.Color.White };
    bool working;
    internal DownloadWindow() {
        Text = "OUCL · 准备运行环境"; ClientSize = new System.Drawing.Size(516, 240); FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        BackColor = System.Drawing.Color.FromArgb(246, 248, 245); Font = new System.Drawing.Font("Microsoft YaHei UI", 10F); AutoScaleMode = AutoScaleMode.Dpi;
        Controls.AddRange(new Control[] { heading, status, detail, progress, retry, cancel });
        retry.FlatAppearance.BorderSize = 0; cancel.FlatAppearance.BorderColor = System.Drawing.Color.FromArgb(216, 225, 219);
        retry.Click += async (sender, args) => await Start(); cancel.Click += (sender, args) => Close();
        FormClosing += (sender, args) => { if (working) { Launcher.Cancel.Cancel(); status.Text = "正在取消，请稍候……"; cancel.Enabled = false; args.Cancel = true; } };
    }
    internal async Task Start() {
        working = true; retry.Visible = false; cancel.Visible = true; progress.Visible = true;
        try {
            await Task.Run(() => Launcher.Run(text => BeginInvoke((Action)(() => status.Text = text)), null,
                () => BeginInvoke((Action)(() => { status.Text = "首次使用，正在下载运行环境……"; if (!Visible) Show(); }))));
            working = false; Close();
        }
        catch (Exception error) {
            working = false; if (Launcher.Cancel.IsCancellationRequested) { Close(); return; }
            status.Text = error is UnauthorizedAccessException ? "无法写入同级目录，请将 EXE 放到可写文件夹后重试。" : "准备未完成，请检查网络、磁盘空间，或等待另一个 OUCL 完成准备后重试。";
            detail.Text = "已有游戏和账户数据不会被修改。"; progress.Visible = false; cancel.Visible = false; retry.Visible = true;
            if (!Visible) Show();
        }
    }
}
