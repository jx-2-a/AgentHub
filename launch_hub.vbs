' AgentHub launcher - runs AgentHub.exe (hidden, no window to close).
' Task Manager shows "AgentHub" (its own exe name) - robust AND labeled.
' AgentHub.exe spawns the hub (python), which spawns gotify; all grouped under it.
' Used by start.bat and the autostart vbs.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & dir & "\AgentHub.exe""", 0, False
