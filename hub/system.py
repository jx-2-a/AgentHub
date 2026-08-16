"""系统能力:电脑状态(Tailscale/VPN/网络/内存/CPU/磁盘/进程)+ 系统工具。

数据全部来自本机,Windows-only(psutil + tailscale CLI + powershell)。
UI 在 /system 页(设置 → 控制 → 电脑状态)。与终端不同,这里不做 token 鉴权,
Tailscale 作为访问边界。
"""
import ctypes
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path
from typing import Optional

import psutil


# ============================================================================
# Tailscale
# ============================================================================

_TAILSCALE_PATHS = [
    r"D:\Tailscale\tailscale.exe",
    r"C:\Program Files\Tailscale\tailscale.exe",
    r"C:\Program Files (x86)\Tailscale\tailscale.exe",
]
_tailscale_cache: Optional[tuple] = None  # (timestamp, payload), 5s TTL
_tailscale_exe: Optional[str] = None


def _find_tailscale() -> Optional[str]:
    global _tailscale_exe
    if _tailscale_exe:
        return _tailscale_exe
    found = shutil.which("tailscale")
    if found:
        _tailscale_exe = found
        return found
    for p in _TAILSCALE_PATHS:
        if os.path.isfile(p):
            _tailscale_exe = p
            return p
    return None


