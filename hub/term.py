"""Web 终端:经 hub 代理 ttyd(保底 shell),SHELL_TOKEN 鉴权。

只有进终端需要 SHELL_TOKEN,其余接口免登录。

会话持久化:hub 自己持有一条到 ttyd 的 WS,即使浏览器断线,shell 也继续运行;
输出进入环形缓冲,新连接/重连先回放缓冲再实时推送 → 手机上切走再回来不丢。
ttyd 协议:首帧 init 是 JSON(文本帧);之后二进制帧首字节是 ASCII 字符码:
客户端 '0'=输入 / '1'=resize / '2'=paste / '3'=resume;服务端 '0'=输出。
init 只转发给 ttyd 一次,重连的 init 直接丢弃。
"""
import asyncio
import collections
import os
import socket
import subprocess
import threading
from pathlib import Path

import aiohttp
from aiohttp import web

_ROOT = Path(__file__).resolve().parent.parent
_PORT_RANGE = range(9000, 9100)
_BUF_MAX = 400  # 回放缓冲的最大输出块数(够手机切走再回来)
_IDLE_TIMEOUT = 15 * 60  # 无任何浏览器查看 15 分钟后自动停(防泄漏)


def _env(key, default=""):
    return os.getenv(key, default).strip()


SHELL_TOKEN = _env("SHELL_TOKEN")
TTYD_PATH = _env("TTYD_PATH", "ttyd")
SHELL_CMD = _env("SHELL_CMD", "cmd.exe")

_terms = {}            # term_id -> {"port","proc"}
_sessions = {}         # term_id -> TtydSession
_lock = threading.Lock()
_used_ports = set()
_counter = 0


class TtydSession:
    """一条持久的 ttyd WS 会话:hub 保活,输出广播给所有 viewer 并进缓冲。"""

    def __init__(self, term_id: str, port: int):
        self.term_id = term_id
        self.port = port
        self.buf = collections.deque(maxlen=_BUF_MAX)
        self.viewers = set()          # 浏览器 WS
        self._q: asyncio.Queue = asyncio.Queue()   # 项:(is_text, data),None 为退出哨兵
        self.initialized = False      # ttyd init JSON 是否已转发
        self._task: asyncio.Task | None = None

    def enqueue(self, is_text: bool, data):
        """投递一条发往 ttyd 的消息;init JSON 需保持文本帧。"""
        try:
            self._q.put_nowait((is_text, data))
        except Exception:
            pass

    async def _pump(self, tws):
        """ttyd → 缓冲 + 广播给所有 viewer。"""
        async for msg in tws:
            if msg.type == aiohttp.WSMsgType.BINARY:
                data = bytes(msg.data)
            elif msg.type == aiohttp.WSMsgType.TEXT:
                data = msg.data.encode()
            else:
                break
            self.buf.append(data)
            dead = []
            for v in list(self.viewers):
                try:
                    await v.send_bytes(data)
                except Exception:
                    dead.append(v)
            for v in dead:
                self.viewers.discard(v)

    async def _drain(self, tws):
        """viewer → ttyd(None 退出哨兵)。"""
        while True:
            item = await self._q.get()
            if item is None:
                break
            is_text, data = item
            if is_text:
                await tws.send_str(data)
            else:
                await tws.send_bytes(data)

    async def _idle(self):
        """无浏览器查看超过阈值就退出会话(防 ttyd 泄漏)。"""
        while True:
            await asyncio.sleep(_IDLE_TIMEOUT)
            if not self.viewers:
                try:
                    self._q.put_nowait(None)
                except Exception:
                    pass
                break

    async def run(self):
        url = f"http://127.0.0.1:{self.port}/ws"
        try:
            async with aiohttp.ClientSession() as sess:
                # ttyd 要求 'tty' 子协议,否则连接不产生输出
                async with sess.ws_connect(url, heartbeat=30, protocols=["tty"]) as tws:
                    tasks = [
                        asyncio.create_task(self._pump(tws)),
                        asyncio.create_task(self._drain(tws)),
                        asyncio.create_task(self._idle()),
                    ]
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for p in pending:
                        p.cancel()
        except Exception:
            pass
        finally:
            await asyncio.to_thread(_cleanup, self.term_id)


def terminal_enabled() -> bool:
    return bool(SHELL_TOKEN)


def check_token(token) -> bool:
    return bool(SHELL_TOKEN) and token == SHELL_TOKEN


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def _alloc_port() -> int:
    with _lock:
        for port in _PORT_RANGE:
            if port not in _used_ports and _port_free(port):
                _used_ports.add(port)
                return port
    raise ValueError("无可用端口")


def start_terminal() -> tuple[str, int]:
    """拉起一个 ttyd 系统 shell,返回 (term_id, port)。"""
    global _counter
    port = _alloc_port()
    with _lock:
        _counter += 1
        term_id = str(_counter)
    cmdline = [TTYD_PATH, "-p", str(port), "-W", "-w", str(_ROOT), *SHELL_CMD.split()]
    try:
        proc = subprocess.Popen(cmdline, cwd=str(_ROOT))
    except Exception as e:
        with _lock:
            _used_ports.discard(port)
        raise ValueError(f"ttyd 启动失败({TTYD_PATH}): {e}")
    with _lock:
        _terms[term_id] = {"port": port, "proc": proc}
    sess = TtydSession(term_id, port)
    _sessions[term_id] = sess
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        sess._task = loop.create_task(sess.run())
    else:
        threading.Thread(target=_run_session_in_thread, args=(sess,), daemon=True).start()
    threading.Thread(target=_watch, args=(term_id, proc), daemon=True).start()
    return term_id, port


def _run_session_in_thread(sess: TtydSession):
    try:
        asyncio.run(sess.run())
    except Exception:
        pass


def _watch(term_id: str, proc: subprocess.Popen):
    proc.wait()
    _cleanup(term_id)


def _cleanup(term_id: str):
    with _lock:
        t = _terms.pop(term_id, None)
        _sessions.pop(term_id, None)
    if not t:
        return
    _used_ports.discard(t["port"])
    if t["proc"].poll() is None:
        try:
            subprocess.run(["taskkill", "/PID", str(t["proc"].pid), "/T", "/F"],
                           capture_output=True, timeout=10)
        except Exception:
            pass


def stop_terminal(term_id: str):
    _cleanup(term_id)


async def proxy_terminal(term_id: str, browser_ws) -> bool:
    """挂一个浏览器 viewer 到持久会话。返回是否连接成功。"""
    sess = _sessions.get(term_id)
    if not sess:
        return False
    # 回放最近输出,断线重连不丢历史
    for chunk in sess.buf:
        try:
            await browser_ws.send_bytes(chunk)
        except Exception:
            return True
    sess.viewers.add(browser_ws)
    try:
        async for msg in browser_ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                # init JSON:仅首次连接转发给 ttyd(保持文本帧),重连直接丢弃
                if not sess.initialized:
                    sess.initialized = True
                    sess.enqueue(True, msg.data)
            elif msg.type == aiohttp.WSMsgType.BINARY:
                sess.enqueue(False, bytes(msg.data))
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break
    finally:
        sess.viewers.discard(browser_ws)
    return True
