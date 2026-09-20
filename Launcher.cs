using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace FileTransferFast
{
    static class Program
    {
        private static Process serverProcess = null;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverScript = Path.Combine(appDir, "server.js");

            // If server.js is not in the app directory, extract embedded resources to %LOCALAPPDATA%\FileTransferFast
            if (!File.Exists(serverScript))
            {
                string localData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FileTransferFast");
                try
                {
                    if (!Directory.Exists(localData)) Directory.CreateDirectory(localData);
                    ExtractResource("FileTransferFast.server.js", Path.Combine(localData, "server.js"));
                    ExtractResource("FileTransferFast.devices-client.js", Path.Combine(localData, "devices-client.js"));
                    ExtractResource("FileTransferFast.client.js", Path.Combine(localData, "client.js"));
                    ExtractResource("FileTransferFast.package.json", Path.Combine(localData, "package.json"));
                    appDir = localData;
                    serverScript = Path.Combine(localData, "server.js");
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Could not initialize application files: " + ex.Message, "File Transfer Fast", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }

            // Find Node.js
            string nodePath = FindNodeExecutable(appDir);
            if (string.IsNullOrEmpty(nodePath))
            {
                DialogResult res = MessageBox.Show(
                    "Node.js is required to run the local file transfer engine.\n\n" +
                    "Would you like to open the official Node.js download page (nodejs.org) to install it?\n\n" +
                    "After installing Node.js, run FileTransferFast.exe again.",
                    "Node.js Required - File Transfer Fast",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );
                if (res == DialogResult.Yes)
                {
                    try { Process.Start("https://nodejs.org/en/download"); } catch { }
                }
                return;
            }

            // Launch the Node.js server engine in background
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = "\"" + serverScript + "\"";
                psi.WorkingDirectory = appDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                serverProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch transfer engine: " + ex.Message, "File Transfer Fast", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Auto-open browser after 1.5 seconds
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(1500);
                try
                {
                    Process.Start("http://localhost:8001/devices-ui");
                }
                catch { }
            });

            // Run GUI window
            Application.Run(new MainWindow());

            // Clean up server on exit
            Cleanup();
        }

        private static void ExtractResource(string resName, string destPath)
        {
            var asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream(resName))
            {
                if (s == null) return;
                using (FileStream fs = new FileStream(destPath, FileMode.Create, FileAccess.Write))
                {
                    s.CopyTo(fs);
                }
            }
        }

        private static void Cleanup()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch { }
        }

        private static string FindNodeExecutable(string appDir)
        {
            // 1. Check same directory or local node
            string localNode = Path.Combine(appDir, "node.exe");
            if (File.Exists(localNode)) return localNode;

            // 2. Check PATH via 'where node'
            try
            {
                Process p = new Process();
                p.StartInfo.FileName = "where";
                p.StartInfo.Arguments = "node";
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.StartInfo.CreateNoWindow = true;
                p.Start();
                string outStr = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                if (!string.IsNullOrEmpty(outStr))
                {
                    string[] lines = outStr.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        string trimmed = line.Trim();
                        if (File.Exists(trimmed)) return trimmed;
                    }
                }
            }
            catch { }

            // 3. Common Windows paths
            string[] commonPaths = new string[]
            {
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\nodejs\node.exe"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\nodejs\node.exe"),
                Environment.ExpandEnvironmentVariables(@"%LocalAppData%\Programs\nodejs\node.exe"),
                Environment.ExpandEnvironmentVariables(@"%AppData%\npm\node.exe"),
                @"C:\Program Files\nodejs\node.exe"
            };

            foreach (string path in commonPaths)
            {
                if (File.Exists(path)) return path;
            }

            return null;
        }
    }

    public class MainWindow : Form
    {
        public MainWindow()
        {
            this.Text = "File Transfer Fast — Host Engine";
            this.Size = new Size(460, 270);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // Dark slate
            this.ForeColor = Color.White;

            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
            if (File.Exists(iconPath))
            {
                try { this.Icon = new Icon(iconPath); } catch { }
            }

            Label lblBadge = new Label();
            lblBadge.Text = "ACTIVE & HOSTING";
            lblBadge.Font = new Font("Segoe UI", 8, FontStyle.Bold);
            lblBadge.ForeColor = Color.FromArgb(74, 222, 128); // Green
            lblBadge.BackColor = Color.FromArgb(20, 83, 45);
            lblBadge.Location = new Point(24, 20);
            lblBadge.Size = new Size(130, 20);
            lblBadge.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(lblBadge);

            Label lblTitle = new Label();
            lblTitle.Text = "⚡ File Transfer Fast";
            lblTitle.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(56, 189, 248); // Cyan
            lblTitle.Location = new Point(20, 46);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            Label lblStatus = new Label();
            lblStatus.Text = "Local transfer engine is running at max Wi-Fi speed.\nOther devices on your Wi-Fi can now connect via PIN or QR code.";
            lblStatus.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            lblStatus.ForeColor = Color.FromArgb(203, 213, 225);
            lblStatus.Location = new Point(22, 85);
            lblStatus.Size = new Size(400, 36);
            this.Controls.Add(lblStatus);

            Button btnOpen = new Button();
            btnOpen.Text = "🌐 Open in Browser";
            btnOpen.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            btnOpen.BackColor = Color.FromArgb(37, 99, 235);
            btnOpen.ForeColor = Color.White;
            btnOpen.FlatStyle = FlatStyle.Flat;
            btnOpen.FlatAppearance.BorderSize = 0;
            btnOpen.Location = new Point(24, 135);
            btnOpen.Size = new Size(190, 42);
            btnOpen.Cursor = Cursors.Hand;
            btnOpen.Click += delegate {
                try { Process.Start("http://localhost:8001/devices-ui"); } catch { }
            };
            this.Controls.Add(btnOpen);

            Button btnStop = new Button();
            btnStop.Text = "🛑 Stop & Exit";
            btnStop.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            btnStop.BackColor = Color.FromArgb(220, 38, 38);
            btnStop.ForeColor = Color.White;
            btnStop.FlatStyle = FlatStyle.Flat;
            btnStop.FlatAppearance.BorderSize = 0;
            btnStop.Location = new Point(228, 135);
            btnStop.Size = new Size(190, 42);
            btnStop.Cursor = Cursors.Hand;
            btnStop.Click += delegate {
                this.Close();
            };
            this.Controls.Add(btnStop);

            Label lblHint = new Label();
            lblHint.Text = "Tip: Keep this window open while transferring files. Close to stop the engine.";
            lblHint.Font = new Font("Segoe UI", 8, FontStyle.Italic);
            lblHint.ForeColor = Color.FromArgb(148, 163, 184);
            lblHint.Location = new Point(24, 192);
            lblHint.AutoSize = true;
            this.Controls.Add(lblHint);
        }
    }
}