def _run_tailscale(args: list[str], timeout: int = 12) -> tuple[int, str]:
    exe = _find_tailscale()
    if not exe:
        return -1, "tailscale CLI 未找到"
    try:
        r = subprocess.run(
            [exe, *args],
            capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return r.returncode, (r.stdout or "").strip() + (
            ("\n" + r.stderr.strip()) if r.stderr.strip() else "")
    except subprocess.TimeoutExpired:
        return -1, "tailscale 命令超时"
    except Exception as e:
        return -1, str(e)


def invalidate_tailscale_cache():
    global _tailscale_cache
    _tailscale_cache = None


def tailscale_status() -> dict:
    """Tailscale 连接状态(5s 缓存,避免每轮刷新都拉起进程)。"""
    global _tailscale_cache
    now = time.time()
    if _tailscale_cache and now - _tailscale_cache[0] < 5:
        return _tailscale_cache[1]
    if not _find_tailscale():
        payload = {"available": False, "reason": "未找到 tailscale CLI"}
        _tailscale_cache = (now, payload)
        return payload
    out = {
        "available": True, "state": "unknown", "online": False,
        "hostname": "", "ips": [], "self_ip": "", "exit_node": None,
    }
    code, text = _run_tailscale(["status", "--json"])
    if code != 0:
        out["state"] = "Stopped"
        _tailscale_cache = (now, out)
        return out
    try:
        d = json.loads(text)
    except Exception:
        _tailscale_cache = (now, out)
        return out
    out["state"] = d.get("BackendState") or "unknown"
    self_ = d.get("Self") or {}
    out["online"] = bool(self_.get("Online"))
    out["hostname"] = (self_.get("DNSName") or "").rstrip(".")
    out["ips"] = self_.get("TailscaleIPs") or []
    v4 = [i for i in out["ips"] if ":" not in i]
    out["self_ip"] = v4[0] if v4 else ""
    es = d.get("ExitNodeStatus") or {}
    if es.get("Online"):
        out["exit_node"] = {"hostname": es.get("HostName") or "",
                            "active": bool(es.get("ActiveExit"))}
    _tailscale_cache = (now, out)
    return out


def tailscale_action(action: str) -> tuple[int, str]:
    invalidate_tailscale_cache()
    return _run_tailscale([action])


# ============================================================================
# Windows 内置 VPN
# ============================================================================

def vpn_profiles() -> list[dict]:
    """列出 Windows 内置 VPN 配置及连接状态。"""
    ps = (
        "$ErrorActionPreference='Stop'; "
        "Get-VpnConnection | Select-Object Name, ServerAddress, TunnelType, ConnectionStatus "
        "| ConvertTo-Json -Compress"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, encoding="utf-8", errors="replace", timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return []
    if r.returncode != 0 or not r.stdout.strip():
        return []
    try:
        data = json.loads(r.stdout)
    except Exception:
        return []
    if isinstance(data, dict):
        data = [data]
    out = []
    for p in data:
        out.append({
            "name": p.get("Name", ""),
            "server": p.get("ServerAddress", ""),
            "tunnel": p.get("TunnelType", ""),
            "connected": p.get("ConnectionStatus") == "Connected",
        })
    return out


def _run_rasdial(args: list[str], timeout: int) -> dict:
    try:
        r = subprocess.run(
            ["rasdial", *args], capture_output=True, timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as e:
        return {"ok": False, "detail": str(e)}
    out = (r.stdout or b"").decode("gbk", errors="replace").strip()
    if r.returncode == 0:
        return {"ok": True, "detail": out or f"rc={r.returncode}"}
    return {"ok": False, "detail": out or f"rasdial 失败 (rc={r.returncode})"}


def _open_vpn_settings() -> dict:
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "", "ms-settings:network-vpn"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return {"ok": True, "detail": "已打开 Windows VPN 设置页,请在页面上点击「连接」"}
    except Exception as e:
        return {"ok": False, "detail": f"打开设置页失败: {e}"}


_VPN_UIA_SCRIPT = Path(__file__).resolve().parent / "vpn_uia.ps1"


def _vpn_connect_uia(name: str) -> dict:
    """用 UI Automation 在 Windows VPN 设置页自动点「连接」,失败退回打开设置页。"""
    script = _VPN_UIA_SCRIPT
    if not script.is_file():
        return _open_vpn_settings()
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", str(script), "-Action", "connect"],
            capture_output=True, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as e:
        return {"ok": False, "detail": f"自动连接失败: {e}"}
    out = (r.stdout or b"").decode("utf-8", errors="replace").strip()
    if "INVOKED" in out:
        return {"ok": True, "detail": "已自动点击「连接」,等待 VPN 建立连接…"}
    if "ALREADY_CONNECTED" in out:
        return {"ok": True, "detail": "VPN 已处于连接状态"}
    return _open_vpn_settings()


def vpn_action(name: str, connect: bool) -> dict:
    """连接/断开内置 VPN。断开走 rasdial;连接走 UIA 自动点,失败退回设置页。"""
    if not connect:
        return _run_rasdial([name, "/d"], timeout=30)
    return _vpn_connect_uia(name)


# ============================================================================
# 网络适配器
# ============================================================================

_VPN_KEYWORDS = (
    "tailscale", "radmin", "vpn", "openvpn", "wireguard", "zerotier",
    "hamachi", "nord", "anyconnect", "forti", "wintun", "tap", "utun",
)
_VPN_NOTES = (
    ("tailscale", "局域网"),
    ("radmin", "游戏"),
    ("ust", "学校"),
    ("openvpn", "OpenVPN"),
    ("wireguard", "WireGuard"),
    ("zerotier", "ZeroTier"),
    ("hamachi", "Hamachi"),
)


def _is_vpn(name: str) -> bool:
    n = name.lower()
    return any(k in n for k in _VPN_KEYWORDS)


def _vpn_note(name: str) -> str:
    n = name.lower()
    for key, note in _VPN_NOTES:
        if key in n:
            return note
    return ""


def list_adapters() -> list[dict]:
    addrs = psutil.net_if_addrs()
    out = []
    for nic, st in psutil.net_if_stats().items():
        ipv4 = [a.address for a in addrs.get(nic, []) if a.family == socket.AF_INET]
        is_vpn = _is_vpn(nic)
        out.append({
            "name": nic, "up": bool(st.isup), "speed": st.speed,
            "ipv4": ipv4, "vpn": is_vpn, "note": _vpn_note(nic) if is_vpn else "",
        })
    out.sort(key=lambda a: (not a["vpn"], not a["up"]))
    return out


# ============================================================================
# 内存释放(EmptyWorkingSet)
# ============================================================================

_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_psapi = ctypes.WinDLL("psapi", use_last_error=True)
_PROCESS_QUERY_INFORMATION = 0x0400
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_PROCESS_SET_QUOTA = 0x0100
_psapi.EmptyWorkingSet.argtypes = [wintypes.HANDLE]
_psapi.EmptyWorkingSet.restype = wintypes.BOOL
_kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
_kernel32.OpenProcess.restype = wintypes.HANDLE
_kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel32.CloseHandle.restype = wintypes.BOOL


def free_memory() -> dict:
    """对所有可访问进程 EmptyWorkingSet,返回释放前后可用内存。"""
    before = psutil.virtual_memory().available
    n = 0
    for p in psutil.process_iter(["pid"]):
        try:
            h = _kernel32.OpenProcess(
                _PROCESS_QUERY_LIMITED_INFORMATION | _PROCESS_SET_QUOTA | _PROCESS_QUERY_INFORMATION,
                False, p.info["pid"])
        except Exception:
            continue
        if not h:
            continue
        try:
            if _psapi.EmptyWorkingSet(h):
                n += 1
        except Exception:
            pass
        finally:
            _kernel32.CloseHandle(h)
    after = psutil.virtual_memory().available
    return {
        "before_gb": round(before / 1e9, 2),
        "after_gb": round(after / 1e9, 2),
        "freed_gb": round(max(0, after - before) / 1e9, 2),
        "processes": n,
    }


# ============================================================================
# 进程 / 磁盘 / 主机
# ============================================================================

def process_report(known: list[dict]) -> list[dict]:
    """只统计与本服务相关的进程(调用方给出 pid+角色),附加 CPU/内存。

    known 项:{pid, name, role} → 附加 cpu/mem;已退出/无权限则跳过。
    """
    out = []
    for k in known:
        try:
            p = psutil.Process(k["pid"])
            with p.oneshot():
                cpu = p.cpu_percent(interval=0.1)
                mem = p.memory_info().rss / 1024 / 1024
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        out.append({
            "pid": k["pid"],
            "name": k.get("name", p.name()),
            "role": k.get("role", ""),
            "cpu": round(cpu, 1),
            "mem_mb": round(mem, 1),
        })
    out.sort(key=lambda x: x["mem_mb"], reverse=True)
    return out


def _disk(path: str) -> dict | None:
    try:
        d = psutil.disk_usage(path)
    except Exception:
        return None
    return {
        "used_gb": round(d.used / 1e9, 2),
        "free_gb": round(d.free / 1e9, 2),
        "total_gb": round(d.total / 1e9, 2),
        "percent": d.percent,
    }


def open_folder(path: str) -> dict:
    """在资源管理器打开一个本地目录(工具按钮用)。"""
    p = Path(path)
    if not p.is_dir():
        return {"ok": False, "detail": "目录不存在"}
    try:
        subprocess.Popen(["explorer", str(p)])
        return {"ok": True, "detail": str(p)}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


# ============================================================================
# 汇总
# ============================================================================

_HUB_ROOT = Path(__file__).resolve().parent.parent


def get_system_report(known_procs: list[dict] | None = None) -> dict:
    """电脑状态汇总。known_procs 由调用方给出本服务相关进程(Hub/Agent/终端)。"""
    vm = psutil.virtual_memory()
    hub = psutil.Process(os.getpid())
    cpu = psutil.cpu_percent(interval=0.3)
    file_root = os.environ.get("FILE_ROOT", "").strip() or str(_HUB_ROOT.parent)
    return {
        "mem": {
            "used_gb": round(vm.used / 1e9, 2),
            "avail_gb": round(vm.available / 1e9, 2),
            "total_gb": round(vm.total / 1e9, 2),
            "percent": vm.percent,
        },
        "cpu": {"percent": cpu, "cores": psutil.cpu_count() or 0},
        "disk": _disk(file_root),
        "tailscale": tailscale_status(),
        "vpn_profiles": vpn_profiles(),
        "processes": process_report(known_procs or []),
        "host": {
            "hostname": socket.gethostname(),
            "uptime_sec": int(time.time() - psutil.boot_time()),
            "python": ".".join(str(v) for v in sys.version_info[:3]),
            "hub": {
                "pid": hub.pid,
                "started": datetime.fromtimestamp(hub.create_time()).strftime("%Y-%m-%d %H:%M:%S"),
                "mem_mb": round(hub.memory_info().rss / 1024 / 1024, 1),
            },
        },
        "paths": {"file_root": file_root, "data_dir": str(_HUB_ROOT / "data")},
    }
