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
               "thinking_delta", "thinking_end", "status", "tool_start", "tool_end",
               "session_end", "session_state",
               "requirement", "requirement_done"}

# 分页历史只取「纯展示」事件:排除 ask/requirement/settings/sleep 等交互类
# （旧页里出现它们会误弹旧弹窗/旧设置;requirement 琥珀气泡在懒加载旧页不显示,v1 接受）。
# meta 是会话登记的书签行,不进分页（标题由实例 label 提供）。
_DISPLAY_ONLY = {"log", "user", "assistant_delta", "assistant_final", "assistant_end",
                 "thinking_delta", "thinking_end", "status", "tool_start", "tool_end",
                 "file", "session_end"}

# 重放窗口:最多给最近的这么多条事件,更早的由前端上滑分页拉取
_TAIL_EVENTS = 300



class Viewer:
    """一个浏览器 viewer：独立出站队列 + send task + 历史重放投喂 task。"""

    def __init__(self, ws, queue_size=2048):
        self.ws = ws
        self.q = asyncio.Queue(maxsize=queue_size)
        self.task = None   # send_loop：队列 → socket
        self.feed = None   # 历史重放投喂：history → 队列（阻塞式，不丢事件）

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


async def attach_viewer(session, ws, transcripts=None):
    """挂一个浏览器 viewer，重放「尾部窗口」历史再实时推送。返回 Viewer。

    竞态防护：history + 挂起交互（ask/sleep）在「加入 viewers 之前」快照——
    否则若 agent 恰在连入窗口发出该事件，会同时被「实时广播」+「重放」各投一次
    （前端看到同一 requirement 出现两次）。
    requirement 已在 _REPLAYABLE（历史覆盖，刷新后琥珀气泡不消失），无需再走 last_requirement 补发。
    重放只发最近 _TAIL_EVENTS 条（从最近一个干净切点起）：更早历史由前端上滑分页拉取，
    避免每次重连都灌几千条。窗口从转录按行号读取（meta 书签行会被 _REPLAYABLE 滤掉）。
    """
    v = Viewer(ws)
    v.task = asyncio.create_task(v.send_loop())
    last_ask = session.last_ask
    last_sleep = session.last_sleep
    last_settings = session.last_settings
    # 窗口起点:≤ max(0, stream_len-_TAIL_EVENTS) 的最大干净切点(找不到就 0)
    target = max(0, session.stream_len - _TAIL_EVENTS)
    start = 0
    for p in session.clean_points:
        if p <= target:
            start = p
        else:
            break
    if transcripts is not None and session.stream_len > start:
        window = transcripts.read_range(session.sid, start, session.stream_len)
    else:
        # 兜底:无转录 store 时退到内存历史(仅事件,无 meta 行)
        history = list(session.history)
        window = history[-(session.stream_len - start):] if session.stream_len > start else []
    # 未读锚点:上次看到位置(read_pos)落在窗口内 → 在对应事件前插 read_marker
    marker_at = None
    rp = session.read_pos or 0
    if start < rp < session.stream_len:
        marker_at = rp - start
    session.viewers.add(v)
    v.feed = asyncio.create_task(
        _replay_history(v, session, window, marker_at, start, last_ask, last_sleep, last_settings))
    return v


async def _replay_history(v, session, window, marker_at, start, last_ask, last_sleep, last_settings):
    """把尾部窗口 + 挂起交互阻塞式送入 viewer 队列，绝不丢事件（socket 慢则自然背压）。
    窗口结束补发 replay_done（带分页游标）→ 前端据此锚滚动并得知能否上滑加载更早。"""
    try:
        if not await _put(v, {"type": "session_state", "status": session.status}):
            return
        for i, ev in enumerate(window):
            if marker_at is not None and i == marker_at:
                if not await _put(v, {"type": "read_marker", "text": "上次看到这里"}):
                    return
            t = ev.get("type")
            if t in _REPLAYABLE:
                out = dict(ev)
                out["pos"] = start + i   # 转录行号:展开思考/工具时按此取回完整内容
                if t == "thinking_delta":
                    out["content"] = ""          # 重放不加载思考正文,点开再取
                elif t == "tool_start":
                    out.pop("args", None)        # 不加载工具输入,点开再取
                elif t == "tool_end":
                    out.pop("summary", None)
                    out.pop("error", None)
                if not await _put(v, out):
                    return
        # pending ask / sleep 不在 _REPLAYABLE → 快照补发（中途加入也能应答）
        if last_ask and session.agent_ws is not None:
            await _put(v, last_ask)
        if last_sleep and session.agent_ws is not None:
            # 补发剩余秒数:刷新/重连后倒计时不重置,从开始时刻起算还剩多久
            elapsed = int(time.time() - (session.sleep_since or time.time()))
            ev = dict(last_sleep)
            ev["seconds"] = max(1, int(last_sleep.get("seconds") or 0) - elapsed)
            await _put(v, ev)
        # 设置参数快照:任何 viewer 连入都发 → 设置面板永远有参数,不被消息流顶掉
        if last_settings:
            await _put(v, last_settings)
        # 重放完成 + 分页游标:前端锚滚动,hasMore 决定是否还能上滑加载更早;
        # status 让前端决定残留增量块怎么处理(断线→收掉,连接中→保持静态)
        await _put(v, {
            "type": "replay_done",
            "hasMore": start > 0,
            "nextBefore": start if start > 0 else None,
            "status": session.status,
        })
    except asyncio.CancelledError:
        raise
    except Exception:
        pass


async def _put(v, ev):
    """阻塞入队；viewer 已死或队列 30s 塞不进 → 放弃本轮重放（客户端会重连重试）。"""
    if v.task.done() or v.ws.closed:
        return False
    try:
        await asyncio.wait_for(v.q.put(ev), timeout=30)
        return True
    except asyncio.TimeoutError:
        return False


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
                session.mark_event(ev)   # 推进 stream_len + 维护干净切点
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
                    session.sleep_since = time.time()   # 记下起点 → 重连补发剩余秒数
                elif ev.get("type") == "sleep_end":
                    session.last_sleep = None
                    session.sleep_since = 0
                elif ev.get("type") == "settings":
                    session.last_settings = ev   # 快照:设置参数,每次连入都发
                elif ev.get("type") == "meta":
                    # agent 上报分类信息（实验选定等）→ 只更新会话 label(聊天标题/归档命名)。
                    # 不再覆盖实例 label:用户自定义的实例名不能被 agent 默认 label 闪回。
                    if ev.get("label"):
                        session.label = ev["label"]
                    if ev.get("project_root"):
                        session.project_root = ev["project_root"]
                    hub.registry.persist()   # 实验路径等元数据落盘 → 重启后不丢
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
