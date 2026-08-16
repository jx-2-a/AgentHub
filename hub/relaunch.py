"""Hub 重启助手 —— 独立进程:等旧 hub 释放端口后以相同参数拉起新 hub。

由 /api/system/restart 以 DETACHED 方式 spawn(旧 hub 只 os._exit 自己,不杀整树,
所以本进程能活到拉起新 hub)。用法: python -m hub.relaunch <port> <bind> <data>
"""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def main():
    port = int(sys.argv[1])
    bind = sys.argv[2]
    data = sys.argv[3]
    # 等旧 hub 退出(端口释放),最多 30s
    waited = 0
    while waited < 30 and not _port_free(port):
        time.sleep(1)
        waited += 1
    log = open(_ROOT / "data" / "hub.log", "a", encoding="utf-8")
    cmd = [sys.executable, "-m", "hub.launch",
           "--port", str(port), "--bind", bind, "--data", data]
    subprocess.Popen(
        cmd, cwd=str(_ROOT), stdout=log, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


if __name__ == "__main__":
    main()
