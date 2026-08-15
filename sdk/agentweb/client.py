"""WebSessionClient — agent 侧接入 AgentHub 的 BaseSession 实现。

把 agent 循环的 I/O（BaseSession 契约）桥到 AgentHub 的 /ws/agent：
- worker 线程调方法 → 事件进队列 → 主线程 aiohttp 发到 Hub。
- Hub 下行（message/ask_answer/interrupt）→ queue/Event，worker 读取。
- 断线自动重连（退避），重连后补发缓冲 + 重发 pending ask。

线程模型与 TuiSession 一致：主线程 run()，agent 循环在工作线程。
"""
import asyncio
import io
import json
import queue
import threading
import time

import aiohttp

from .base import BaseSession


def _renderable_to_text(renderable):
    """rich renderable → 纯文本（无 ANSI）。供 log 事件与 assistant_final 用。"""
    if renderable is None:
        return ""
    # Markdown → 源 markdown（浏览器端渲染，保留格式）
    if hasattr(renderable, "markup"):
        return renderable.markup
    try:
        from rich.console import Console
        buf = io.StringIO()
        Console(file=buf, force_terminal=False, no_color=True,
                soft_wrap=True, highlight=False).print(renderable, end="")
        return buf.getvalue()
    except Exception:
        return str(renderable)


