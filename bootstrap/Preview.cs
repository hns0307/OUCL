using System;
using System.Windows.Forms;
// Visual-only fixture, never compiled into the shipped launcher.
internal static class BootstrapPreview {
    [STAThread] static void Main() {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new DownloadWindow()) {
            window.Text = "OUCL · 下载界面预览";
            Application.Run(window);
        }
    }
}
