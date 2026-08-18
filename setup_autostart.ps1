# setup_autostart.ps1
# 开启 AgentHub 开机自启(登录后直接运行 AgentHub.exe - GUI 子系统,无窗口无黑框)。
# 在用户 Startup 文件夹创建指向 AgentHub.exe 的快捷方式。
#
# 用法:  powershell -NoProfile -ExecutionPolicy Bypass -File setup_autostart.ps1
# 关闭:  删除启动文件夹里的 AgentHub.lnk

$ErrorActionPreference = 'Stop'

$exe = 'D:\DsEdit\AgentHub\AgentHub.exe'
if (-not (Test-Path $exe)) {
    Write-Host "[ERROR] $exe not found - run build_agenthub_exe.ps1 first" -ForegroundColor Red
    exit 1
}

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'AgentHub.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath       = $exe
$s.WorkingDirectory = 'D:\DsEdit\AgentHub'
$s.IconLocation     = $exe
$s.Description      = 'AgentHub 自启'
$s.Save()

Write-Host "[OK] AgentHub 自启已开启:" -ForegroundColor Green
Write-Host "     快捷方式 : $lnk"
Write-Host "     启动目标 : $exe"
Write-Host ""
Write-Host "下次登录 Windows 时 AgentHub 将直接启动(无窗口),拉起 hub + Gotify。"
Write-Host "关闭自启: 删除 $lnk"
