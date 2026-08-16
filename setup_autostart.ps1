# setup_autostart.ps1
# 开启 AgentHub 开机自启（Windows 登录后启动，隐藏窗口无黑框）。
# 在用户 Startup 文件夹创建指向 launch_hub.vbs 的快捷方式。
#
# 用法:  powershell -NoProfile -ExecutionPolicy Bypass -File setup_autostart.ps1
# 关闭:  删除下面打印的快捷方式即可。

$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$vbs  = Join-Path $repo 'launch_hub.vbs'
if (-not (Test-Path $vbs)) {
    Write-Host "[ERROR] launch_hub.vbs not found in $repo" -ForegroundColor Red
    exit 1
}

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'AgentHub.lnk'

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath       = $vbs
$sc.WorkingDirectory = $repo
$sc.Description      = 'AgentHub - 隐藏后台自启'
$sc.Save()

Write-Host "[OK] AgentHub 自启已开启:" -ForegroundColor Green
Write-Host "     快捷方式 : $lnk"
Write-Host "     启动目标 : $vbs"
Write-Host ""
Write-Host "下次登录 Windows 时 AgentHub 将以隐藏窗口启动（无黑框）。"
Write-Host "关闭自启: 删除上面的快捷方式。"
