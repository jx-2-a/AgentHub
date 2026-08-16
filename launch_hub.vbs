' AgentHub hidden launcher.
' Runs hub_run.bat in a HIDDEN console window: no black box on screen,
' but the hub still has a real console so terminal/ttyd keep working.
' Used by start.bat and the autostart shortcut.
' NOTE: use the ABSOLUTE batch path - WScript.Shell.Run does not reliably
' resolve a relative .bat against CurrentDirectory.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdline = "cmd.exe /c """ & dir & "\hub_run.bat"""
sh.Run cmdline, 0, False
