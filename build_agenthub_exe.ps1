# build_agenthub_exe.ps1
# 编译 AgentHub.exe(包装器):嵌入 favicon 图标 + Job Object + hub 循环拉起。
# NOTE: C# 注释必须纯 ASCII(脚本按 ASCII 写临时 .cs,中文会乱码破坏代码)。
#
# 用法:  powershell -NoProfile -ExecutionPolicy Bypass -File build_agenthub_exe.ps1

$ErrorActionPreference = 'Stop'
$root = 'D:\DsEdit\AgentHub'

$cs = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentHubLauncher {
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOB_BASIC {
    public long t1, t2;
    public uint flags;
    public UIntPtr minws, maxws;
    public uint active;
    public UIntPtr aff;
    public uint prio, sched;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOB_EXT {
    public JOB_BASIC basic;
    public IO_COUNTERS io;
    public UIntPtr pmem, jmem, ppeak, jpeak;
  }
  const uint KILL_ON_CLOSE = 0x2000;
  const int JOB_EXT_INFO = 9;

  public static int Main(string[] args) {
    string root = @"D:\DsEdit\AgentHub";
    string basePy = @"C:\Users\JinXi\AppData\Local\Python\pythoncore-3.14-64\python.exe";
    string site = @"D:\PyVenv\AgentHub\.venv\Lib\site-packages";
    string gotify = @"D:\DsEdit\AgentHub\gotify\gotify-windows-amd64.exe";
    try { var l = new TcpListener(System.Net.IPAddress.Any, 8500); l.Start(); l.Stop(); }
    catch { return 0; }
    Directory.CreateDirectory(Path.Combine(root, "data"));
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job != IntPtr.Zero) {
      var ext = new JOB_EXT();
      ext.basic.flags = KILL_ON_CLOSE;
      int sz = Marshal.SizeOf(typeof(JOB_EXT));
      IntPtr mem = Marshal.AllocHGlobal(sz);
      Marshal.StructureToPtr(ext, mem, false);
      SetInformationJobObject(job, JOB_EXT_INFO, mem, (uint)sz);
      Marshal.FreeHGlobal(mem);
    }
    // gotify: spawned once, lives with AgentHub (survives hub restarts)
    if (File.Exists(gotify)) {
      var gp = new ProcessStartInfo {
        FileName = gotify,
        WorkingDirectory = Path.Combine(root, "gotify"),
        UseShellExecute = false,
        CreateNoWindow = true,
      };
      try {
        var g = Process.Start(gp);
        if (job != IntPtr.Zero) AssignProcessToJobObject(job, g.Handle);
      } catch { }
    }
    // hub loop: respawn on exit (restart = hub exits -> respawn here; kill AgentHub = job close -> all die).
    // output forwarding is guarded so a killed hub cannot crash the wrapper via a disposed writer.
    string wlog = Path.Combine(root, "data", "wrapper.log");
    try { File.AppendAllText(wlog, "wrapper start\n"); } catch { }
    while (true) {
      Process p;
      try {
        try { File.AppendAllText(wlog, "spawning hub\n"); } catch { }
        var psi = new ProcessStartInfo {
          FileName = basePy,
          Arguments = "-m hub.launch --port 8500 --bind 0.0.0.0 --data data",
          WorkingDirectory = root,
          UseShellExecute = false,
          CreateNoWindow = true,
          RedirectStandardOutput = true,
          RedirectStandardError = true,
        };
        psi.EnvironmentVariables["PYTHONPATH"] = site;
        psi.EnvironmentVariables["AGENTHUB_WRAPPER"] = "1";
        p = Process.Start(psi);
        if (job != IntPtr.Zero) AssignProcessToJobObject(job, p.Handle);
        using (var sw = new StreamWriter(Path.Combine(root, "data", "hub.log"), true, Encoding.UTF8) { AutoFlush = true }) {
          var safeSw = sw;
          p.OutputDataReceived += (s, e) => { try { if (e.Data != null) safeSw.WriteLine(e.Data); } catch { } };
          p.ErrorDataReceived += (s, e) => { try { if (e.Data != null) safeSw.WriteLine(e.Data); } catch { } };
          p.BeginOutputReadLine();
          p.BeginErrorReadLine();
          p.WaitForExit();
          try { p.CancelOutputRead(); } catch { }
        }
      } catch {
        // single spawn failure: sleep and retry, do not crash
      }
      try { File.AppendAllText(wlog, "hub exited, respawning\n"); } catch { }
      System.Threading.Thread.Sleep(1500); // avoid crash storm
    }
  }
}
'@

$csFile = Join-Path $env:TEMP 'AgentHubLauncher.cs'
[System.IO.File]::WriteAllText($csFile, $cs, [System.Text.Encoding]::ASCII)

$csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }

# winexe = GUI 子系统:双击无黑框;嵌入图标 + 检查 csc 退出码(失败不再误报 OK)
& $csc /nologo /target:winexe "/win32icon:$root\favicon.ico" "/out:$root\AgentHub.exe" $csFile
if ($LASTEXITCODE -ne 0) { throw "csc compile failed (exit $LASTEXITCODE)" }

Write-Host "[OK] AgentHub.exe compiled (icon + Job Object + hub loop)"