class WebSessionClient(BaseSession):
    """agent 侧 Web 会话：连 AgentHub，把 agent 的 I/O 桥到浏览器。"""

    def __init__(self, hub_url, label="agent", file_roots=None, startup_text="",
                 instance_id=None, resume_sid=None):
        """resume_sid:重启时续接旧会话(与旧会话同 label 且已离线才生效)。"""
        import os as _os
        self._hub_url = hub_url
        self._label = label
        self._file_roots = list(file_roots or [])
        self._startup_text = startup_text
        self._instance_id = instance_id or _os.environ.get("AGENT_HUB_INSTANCE") or None

        self._loop = None
        self._out_q = None
        self._ws = None
        self._sid = resume_sid

        self._pre = []                 # loop/队列就绪前的缓冲事件
        self._pre_lock = threading.Lock()

        self._inbox = queue.Queue()    # 引导输入（普通 message）
        self._pending_ask = None       # (ask_id, prompt, mode)
        self._pending_event = None     # 当前 ask 的唤醒 Event
        self._pending_answer = None
        self._ask_lock = threading.Lock()

        self._interrupt = threading.Event()
        self._done = threading.Event()
        self._seq = 0

        self._partial = ""
        self._stream_active = False
        self._reconnect_delay = 1.0
        self._last_err = None            # 调试：最近一次连接异常
        self._sleep_end = None           # 休眠倒计时绝对时刻(重连时重发剩余秒数)
        self._sleep_text = ""

    # ------------------------------------------------------------------
    # BaseSession 输出（worker 线程）
    # ------------------------------------------------------------------

    def _emit(self, event):
        loop = self._loop
        out_q = self._out_q
        if loop is None or loop.is_closed() or out_q is None:
            with self._pre_lock:
                if len(self._pre) < 2000:      # 长断线期间有界缓冲
                    self._pre.append(event)
            return
        try:
            loop.call_soon_threadsafe(out_q.put_nowait, event)
        except Exception:
            pass

    def render(self, renderable="", newline=True):
        """输出一条系统提示（info 级）。整段作为一条 log 事件，前端一段一气泡。"""
        text = _renderable_to_text(renderable)
        if newline:
            line = self._partial + text
            self._partial = ""
            if line:
                self._emit({"type": "log", "text": line})
        else:
            self._partial += text

    def log(self, text, level="info"):
        """发送一条系统提示，带等级（info|choice|welcome|hint|silent），一段一气泡。

        level="silent" 只落转录记录、不在聊天屏展示(如内部调试信息)。
        """
        if level not in ("info", "choice", "welcome", "hint", "silent"):
            level = "info"
        text = _renderable_to_text(text)
        if text:
            self._emit({"type": "log", "text": text, "level": level})

    def set_status(self, text):
        self._emit({"type": "status", "text": text})

    def stream_delta(self, text):
        self._stream_active = True
        self._emit({"type": "assistant_delta", "content": text})

    def stream_end(self, renderable=None):
        if renderable is not None:
            content = _renderable_to_text(renderable)
            # 非 SSE 回退也可能无流式缓冲 → 一律 assistant_final 全量替换，避免空气泡
            self._emit({"type": "assistant_final", "content": content})
        else:
            self._emit({"type": "assistant_end"})
        self._stream_active = False

    def user_message(self, text, turn=None):
        self._emit({"type": "user", "text": text, "turn": turn})

    def tool_event(self, kind, name, args=None, summary=None, ok=None, verbosity=1, error=None):
        """工具调用事件。kind: "start" | "end"。

        传什么显示什么:args=输入参数, summary=结果, error=错误(前端标红)。
        verbosity 兼容保留、不再门控:想隐藏某字段就传 None。
        """
        if kind == "start":
            self._seq += 1
            ev = {"type": "tool_start", "id": self._seq, "name": name}
            if args is not None:
                ev["args"] = args
            self._emit(ev)
        elif kind == "end":
            ev = {"type": "tool_end", "id": self._seq, "ok": bool(ok)}
            if summary is not None:
                ev["summary"] = summary
            if error is not None:
                ev["error"] = error
            self._emit(ev)

    def seed(self, text):
        if text:
            self._emit({"type": "log", "text": text})

    def thinking_delta(self, text):
        self._emit({"type": "thinking_delta", "content": text})

    def thinking_end(self):
        self._emit({"type": "thinking_end"})

    def send_file(self, path, caption=None):
        ev = {"type": "file", "path": path}
        if caption:
            ev["caption"] = caption
        self._emit(ev)

    def set_meta(self, label=None, project_root=None):
        ev = {"type": "meta"}
        if label:
            ev["label"] = label
        if project_root:
            ev["project_root"] = project_root
        if len(ev) > 1:
            self._emit(ev)

    def sleep_start(self, seconds, text=""):
        """定时/休眠开始:前端显示实时倒计时(seconds=剩余秒数)。"""
        self._sleep_end = time.time() + seconds
        self._sleep_text = text or "自动唤醒"
        self._emit({"type": "sleep_start", "seconds": seconds, "text": self._sleep_text})

    def sleep_end(self):
        """定时/休眠结束。"""
        self._sleep_end = None
        self._sleep_text = ""
        self._emit({"type": "sleep_end"})

    def set_settings(self, settings):
        self._emit({"type": "settings", "settings": settings})

    def on_setting(self, key, value):
        pass   # agent 覆盖此方法应用参数（model/thinking/valve 等）

    def set_prompt(self, text):
        pass

    def supports(self, feature):
        return feature != "term"

    # ------------------------------------------------------------------
    # BaseSession 输入（worker 线程）
    # ------------------------------------------------------------------

    def ask(self, prompt, mode="input"):
        while self._loop is None:
            if self._done.is_set():
                return None
            time.sleep(0.05)
        self._seq += 1
        ask_id = self._seq
        ev = threading.Event()
        with self._ask_lock:
            self._pending_ask = (ask_id, prompt, mode)
            self._pending_event = ev
            self._pending_answer = None
        self._emit({"type": "ask", "id": ask_id, "prompt": prompt, "mode": mode})
        try:
            while True:
                if self._interrupt.is_set():
                    self._interrupt.clear()
                    return None
                if self._done.is_set():
                    return None
                if ev.wait(0.5):
                    return self._pending_answer
        finally:
            with self._ask_lock:
                self._pending_ask = None
                self._pending_event = None
                self._pending_answer = None
            self._emit({"type": "ask_done"})

    def require(self, reason, fields):
        """前提条件表单阻塞请求（独立颜色对话框）。返回 {key: value}；取消/打断返回 None。"""
        while self._loop is None:
            if self._done.is_set():
                return None
            time.sleep(0.05)
        self._seq += 1
        req_id = self._seq
        ev = threading.Event()
        with self._ask_lock:
            self._pending_ask = (req_id, reason, "requirement", fields or [])
            self._pending_event = ev
            self._pending_answer = None
        self._emit({"type": "requirement", "id": req_id, "reason": reason,
                    "fields": fields or []})
        try:
            while True:
                if self._interrupt.is_set():
                    self._interrupt.clear()
                    return None
                if self._done.is_set():
                    return None
                if ev.wait(0.5):
                    return self._pending_answer
        finally:
            with self._ask_lock:
                self._pending_ask = None
                self._pending_event = None
                self._pending_answer = None
            self._emit({"type": "requirement_done"})

    def poll_guidance(self):
        try:
            return self._inbox.get_nowait()
        except queue.Empty:
            return None

    def pop_interrupt(self):
        if self._interrupt.is_set():
            self._interrupt.clear()
            return True
        return False

    def sleep(self, seconds):
        # 走 sleep_start/sleep_end 事件：前端渲染实时倒计时条（到点消失、可点击打断）
        self.sleep_start(seconds)
        end = time.time() + seconds
        while True:
            remain = end - time.time()
            if remain <= 0:
                self.sleep_end()
                return True
            if self.pop_interrupt():
                self.sleep_end()
                return False
            time.sleep(min(1.0, max(remain, 0.05)))

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def stop(self):
        self._done.set()
        self._interrupt.set()      # 唤醒卡在 ask/sleep 的 worker
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(self._close_ws)
            except Exception:
                pass

    def close(self):
        pass

    def dump_log(self):
        pass

    # ------------------------------------------------------------------
    # 主线程：连接 Hub
    # ------------------------------------------------------------------

    def run(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._run())
        except KeyboardInterrupt:
            self._done.set()
            self._interrupt.set()
        finally:
            try:
                self._loop.run_until_complete(self._loop.shutdown_asyncgens())
            except Exception:
                pass
            self._loop.close()
            self._loop = None

    async def _run(self):
        # 显式 TCPConnector：aiohttp 默认连接器在"非主线程 loop"上会卡死 ws_connect
        # （Windows + Python 3.14 实测），显式指定后主线程/子线程都能连。
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector()) as session:
            while not self._done.is_set():
                try:
                    await self._connect_and_serve(session)
                except asyncio.CancelledError:
                    break
                except Exception:
                    import traceback
                    self._last_err = traceback.format_exc()
                if self._done.is_set():
                    break
                await asyncio.sleep(self._reconnect_delay)   # 退避重连
                self._reconnect_delay = min(self._reconnect_delay * 2, 30)
            self._reconnect_delay = 1.0

    async def _connect_and_serve(self, session):
        ws = await session.ws_connect(self._hub_url, heartbeat=30)
        self._ws = ws
        reg = {
            "type": "register",
            "label": self._label,
            "file_roots": self._file_roots,
            "capabilities": ["chat", "tools"],
            "resume_sid": self._sid,
        }
        if self._instance_id:
            reg["instance_id"] = self._instance_id
        await ws.send_json(reg)
        self._out_q = asyncio.Queue(maxsize=2000)
        with self._pre_lock:
            for ev in self._pre:
                try:
                    self._out_q.put_nowait(ev)
                except Exception:
                    break
            self._pre.clear()
        # 断线期间可能丢了 pending ask/requirement → 重连后重发(requirement 带 fields)
        with self._ask_lock:
            if self._pending_ask is not None:
                ask_id, prompt, mode = self._pending_ask[0], self._pending_ask[1], self._pending_ask[2]
                if mode == "requirement":
                    self._out_q.put_nowait(
                        {"type": "requirement", "id": ask_id, "reason": prompt,
                         "fields": self._pending_ask[3] if len(self._pending_ask) > 3 else []})
                else:
                    self._out_q.put_nowait({"type": "ask", "id": ask_id, "prompt": prompt, "mode": mode})
        # 休眠倒计时重发(带剩余秒数,前端能接着显示)
        if self._sleep_end is not None:
            remain = max(1, int(self._sleep_end - time.time()))
            self._out_q.put_nowait(
                {"type": "sleep_start", "seconds": remain, "text": self._sleep_text or "自动唤醒"})
        sender = asyncio.create_task(self._sender())
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        self._on_ws_message(json.loads(msg.data))
                    except Exception:
                        pass
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
        finally:
            self._ws = None
            self._out_q = None
            sender.cancel()
            try:
                await sender
            except Exception:
                pass

    async def _sender(self):
        while True:
            ev = await self._out_q.get()
            ws = self._ws
            if ws is None or ws.closed:
                continue       # 断线期间丢弃瞬时事件（log/status 等）
            try:
                await ws.send_json(ev)
            except Exception:
                pass

    def _on_ws_message(self, msg):
        t = msg.get("type")
        if t == "registered":
            self._sid = msg.get("sid")
        elif t == "message":
            text = msg.get("text")
            with self._ask_lock:
                # 仅 pending ask 接受普通 message 应答（同 TUI 语义）；
                # pending requirement 只能由 requirement_answer 应答——否则弹窗期间
                # 输入栏的普通输入会把 requirement 用字符串解析掉（require 返回 str）
                if self._pending_event is not None and (
                        self._pending_ask is None or self._pending_ask[2] != "requirement"):
                    self._pending_answer = text
                    self._pending_event.set()
                    return
            if text:
                self._inbox.put(text)
        elif t == "ask_answer":
            with self._ask_lock:
                if self._pending_event is not None and (
                        self._pending_ask is None or msg.get("id") == self._pending_ask[0]):
                    self._pending_answer = msg.get("text")
                    self._pending_event.set()
        elif t == "requirement_answer":
            with self._ask_lock:
                if self._pending_event is not None and (
                        self._pending_ask is None or msg.get("id") == self._pending_ask[0]):
                    self._pending_answer = msg.get("values")
                    self._pending_event.set()
        elif t == "settings_set":
            try:
                self.on_setting(msg.get("key"), msg.get("value"))
            except Exception:
                pass
        elif t == "interrupt":
            self._interrupt.set()
            with self._ask_lock:
                if self._pending_event is not None:
                    self._pending_answer = None
                    self._pending_event.set()

    def _close_ws(self):
        ws = self._ws
        if ws is not None and not ws.closed:
            asyncio.ensure_future(ws.close())
