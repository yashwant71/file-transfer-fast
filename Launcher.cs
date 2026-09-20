using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace FileTransferFast
{
    static class Program
    {
        public static Process serverProcess = null;
        public static MainWindow activeWindow = null;
        public static string logFilePath = "";
        private static IntPtr jobHandle = IntPtr.Zero;
        private static bool cleanupDone = false;
        private static readonly object cleanupLock = new object();

        // --- Job Object P/Invoke (kill child when parent dies) ---
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attrs, string name);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr job, int infoType, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);

        [DllImport("kernel32.dll")]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public int LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public int ActiveProcessLimit;
            public UIntPtr Affinity;
            public int PriorityClass;
            public int SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private const int JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        private const int JobObjectExtendedLimitInformation = 9;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverScript = Path.Combine(appDir, "server.js");
            logFilePath = Path.Combine(appDir, "engine.log");

            try
            {
                File.WriteAllText(logFilePath, "=== File Transfer Fast Engine Started at " + DateTime.Now + " ===" + Environment.NewLine);
            }
            catch { }

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
                    logFilePath = Path.Combine(localData, "engine.log");
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

            // Kill any orphan node still occupying 8001/8443 from a previous crash
            KillOrphanServersOnPorts();

            // Prepare MainWindow first so logs can stream into it
            activeWindow = new MainWindow();
            activeWindow.FormClosing += (s, e) => Cleanup();
            AppDomain.CurrentDomain.ProcessExit += (s, e) => Cleanup();
            Application.ApplicationExit += (s, e) => Cleanup();

            // Launch the Node.js server engine in background with live redirected streams
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = "\"" + serverScript + "\"";
                psi.WorkingDirectory = appDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                // Pass parent PID so server.js can watchdog and exit if launcher dies unexpectedly
                try { psi.EnvironmentVariables["FTF_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString(); } catch { }

                serverProcess = new Process();
                serverProcess.StartInfo = psi;
                serverProcess.EnableRaisingEvents = true;
                serverProcess.Exited += (s, e) => { try { AddLog("[ENGINE] Server process exited (code " + serverProcess.ExitCode + ")"); } catch { } };

                serverProcess.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null) AddLog(e.Data);
                };
                serverProcess.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null) AddLog("[ERR] " + e.Data);
                };

                serverProcess.Start();
                serverProcess.BeginOutputReadLine();
                serverProcess.BeginErrorReadLine();

                // Assign to Job Object so child dies automatically if parent is killed via Task Manager
                try
                {
                    jobHandle = CreateJobObject(IntPtr.Zero, null);
                    if (jobHandle != IntPtr.Zero)
                    {
                        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                        SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ref info, Marshal.SizeOf(info));
                        AssignProcessToJobObject(jobHandle, serverProcess.Handle);
                        AddLog("[ENGINE] Job object armed (kill-on-close)");
                    }
                }
                catch (Exception ex) { try { AddLog("[ENGINE] Job object failed: " + ex.Message); } catch { } }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch transfer engine: " + ex.Message, "File Transfer Fast", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Auto-open browser only when server is actively responding
            ThreadPool.QueueUserWorkItem(delegate
            {
                for (int i = 0; i < 25; i++)
                {
                    try
                    {
                        var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://localhost:8001/devices-ui");
                        req.Timeout = 600;
                        using (var resp = (System.Net.HttpWebResponse)req.GetResponse())
                        {
                            if (resp.StatusCode == System.Net.HttpStatusCode.OK)
                            {
                                break;
                            }
                        }
                    }
                    catch
                    {
                        Thread.Sleep(250);
                    }
                }

                try
                {
                    Process.Start("http://localhost:8001/devices-ui?role=host");
                }
                catch { }
            });

            // Run GUI window - guaranteed cleanup via try/finally + FormClosing + ProcessExit
            try
            {
                Application.Run(activeWindow);
            }
            finally
            {
                Cleanup();
            }
        }

        public static void AddLog(string msg)
        {
            try
            {
                if (activeWindow != null && !activeWindow.IsDisposed)
                {
                    activeWindow.AppendLog(msg);
                }
                File.AppendAllText(logFilePath, "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + Environment.NewLine);
            }
            catch { }
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

        public static void Cleanup()
        {
            lock (cleanupLock)
            {
                if (cleanupDone) return;
                cleanupDone = true;
            }

            try { AddLog("[ENGINE] Shutting down..."); } catch { }

            // 1. Immediately mark host offline in cloud lobby
            try
            {
                var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("https://api.restful-api.dev/objects/ff808181a09d98f701a0bd4a36264d98");
                req.Method = "PUT";
                req.ContentType = "application/json";
                req.Timeout = 1200;
                string json = "{\"name\":\"file-transfer-active-host\",\"data\":{\"active\":false,\"timestamp\":0}}";
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;
                using (var stream = req.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
                using (var resp = req.GetResponse()) { }
            }
            catch { }

            // 2. Kill server process (with tree-kill fallback)
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    int pid = serverProcess.Id;
                    try { serverProcess.Kill(); } catch { }

                    // Give it 2s to exit gracefully, then force tree-kill
                    try
                    {
                        if (!serverProcess.WaitForExit(2000))
                        {
                            KillProcessTree(pid);
                        }
                    }
                    catch { KillProcessTree(pid); }

                    try { serverProcess.Close(); } catch { }
                }
            }
            catch { }

            // 3. Fallback: ensure no node is still listening on 8001/8443 (covers orphan from crash)
            try { KillOrphanServersOnPorts(); } catch { }

            // 4. Close job handle (if kill-on-close was armed, this also kills any remaining child)
            try
            {
                if (jobHandle != IntPtr.Zero)
                {
                    CloseHandle(jobHandle);
                    jobHandle = IntPtr.Zero;
                }
            }
            catch { }

            try { File.AppendAllText(logFilePath, "[" + DateTime.Now.ToString("HH:mm:ss") + "] Engine shut down" + Environment.NewLine); } catch { }
        }

        private static void KillProcessTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                var p = Process.Start(psi);
                if (p != null) p.WaitForExit(3000);
            }
            catch { }
            // Last resort: direct Kill if still alive
            try
            {
                var proc = Process.GetProcessById(pid);
                if (!proc.HasExited) proc.Kill();
            }
            catch { }
        }

        private static void KillOrphanServersOnPorts()
        {
            int[] ports = new int[] { 8001, 8443 };
            foreach (int port in ports)
            {
                try
                {
                    var psi = new ProcessStartInfo("cmd.exe", "/c netstat -ano | findstr :" + port + " ");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    var p = Process.Start(psi);
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(2000);
                    string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        // Expected: TCP    0.0.0.0:8001    0.0.0.0:0    LISTENING    1234
                        if (!line.Contains("LISTENING")) continue;
                        string[] parts = line.Trim().Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length == 0) continue;
                        string pidStr = parts[parts.Length - 1];
                        int pid;
                        if (!int.TryParse(pidStr, out pid)) continue;
                        if (pid == Process.GetCurrentProcess().Id) continue;
                        // Only kill if it's node.exe (avoid killing unrelated)
                        try
                        {
                            var proc = Process.GetProcessById(pid);
                            string name = proc.ProcessName.ToLowerInvariant();
                            if (name == "node" || name == "filetransferfast")
                            {
                                AddLog("[CLEANUP] Killing orphan " + name + " PID " + pid + " on port " + port);
                                KillProcessTree(pid);
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
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
        private TextBox txtLogs;

        public MainWindow()
        {
            this.Text = "File Transfer Fast — Host Engine & Logs";
            this.Size = new Size(540, 520);
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
            lblBadge.Location = new Point(20, 16);
            lblBadge.Size = new Size(130, 20);
            lblBadge.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(lblBadge);

            Label lblTitle = new Label();
            lblTitle.Text = "⚡ File Transfer Fast";
            lblTitle.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(56, 189, 248); // Cyan
            lblTitle.Location = new Point(16, 40);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            Label lblStatus = new Label();
            lblStatus.Text = "Local transfer engine is running at max Wi-Fi speed.\nLocal: http://localhost:8001/devices-ui";
            lblStatus.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            lblStatus.ForeColor = Color.FromArgb(203, 213, 225);
            lblStatus.Location = new Point(18, 76);
            lblStatus.Size = new Size(480, 36);
            this.Controls.Add(lblStatus);

            Button btnOpen = new Button();
            btnOpen.Text = "🌐 Open in Browser";
            btnOpen.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnOpen.BackColor = Color.FromArgb(37, 99, 235);
            btnOpen.ForeColor = Color.White;
            btnOpen.FlatStyle = FlatStyle.Flat;
            btnOpen.FlatAppearance.BorderSize = 0;
            btnOpen.Location = new Point(18, 120);
            btnOpen.Size = new Size(160, 38);
            btnOpen.Cursor = Cursors.Hand;
            btnOpen.Click += delegate {
                try { Process.Start("http://localhost:8001/devices-ui?role=host"); } catch { }
            };
            this.Controls.Add(btnOpen);

            Button btnCopy = new Button();
            btnCopy.Text = "📋 Copy Logs";
            btnCopy.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnCopy.BackColor = Color.FromArgb(51, 65, 85);
            btnCopy.ForeColor = Color.White;
            btnCopy.FlatStyle = FlatStyle.Flat;
            btnCopy.FlatAppearance.BorderSize = 0;
            btnCopy.Location = new Point(186, 120);
            btnCopy.Size = new Size(140, 38);
            btnCopy.Cursor = Cursors.Hand;
            btnCopy.Click += delegate {
                try {
                    if (!string.IsNullOrEmpty(txtLogs.Text))
                    {
                        Clipboard.SetText(txtLogs.Text);
                        MessageBox.Show("Logs copied to clipboard!", "File Transfer Fast", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                } catch { }
            };
            this.Controls.Add(btnCopy);

            Button btnStop = new Button();
            btnStop.Text = "🛑 Stop && Exit";
            btnStop.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnStop.BackColor = Color.FromArgb(220, 38, 38);
            btnStop.ForeColor = Color.White;
            btnStop.FlatStyle = FlatStyle.Flat;
            btnStop.FlatAppearance.BorderSize = 0;
            btnStop.Location = new Point(334, 120);
            btnStop.Size = new Size(166, 38);
            btnStop.Cursor = Cursors.Hand;
            btnStop.Click += delegate {
                this.Close();
            };
            this.Controls.Add(btnStop);

            Label lblLogTitle = new Label();
            lblLogTitle.Text = "Live Engine Console Output:";
            lblLogTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            lblLogTitle.ForeColor = Color.FromArgb(148, 163, 184);
            lblLogTitle.Location = new Point(18, 168);
            lblLogTitle.AutoSize = true;
            this.Controls.Add(lblLogTitle);

            txtLogs = new TextBox();
            txtLogs.Multiline = true;
            txtLogs.ReadOnly = true;
            txtLogs.ScrollBars = ScrollBars.Vertical;
            txtLogs.BackColor = Color.FromArgb(10, 15, 29);
            txtLogs.ForeColor = Color.FromArgb(226, 232, 240);
            txtLogs.Font = new Font("Consolas", 8.5f);
            txtLogs.Location = new Point(18, 192);
            txtLogs.Size = new Size(484, 255);
            txtLogs.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtLogs);

            Label lblHint = new Label();
            lblHint.Text = "Tip: Logs are also saved to engine.log in the application directory.";
            lblHint.Font = new Font("Segoe UI", 8, FontStyle.Italic);
            lblHint.ForeColor = Color.FromArgb(100, 116, 139);
            lblHint.Location = new Point(18, 455);
            lblHint.AutoSize = true;
            this.Controls.Add(lblHint);
        }

        public void AppendLog(string msg)
        {
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action<string>(AppendLog), msg); } catch { }
                return;
            }
            if (txtLogs != null && !txtLogs.IsDisposed)
            {
                txtLogs.AppendText(msg + Environment.NewLine);
            }
        }
    }
}
