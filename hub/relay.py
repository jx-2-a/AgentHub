"""每会话事件 fan-out：agent WS → history/transcript/各浏览器 viewer；浏览器输入 → agent。

一个 Session 有两种连接：
- agent WS（/ws/agent）：读 = 事件源；写 = 浏览器输入投递。
- N 个浏览器 viewer（/ws/chat/{sid}）：读 = 浏览器输入；写 = 中继事件。
读写各由独立 task 驱动，避免慢客户端阻塞事件源。
"""
import asyncio
import json
import time

import aiohttp

from .notify import HUB_URL as _HUB_URL
from .notify import send as _notify_send

# 展示类事件（重放用）；瞬时交互事件（ask/ask_done）不重放
# requirement 可重放:刷新后"系统询问"琥珀气泡不消失
# settings 不走重放,而是独立快照(last_settings)每次连入都发 → 设置面板永远有参数
_REPLAYABLE = {"log", "user", "assistant_delta", "assistant_final", "assistant_end",
               "status", "tool_start", "tool_end", "session_end", "session_state",
               "requirement", "requirement_done"}



class Viewer:
    """一个浏览器 viewer：独立出站队列 + send task。"""

    def __init__(self, ws, queue_size=500):
        self.ws = ws
        self.q = asyncio.Queue(maxsize=queue_size)
        self.task = None

    async def send_loop(self):
        try:
            while True:
                ev = await self.q.get()
                if ev is None:
                    break
                try:
                    await self.ws.send_json(ev)
                except Exception:
                    break
        finally:
            try:
                await self.ws.close()
            except Exception:
                pass


def _try_put(q, ev):
    try:
        q.put_nowait(ev)
        return True
    except asyncio.QueueFull:
        return False


def broadcast(session, event):
    """把事件推给所有 viewer（非阻塞；慢 viewer 直接断开）。"""
    for v in list(session.viewers):
        if v.ws.closed:
            session.viewers.discard(v)
            continue
        if not _try_put(v.q, event):
            session.viewers.discard(v)
            asyncio.ensure_future(v.ws.close())


async def attach_viewer(session, ws):
    """挂一个浏览器 viewer，先重放历史再实时推送。返回 Viewer。

    竞态防护：history + 挂起交互（ask/sleep）在「加入 viewers 之前」快照——
    否则若 agent 恰在连入窗口发出该事件，会同时被「实时广播」+「重放」各投一次
    （前端看到同一 requirement 出现两次）。
    requirement 已在 _REPLAYABLE（历史覆盖，刷新后琥珀气泡不消失），无需再走 last_requirement 补发。
    """
    v = Viewer(ws)
    v.task = asyncio.create_task(v.send_loop())
    history = list(session.history)
    last_ask = session.last_ask
    last_sleep = session.last_sleep
    last_settings = session.last_settings
    session.viewers.add(v)
    # 重放历史（含 requirement/requirement_done 等可重放事件；先发一个会话状态）
    await _safe_put(v.q, {"type": "session_state", "status": session.status})
    for ev in history:
        if ev.get("type") in _REPLAYABLE:
            await _safe_put(v.q, ev)
    # pending ask / sleep 不在 _REPLAYABLE → 快照补发（中途加入也能应答）
    if last_ask and session.agent_ws is not None:
        await _safe_put(v.q, last_ask)
    if last_sleep and session.agent_ws is not None:
        await _safe_put(v.q, last_sleep)
    # 设置参数快照:任何 viewer 连入都发 → 设置面板永远有参数,不被消息流顶掉
    if last_settings:
        await _safe_put(v.q, last_settings)
    return v


async def _safe_put(q, ev):
    try:
        q.put_nowait(ev)
    except asyncio.QueueFull:
        pass


# 手机推送节流:每会话 30s 内最多一条,避免 agent 频繁 ask 刷屏
_last_notify: dict = {}
_NOTIFY_GAP = 30


def _notify_input(session, text):
    """agent 需要用户输入(ask/requirement)时推送手机通知。"""
    now = time.time()
    if now - _last_notify.get(session.sid, 0) < _NOTIFY_GAP:
        return
    _last_notify[session.sid] = now
    url = f"{_HUB_URL}/chat/{session.sid}" if _HUB_URL else None
    _notify_send(f"【{session.label}】需要你输入", (text or "请查看网页")[:200], url=url)


def forward_input(session, data):
    """浏览器输入 → agent 发送队列（agent 断开则丢弃）。"""
    out = session.agent_out
    if out is None:
        return
    try:
        out.put_nowait(data)
    except asyncio.QueueFull:
        pass


async def serve_agent(session, hub):
    """读 agent WS → history/transcript/广播；同时把 agent_out 里的浏览器输入发给 agent。"""
    ws = session.agent_ws
    agent_out = asyncio.Queue(maxsize=500)
    session.agent_out = agent_out

    async def reader():
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    ev = json.loads(msg.data)
                except Exception:
                    continue
                session.touch()
                session.history.append(ev)
                hub.transcripts.append(session.sid, ev)
                if ev.get("type") == "ask":
                    session.last_ask = ev
                    _notify_input(session, ev.get("prompt") or "")
                elif ev.get("type") == "ask_done":
                    session.last_ask = None
                elif ev.get("type") == "requirement":
                    session.last_requirement = ev
                    _notify_input(session, ev.get("reason") or "")
                elif ev.get("type") == "requirement_done":
                    session.last_requirement = None
                elif ev.get("type") == "sleep_start":
                    session.last_sleep = ev
                elif ev.get("type") == "sleep_end":
                    session.last_sleep = None
                elif ev.get("type") == "settings":
                    session.last_settings = ev   # 快照:设置参数,每次连入都发
                elif ev.get("type") == "meta":
                    # agent 上报分类信息（实验选定等）→ 更新会话 + 关联实例
                    if ev.get("label"):
                        session.label = ev["label"]
                        if session.instance_id:
                            hub.instances.update_label(session.instance_id, ev["label"])
                    if ev.get("project_root"):
                        session.project_root = ev["project_root"]
                if ev.get("type") == "session_end":
                    session.status = "exited"
                broadcast(session, ev)
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break

    async def writer():
        while True:
            ev = await agent_out.get()
            if ev is None:
                break
            try:
                await ws.send_json(ev)
            except Exception:
                break

    r = asyncio.create_task(reader())
    w = asyncio.create_task(writer())
    try:
        await r
    finally:
        w.cancel()
        try:
            await w
        except Exception:
            pass
        session.agent_out = None
        if session.status != "exited":
            session.status = "disconnected"
        broadcast(session, {"type": "session_state", "status": session.status})
