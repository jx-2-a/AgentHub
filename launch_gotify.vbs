' Gotify server hidden launcher (called by hub_run.bat at autostart).
' Runs gotify-windows-amd64.exe in a HIDDEN window (no black box).
' Gotify listens on port 80; data lives in gotify\data\.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\gotify\gotify-windows-amd64.exe"
sh.CurrentDirectory = dir & "\gotify"
sh.Run """" & exe & """", 0, False
