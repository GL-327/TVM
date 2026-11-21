// TVM.exe: a single-file installer and launcher for the Windows desktop client.
//
// The first run unpacks the embedded desktop package (native renderer, artwork,
// shared Core, UI and Node runtime) into %LOCALAPPDATA%\Programs\TVM. It then
// adds Start menu and Desktop shortcuts and an Apps & features entry, and opens
// TVM. Later runs open the installed copy, or update it when this file carries
// a newer build. No administrator rights are needed.
//
// Account data and mpv live in %LOCALAPPDATA%\TVM, so updating or removing the
// program folder never touches them.
//
// Built by build-setup.ps1 with the .NET Framework compiler that ships with
// Windows (C# 5), so keep the syntax C# 5 compatible.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("TVM")]
[assembly: AssemblyProduct("TVM")]
[assembly: AssemblyDescription("Installs and opens TVM")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Setup
{
    const string AppName = "TVM";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\TVM";
    static string testRoot;

    static string InstallDir
    {
        get
        {
            if (testRoot != null) return testRoot;
            return Path.Combine(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), AppName);
        }
    }

    static string AppExe { get { return Path.Combine(InstallDir, "tvm.exe"); } }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool reinstall = false;
        bool installOnly = false;
        try
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--reinstall", StringComparison.OrdinalIgnoreCase)) reinstall = true;
                if (string.Equals(a, "--install-only", StringComparison.OrdinalIgnoreCase)) installOnly = true;
                // Hidden, test-only: never inspect/close processes, integrate with
                // Windows, or launch TVM. Keep the same progress UI and swap path.
                if (string.Equals(a, "--root", StringComparison.OrdinalIgnoreCase))
                {
                    if (testRoot != null) throw new ArgumentException("Specify --root only once.");
                    if (++i == args.Length) throw new ArgumentException("--root needs a test directory.");
                    string normalRoot = Path.GetFullPath(InstallDir);
                    string candidate = Path.GetFullPath(args[i]).TrimEnd('\\', '/');
                    if (!Path.IsPathRooted(args[i]) || candidate.Length <= Path.GetPathRoot(candidate).Length ||
                        candidate.Equals(normalRoot, StringComparison.OrdinalIgnoreCase))
                        throw new ArgumentException("--root needs an absolute test directory, separate from the real install.");
                    testRoot = candidate;
                }
            }
            bool created;
            string mutexName = @"Local\TVM-Setup";
            if (testRoot != null)
            {
                using (System.Security.Cryptography.SHA256 hash = System.Security.Cryptography.SHA256.Create())
                    mutexName += "-Test-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(testRoot.ToUpperInvariant()))).Replace("-", "");
            }
            using (Mutex mutex = new Mutex(true, mutexName, out created))
            {
                // A second double-click while installing does nothing; the first one opens TVM.
                if (!created) return 0;
                string payload = ReadResourceText("build.json");
                string installedStamp = Path.Combine(InstallDir, "native-build.json");
                string installed = File.Exists(installedStamp) ? File.ReadAllText(installedStamp) : null;
                bool needed = reinstall || !File.Exists(AppExe) || IsNewer(payload, installed);
                if (needed && !Install(payload, installed == null)) return 1;
                if (!installOnly && testRoot == null) Launch();
                if (testRoot != null) File.WriteAllText(testRoot + ".setup.log", needed ? "Installed successfully" : "Already current");
                return 0;
            }
        }
        catch (Exception e)
        {
            if (testRoot != null)
            {
                File.WriteAllText(testRoot + ".setup.log", e.ToString());
            }
            else
            {
                MessageBox.Show("TVM could not be installed.\n\n" + e.Message, AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return 1;
        }
    }

    // ---- Versions ----------------------------------------------------------

    static string Field(string json, string name)
    {
        if (json == null) return null;
        Match m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"([^\"]*)\"");
        return m.Success ? m.Groups[1].Value : null;
    }

    // Install when the embedded build is newer than the installed one, so this
    // file never rolls back a copy that TVM's own updater has moved forward.
    static bool IsNewer(string payload, string installed)
    {
        if (installed == null) return true;
        // Build time decides, not the commit: local builds of uncommitted work share a commit.
        DateTime a, b;
        bool ok = DateTime.TryParse(Field(payload, "builtAt"), null,
                      System.Globalization.DateTimeStyles.RoundtripKind, out a)
                  & DateTime.TryParse(Field(installed, "builtAt"), null,
                      System.Globalization.DateTimeStyles.RoundtripKind, out b);
        if (ok) return a.ToUniversalTime() > b.ToUniversalTime();
        return Field(payload, "commit") != Field(installed, "commit");
    }

    static Stream Resource(string name)
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (s == null) throw new InvalidOperationException("This TVM download is incomplete (" + name + " is missing).");
        return s;
    }

    static string ReadResourceText(string name)
    {
        using (StreamReader r = new StreamReader(Resource(name), Encoding.UTF8, true)) return r.ReadToEnd();
    }

    // ---- Install -----------------------------------------------------------

    static bool Install(string payloadStamp, bool firstInstall)
    {
        if (testRoot == null && !StopRunningCopy()) return false;

        ProgressForm form = new ProgressForm(firstInstall ? "Installing TVM" : "Updating TVM");
        Exception failure = null;
        Thread worker = new Thread(delegate()
        {
            try
            {
                Unpack(form);
                if (testRoot == null)
                {
                    form.Report(-1, "Adding shortcuts");
                    Integrate(payloadStamp, firstInstall);
                }
            }
            catch (Exception e) { failure = e; }
            finally { form.Finish(); }
        });
        worker.IsBackground = true;
        form.Shown += delegate { worker.Start(); };
        Application.Run(form);
        worker.Join();
        if (failure != null) throw failure;
        return true;
    }

    static void Unpack(ProgressForm form)
    {
        string root = InstallDir;
        string staging = root + ".new";
        string old = root + ".old";
        Directory.CreateDirectory(Path.GetDirectoryName(root));
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        if (Directory.Exists(old)) Directory.Delete(old, true);
        Directory.CreateDirectory(staging);
        try
        {
            using (Stream stream = Resource("payload.lzms")) Payload.Extract(stream, staging, form.Report);
            if (!File.Exists(Path.Combine(staging, "tvm.exe")))
                throw new InvalidDataException("The TVM package has no tvm.exe.");
        }
        catch
        {
            try { Directory.Delete(staging, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            throw;
        }

        // Swap folders so a failed update leaves the previous copy working.
        if (Directory.Exists(root)) Directory.Move(root, old);
        try { Directory.Move(staging, root); }
        catch
        {
            if (!Directory.Exists(root) && Directory.Exists(old)) Directory.Move(old, root);
            throw;
        }
        try { if (Directory.Exists(old)) Directory.Delete(old, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    // ---- Running copies ----------------------------------------------------

    static bool RunsFromInstall(Process p)
    {
        string root = Path.GetFullPath(InstallDir).TrimEnd('\\') + "\\";
        try
        {
            string path = p.MainModule.FileName;
            return path != null && path.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception) { return false; }
    }

    // The TVM window is asked to close, and the user decides if it won't.
    // Core (bin\node.exe) keeps running after the window closes for web and
    // Roku clients. It is stopped so its files can be replaced; the next TVM
    // start brings it back.
    static bool StopRunningCopy()
    {
        while (true)
        {
            bool windowOpen = false;
            foreach (Process p in Process.GetProcessesByName("tvm"))
            {
                if (!RunsFromInstall(p)) continue;
                p.CloseMainWindow();
                if (!p.WaitForExit(8000)) windowOpen = true;
            }
            if (!windowOpen) break;
            DialogResult answer = MessageBox.Show(
                "TVM is open. Close it, then choose Retry to finish updating.", AppName,
                MessageBoxButtons.RetryCancel, MessageBoxIcon.Information);
            if (answer != DialogResult.Retry) return false;
        }
        foreach (Process p in Process.GetProcessesByName("node"))
        {
            if (!RunsFromInstall(p)) continue;
            try { p.Kill(); p.WaitForExit(5000); } catch (Exception) { }
        }
        return true;
    }

    // ---- Shortcuts, Apps & features ----------------------------------------

    static void Integrate(string payloadStamp, bool firstInstall)
    {
        string icon = Path.Combine(InstallDir, @"assets\tvm.ico");
        string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        Shortcut(Path.Combine(programs, "TVM.lnk"), icon);
        // Only the first install adds a Desktop shortcut, so updates respect a deleted one.
        if (firstInstall)
            Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "TVM.lnk"), icon);

        string uninstaller = Path.Combine(InstallDir, "uninstall.ps1");
        File.WriteAllText(uninstaller, UninstallScript(), new UTF8Encoding(true));

        string version = Field(payloadStamp, "version") ?? "1.0.0";
        string commit = Field(payloadStamp, "commit") ?? "";
        if (commit.Length > 7) version += " (" + commit.Substring(0, 7) + ")";
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", AppName);
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", AppName);
            key.SetValue("DisplayIcon", icon);
            key.SetValue("InstallLocation", InstallDir);
            key.SetValue("UninstallString", "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + uninstaller + "\"");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", (int)(FolderBytes(InstallDir) / 1024), RegistryValueKind.DWord);
        }
    }

    static long FolderBytes(string dir)
    {
        long total = 0;
        foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) total += new FileInfo(f).Length;
        return total;
    }

    static void Shortcut(string path, string icon)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try
        {
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
            Type t = link.GetType();
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { AppExe });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { InstallDir });
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { icon + ",0" });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Open TVM" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    }

    // Removes the program folder, shortcuts that point into it and the Apps &
    // features entry. Account data in %LOCALAPPDATA%\TVM stays.
    static string UninstallScript()
    {
        string dir = InstallDir.Replace("'", "''");
        return string.Join("\r\n", new string[] {
            "# Written by the TVM installer. Removes the program, keeps your TVM data.",
            "$ErrorActionPreference = 'SilentlyContinue'",
            "$dir = '" + dir + "'",
            "Set-Location -LiteralPath $env:TEMP",
            "Get-Process tvm, node | Where-Object { $_.Path -and $_.Path.StartsWith($dir + '\\', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force",
            "Start-Sleep -Milliseconds 800",
            "$shell = New-Object -ComObject WScript.Shell",
            "foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {",
            "  $lnk = Join-Path $folder 'TVM.lnk'",
            "  if ((Test-Path -LiteralPath $lnk) -and $shell.CreateShortcut($lnk).TargetPath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $lnk -Force }",
            "}",
            "Remove-Item -LiteralPath 'HKCU:\\" + UninstallKey + "' -Recurse -Force",
            "Remove-Item -LiteralPath $dir -Recurse -Force",
            "Add-Type -AssemblyName System.Windows.Forms",
            "[void][System.Windows.Forms.MessageBox]::Show('TVM was removed. Your accounts and settings are kept in ' + (Join-Path $env:LOCALAPPDATA 'TVM') + '.', 'TVM')",
            ""
        });
    }

    // ---- Launch ------------------------------------------------------------

    static void Launch()
    {
        ProcessStartInfo info = new ProcessStartInfo(AppExe);
        info.WorkingDirectory = InstallDir;
        info.UseShellExecute = false;
        Process.Start(info);
    }
}

// A small dark window with the TVM mark, a status line and a progress bar.
sealed class ProgressForm : Form
{
    readonly Label status;
    readonly ProgressBar bar;

    public ProgressForm(string title)
    {
        // Layout is in 96-DPI pixels; the manifest makes the process DPI aware, so scale it.
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "TVM";
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 168);
        BackColor = Color.FromArgb(18, 20, 26);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

        PictureBox mark = new PictureBox();
        mark.Bounds = new Rectangle(28, 30, 56, 56);
        mark.SizeMode = PictureBoxSizeMode.Zoom;
        try { mark.Image = Icon.ExtractAssociatedIcon(Application.ExecutablePath).ToBitmap(); } catch (Exception) { }
        Controls.Add(mark);

        Label heading = new Label();
        heading.Text = title;
        heading.Font = new Font("Segoe UI Semibold", 15f);
        heading.AutoSize = true;
        heading.Location = new Point(100, 30);
        Controls.Add(heading);

        status = new Label();
        status.Text = "Preparing";
        status.ForeColor = Color.FromArgb(178, 186, 200);
        status.AutoSize = false;
        status.Bounds = new Rectangle(102, 64, 330, 22);
        Controls.Add(status);

        bar = new ProgressBar();
        bar.Bounds = new Rectangle(28, 112, 404, 10);
        bar.Style = ProgressBarStyle.Continuous;
        Controls.Add(bar);
        ResumeLayout(false);
    }

    // Closing mid-install would leave a half-unpacked folder; the swap makes it harmless, but keep it simple.
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !finished) e.Cancel = true;
        base.OnFormClosing(e);
    }

    volatile bool finished;

    public void Report(int percent, string text)
    {
        if (!IsHandleCreated) return;
        BeginInvoke((MethodInvoker)delegate
        {
            if (percent < 0) bar.Style = ProgressBarStyle.Marquee;
            else { bar.Style = ProgressBarStyle.Continuous; bar.Value = Math.Min(100, percent); }
            status.Text = text;
        });
    }

    public void Finish()
    {
        finished = true;
        if (!IsHandleCreated) return;
        BeginInvoke((MethodInvoker)delegate { Close(); });
    }
}
