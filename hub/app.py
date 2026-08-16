"""Agent Hub — aiohttp 应用与全部路由。

多 agent 统一 Web 聊天：agent 连 /ws/agent 注册，浏览器连 /ws/chat/{sid} 观看；
每会话多端实时同步；文件 /transcripts/ /api/theme 等服务。
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from aiohttp import web

from . import agents as agents_mod
from . import files_api
from . import notify
from . import relay
from . import system as system_mod
from . import term
from .files import guess_type, resolve
from .instances import InstanceManager
from .sessions import SessionRegistry
from .settings import HubSettings
from .theme import PRESETS, ThemeStore
from .transcripts import TranscriptStore

_HUB_ROOT = Path(__file__).resolve().parent.parent

STATIC_DIR = Path(__file__).parent / "static"


class Hub:
    def __init__(self, data_dir, host="127.0.0.1", port=8500):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.host = host
        self.port = port
        self.transcripts = TranscriptStore(self.data_dir)
        self.registry = SessionRegistry(self.data_dir)
        self.registry.restore(self.transcripts)   # 重启后重建会话 + 从转录重放历史
        self.themes = ThemeStore(self.data_dir)
        self.instances = InstanceManager(port, host, self.data_dir)
        self.settings = HubSettings(self.data_dir)
        notify.set_enabled(self.settings.get("notify_enabled", True))  # 通知开关(持久化)


# ---------------------------------------------------------------------------
# 页面
# ---------------------------------------------------------------------------

async def _page(path):
    # no-cache:index.html 一改哈希 F5 立刻拿到新入口;否则浏览器默认缓存一小时,新前端不生效
    return web.FileResponse(STATIC_DIR / path, headers={"Cache-Control": "no-cache"})


async def index(request):
    return await _page("index.html")


async def chat_page(request):
    # 单页应用：/chat/{sid} 也服务 index.html，app.js 从路径解析 sid 自动定位
    return await _page("index.html")


async def transcripts_page(request):
    # 首页已同时列出活动会话 + 归档记录，作为统一记录管理入口
    raise web.HTTPFound("/")


async def transcript_view(request):
    return await _page("transcript_view.html")


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

async def ws_agent(request):
    """agent 注册连接。收 register → 分配/复用 Session → 中继事件。"""
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    hub = request.app["hub"]
    session = None
    async for msg in ws:
        if msg.type != web.WSMsgType.TEXT:
            break
        try:
            data = json.loads(msg.data)
        except Exception:
            continue
        if data.get("type") == "register":
            label = data.get("label", "agent")
            resume = data.get("resume_sid")
            instance_id = data.get("instance_id")
            # 用户新建的实例(fresh)→ 不续接旧会话(即使 agent 状态里带着旧 sid)
            inst = hub.instances.get(instance_id) if instance_id else None
            fresh_instance = bool(instance_id) and bool(getattr(inst, "fresh", True))
            session = None
            if not fresh_instance:
                # 优先续接重启时指定的旧会话(restart?resume=1 会把旧 sid 记在 inst.resume_sid)
                if inst and inst.resume_sid:
                    cand = hub.registry.get(inst.resume_sid)
                    if cand and hub.registry._free(cand):
                        session = cand
                        inst.resume_sid = None   # 用过即清
                if session is None and resume:
                    session = hub.registry.reuse(resume, label)
                if session is None and instance_id:
                    # 重启后 agent 状态里的 resume_sid 可能是旧的 → 按实例 id 找回原会话
                    session = hub.registry.by_instance(instance_id)
            if session is None:
                session = hub.registry.create(label, data.get("file_roots", []),
                                              data.get("capabilities", []))
            else:
                if data.get("file_roots"):
                    session.file_roots = data["file_roots"]
                if data.get("capabilities"):
                    session.capabilities = data["capabilities"]
            if instance_id:
                session.instance_id = instance_id
                hub.instances.link_session(instance_id, session.sid)
            session.status = "connected"
            session.agent_ws = ws
            await ws.send_json({"type": "registered", "sid": session.sid})
            # 记录开头写一条 meta（含 label），回看时能识别会话
            meta_ev = {
                "type": "meta", "label": label, "file_roots": session.file_roots,
                "instance_id": instance_id,
            }
            hub.transcripts.append(session.sid, meta_ev)
            session.mark_event(meta_ev)   # meta 也是转录一行 → 游标同步(分页位置=行号对齐)
            hub.registry.persist()   # 会话归属/元数据有变 → 落盘
            relay.broadcast(session, {"type": "session_state", "status": "connected"})
            break
    if session is None:
        return ws
    await relay.serve_agent(session, hub)
    return ws


async def ws_chat(request):
    """浏览器 viewer 连接。先重放历史，再实时接收中继事件；浏览器输入转发给 agent。"""
    sid = request.match_info["sid"]
    hub = request.app["hub"]
    session = hub.registry.get(sid)
    if session is None:
        raise web.HTTPNotFound(text="会话不存在")
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    v = await relay.attach_viewer(session, ws, hub.transcripts)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    continue
                if isinstance(data, dict) and data.get("type") == "read_pos":
                    # 已读上报:客户端贴底时发 → 记录"上次看到位置",不转发给 agent
                    session.read_pos = session.stream_len
                    hub.registry.persist()
                    continue
                relay.forward_input(session, data)
            elif msg.type in (web.WSMsgType.CLOSED, web.WSMsgType.ERROR):
                break
    finally:
        session.viewers.discard(v)
        v.task.cancel()
        if v.feed:
            v.feed.cancel()
    return ws


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

async def api_term_start(request):
    """拉起一个终端 shell。?token=SHELL_TOKEN 鉴权(仅终端需要)。"""
    if not term.terminal_enabled():
        return web.json_response({"error": "终端未启用(未配置 SHELL_TOKEN)"}, status=400)
    if not term.check_token(request.query.get("token", "")):
        return web.json_response({"error": "token 错误"}, status=401)
    try:
        term_id, port = term.start_terminal()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"term_id": term_id, "port": port})


async def api_term_stop(request):
    term.stop_terminal(request.match_info["id"])
    return web.json_response({"ok": True})


async def ws_term(request):
    """浏览器终端 WS,经 hub 代理到 ttyd。?token= 鉴权。"""
    term_id = request.match_info["id"]
    if not term.check_token(request.query.get("token", "")):
        raise web.HTTPUnauthorized(text="token 错误")
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    ok = await term.proxy_terminal(term_id, ws)
    if not ok:
        await ws.close(code=1011, message=b"terminal not found")
    return ws


async def api_sessions(request):
    hub = request.app["hub"]
    live = [s.to_dict() for s in hub.registry.all()]
    # 归档只列"显式归档"的会话(用过归档以上/完全归档才建卡);活跃会话归实例管
    archived = []
    for sid, label, _at in hub.transcripts.archived_list():
        p = hub.transcripts.archive_path(sid)
        try:
            size = p.stat().st_size
            mtime = p.stat().st_mtime
        except OSError:
            size, mtime = 0, 0
        archived.append({"sid": sid, "label": label, "size": size, "mtime": mtime})
    return web.json_response({"live": live, "archived": archived})


async def api_agents(request):
    hub = request.app["hub"]
    agents = agents_mod.load_agents()
    return web.json_response({"agents": [agents_mod.to_public(a) for a in agents.values()]})


async def api_instances(request):
    hub = request.app["hub"]
    return web.json_response({"instances": hub.instances.list()})


async def api_spawn_instance(request):
    hub = request.app["hub"]
    try:
        data = await request.json()
    except Exception as e:
        return web.json_response({"error": f"JSON 解析失败: {e}"}, status=400)
    agent_key = data.get("agent", "")
    label = (data.get("label") or "").strip()
    try:
        inst = hub.instances.spawn(agent_key, label)
    except KeyError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response(inst.to_dict())


async def api_stop_instance(request):
    hub = request.app["hub"]
    inst_id = request.match_info["id"]
    inst = hub.instances.get(inst_id)
    sid = inst.session_id if inst else None
    hub.instances.stop(inst_id)
    if request.query.get("purge") == "1":   # 右键"删除实例":删临时记录+实例+会话,归档保留
        hub.instances.remove(inst_id)
        if sid:
            hub.registry.remove(sid)
            hub.transcripts.delete(sid)
    return web.json_response({"ok": True})


async def api_clean_all_instances(request):
    """一键清理:停掉并移除全部后台实例,同时删除其临时会话/转录(永久归档保留)。
    避免旧实例重启恢复续接旧会话 → 同名实例串会话/刷新看到旧内容。"""
    hub = request.app["hub"]
    cleaned = 0
    for inst in list(hub.instances.list()):
        inst_id = inst["id"]
        sid = inst.get("session_id")
        hub.instances.stop(inst_id)
        hub.instances.remove(inst_id)
        if sid:
            hub.registry.remove(sid)
            hub.transcripts.delete(sid)
        cleaned += 1
    return web.json_response({"ok": True, "cleaned": cleaned})


async def api_restart_instance(request):
    """右键"重启实例":停止并按原配置重拉;?resume=1 时续接旧会话。"""
    hub = request.app["hub"]
    inst_id = request.match_info["id"]
    try:
        inst = hub.instances.restart(inst_id, resume=request.query.get("resume") == "1")
    except KeyError as e:
        return web.json_response({"error": str(e)}, status=400)
    return web.json_response(inst.to_dict())


async def api_archive_instance(request):
    """完全归档:停止实例 + 移出实例列表 + 移出活跃会话,转录保留 → 进归档(只读)。"""
    hub = request.app["hub"]
    inst_id = request.match_info["id"]
    inst = hub.instances.get(inst_id)
    if not inst:
        return web.json_response({"error": "实例不存在"}, status=400)
    sid = inst.session_id
    # 剩余记录也剪切到永久归档
    if sid:
        events = hub.transcripts.read(sid)
        hub.transcripts.archive_append(sid, events)
        hub.transcripts.delete(sid)
    hub.instances.stop(inst_id)
    hub.instances.remove(inst_id)
    if sid:
        hub.registry.remove(sid)
        hub.transcripts.mark_archived(sid, inst.label)
    return web.json_response({"ok": True, "archived_sid": sid})


async def api_transcript(request):
    sid = request.match_info["sid"]
    hub = request.app["hub"]
    # 已归档会话读永久归档;活跃会话读临时记录
    events = hub.transcripts.archive_read(sid) if hub.transcripts.is_archived(sid) \
        else hub.transcripts.read(sid)
    return web.json_response(events)


async def api_delete_transcript(request):
    """删除记录:临时记录 + 永久归档 + 归档标记 一并删除。"""
    sid = request.match_info["sid"]
    hub = request.app["hub"]
    hub.transcripts.delete(sid)
    hub.transcripts.archive_delete(sid)
    return web.json_response({"ok": True})


async def api_trim_session(request):
    """归档以上内容:只保留会话最近 keep 条内存历史(旧历史已在转录落盘,不丢)。"""
    hub = request.app["hub"]
    sid = request.match_info["sid"]
    session = hub.registry.get(sid)
    if session is None:
        raise web.HTTPNotFound(text="会话不存在")
    try:
        data = await request.json()
    except Exception:
        data = {}
    try:
        keep = int(data.get("keep", 100))
    except (TypeError, ValueError):
        keep = 100
    # 归档以上内容:把当前记录全部剪切到永久归档,清空实例临时记录+内存
    events = hub.transcripts.read(sid)
    hub.transcripts.archive_append(sid, events)
    hub.transcripts.delete(sid)
    session.trim_history(0)
    session.reset_log()   # 转录已剪切走,事件流游标清零(否则分页/未读锚点对不上)
    hub.transcripts.mark_archived(sid, session.label)
    return web.json_response({"ok": True, "archived": len(events)})


async def api_session_history(request):
    """分页拉更早历史:before = 当前窗口起点(干净切点行号),返回它之前最近一页。
    页在「干净切点」处切开 → 前端每页可独立 reducer 前插,无空窗、无半个思考/回复/工具块。"""
    hub = request.app["hub"]
    sid = request.match_info["sid"]
    session = hub.registry.get(sid)
    if session is None:
        raise web.HTTPNotFound(text="会话不存在")
    try:
        before = int(request.query.get("before", 0))
    except (TypeError, ValueError):
        before = 0
    try:
        limit = max(1, min(int(request.query.get("limit", 300)), 2000))
    except (TypeError, ValueError):
        limit = 300
    before = max(0, min(before, session.stream_len))   # 钳到有效范围(trim/删除后兜底)
    if before <= 0:
        return web.json_response({"events": [], "nextBefore": None, "hasMore": False})
    # 找 < before 的干净切点:优先取使 chunk ≤ limit 的最近切点(分页步长≈limit);
    # 若中间隔着超大块(连续切点间隙 > limit)则退而取最近切点,块不硬切。
    b1 = 0
    last_lt = 0
    for p in session.clean_points:
        if p >= before:
            break
        last_lt = p
        if before - p <= limit:
            b1 = p
            break
    if b1 == 0:
        b1 = last_lt
    events = hub.transcripts.read_range(sid, b1, before)
    events = [e for e in events if e.get("type") in relay._DISPLAY_ONLY]
    return web.json_response({
        "events": events,
        "nextBefore": b1 if b1 > 0 else None,
        "hasMore": b1 > 0,
    })


async def file_handler(request):
    hub = request.app["hub"]
    sid = request.query.get("sid")
    path = request.query.get("path", "")
    session = hub.registry.get(sid)
    if session is None:
        raise web.HTTPNotFound()
    fp = resolve(session, path)
    if fp is None:
        raise web.HTTPForbidden(text="路径越界或文件不存在")
    mime, inline = guess_type(fp)
    headers = {}
    if not inline:
        headers["Content-Disposition"] = f'attachment; filename="{fp.name}"'
    return web.FileResponse(fp, headers=headers)


async def api_theme(request):
    return web.json_response({"presets": PRESETS})


# ---------------------------------------------------------------------------
# 系统状态 / 工具(设置 → 控制 → 电脑状态;免登录,Tailscale 当边界)
# ---------------------------------------------------------------------------

async def api_system(request):
    """电脑状态汇总:内存/CPU/磁盘/Tailscale/VPN/本服务进程/主机。"""
    hub = request.app["hub"]
    known: list[dict] = [{"pid": os.getpid(), "name": "AgentHub", "role": "Hub"}]
    for inst in hub.instances.list():
        if inst.get("pid"):
            known.append({
                "pid": inst["pid"],
                "name": inst.get("label") or inst.get("agent_key"),
                "role": "Agent",
            })
    for term_id, t in term._terms.items():
        if t["proc"].poll() is None:
            known.append({"pid": t["proc"].pid, "name": f"ttyd-{term_id}", "role": "终端"})
    return web.json_response(system_mod.get_system_report(known))


async def api_system_memfree(request):
    return web.json_response(system_mod.free_memory())


async def api_system_tailscale(request):
    action = request.match_info["action"]  # up / down
    code, text = system_mod.tailscale_action(action)
    return web.json_response({"ok": code == 0, "detail": text})


async def api_system_vpn(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    act = data.get("action", "")
    if act not in ("connect", "disconnect"):
        return web.json_response({"error": "action 须为 connect/disconnect"}, status=400)
    return web.json_response(system_mod.vpn_action(data.get("name", ""), act == "connect"))


async def api_system_open(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    return web.json_response(system_mod.open_folder(data.get("path", "")))


async def api_system_settings(request):
    return web.json_response({
        "notify_enabled": notify.is_enabled(),
        "notify_configured": notify.is_configured(),
        "notify_mode": notify.mode(),
    })


async def api_system_settings_notify(request):
    """通知推送开关(持久化到 data/settings.json,重启后仍生效)。"""
    hub = request.app["hub"]
    try:
        data = await request.json()
    except Exception:
        data = {}
    on = bool(data.get("enabled"))
    notify.set_enabled(on)
    hub.settings.set("notify_enabled", on)
    return web.json_response({"ok": True, "notify_enabled": on})


async def api_system_restart(request):
    """重启 Hub 服务:spawn 独立重启助手,先停实例/终端,然后退出自己。"""
    hub = request.app["hub"]
    cmd = [sys.executable, "-m", "hub.relaunch",
           str(hub.port), str(hub.host), str(hub.data_dir)]
    try:
        subprocess.Popen(
            cmd, cwd=str(_HUB_ROOT),
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        return web.json_response({"ok": False, "detail": str(e)}, status=500)
    # 先停实例/终端,避免旧实例被新 hub 的 restore() 重复拉起
    hub.registry.persist()   # 落盘会话,重启后 agent 能续接原 sid
    hub.instances.shutdown()
    term.stop_all()
    # 响应发回后再退出;重启助手已接管后续拉起
    asyncio.get_running_loop().call_later(1.2, lambda: os._exit(0))
    return web.json_response({"ok": True, "detail": "正在重启服务…"})


async def upload_background(request):
    hub = request.app["hub"]
    try:
        reader = await request.multipart()
        part = await reader.next()
        data = b""
        while True:
            chunk = await part.read_chunk()
            if not chunk:
                break
            data += chunk
        url = hub.themes.save_background(data, part.filename or "bg.png")
        return web.json_response({"url": url})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def theme_bg(request):
    name = request.match_info["name"]
    p = request.app["hub"].themes.serve_background(name)
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p)


# ---------------------------------------------------------------------------
# 应用
# ---------------------------------------------------------------------------

def create_app(data_dir="data", host="127.0.0.1", port=8500):
    app = web.Application()
    app["hub"] = Hub(data_dir, host, port)
    # 启动时恢复上次在跑的实例；优雅关停：杀掉所有实例
    app["hub"].instances.restore()
    app["hub"].registry.prune(app["hub"].instances)   # 清理已删除/重启遗留的孤儿会话

    async def _shutdown(_app):
        _app["hub"].registry.persist()   # 优雅关停:落盘会话元数据
        _app["hub"].instances.shutdown()
    app.on_shutdown.append(_shutdown)

    app.router.add_get("/", index)
    app.router.add_get("/chat/{sid}", chat_page)
    app.router.add_get("/transcripts/", transcripts_page)
    app.router.add_get("/transcripts/{sid}", transcript_view)

    app.router.add_get("/ws/agent", ws_agent)
    app.router.add_get("/ws/chat/{sid}", ws_chat)
    app.router.add_get("/term/ws/{id}", ws_term)
    app.router.add_post("/api/term/start", api_term_start)
    app.router.add_post("/api/term/{id}/stop", api_term_stop)
    app.router.add_get("/api/files", files_api.api_list)
    app.router.add_post("/api/files/upload", files_api.api_upload)
    app.router.add_get("/api/file", files_api.api_file)
    # 主题背景图上传走独立路由(避免被 /api/files/upload 抢先)
    app.router.add_post("/api/theme/upload", upload_background)

    app.router.add_get("/api/sessions", api_sessions)
    app.router.add_get("/api/agents", api_agents)
    app.router.add_get("/api/instances", api_instances)
    app.router.add_post("/api/instances", api_spawn_instance)
    app.router.add_delete("/api/instances/{id}", api_stop_instance)
    app.router.add_post("/api/instances/clean_all", api_clean_all_instances)
    app.router.add_post("/api/instances/{id}/restart", api_restart_instance)
    app.router.add_post("/api/instances/{id}/archive", api_archive_instance)
    app.router.add_get("/api/transcript/{sid}", api_transcript)
    app.router.add_delete("/api/transcript/{sid}", api_delete_transcript)
    app.router.add_post("/api/sessions/{sid}/trim", api_trim_session)
    app.router.add_get("/api/sessions/{sid}/history", api_session_history)
    app.router.add_get("/api/theme", api_theme)
    app.router.add_get("/api/system", api_system)
    app.router.add_post("/api/system/memfree", api_system_memfree)
    app.router.add_post("/api/system/tailscale/{action}", api_system_tailscale)
    app.router.add_post("/api/system/vpn", api_system_vpn)
    app.router.add_post("/api/system/open", api_system_open)
    app.router.add_get("/api/system/settings", api_system_settings)
    app.router.add_post("/api/system/settings/notify", api_system_settings_notify)
    app.router.add_post("/api/system/restart", api_system_restart)
    app.router.add_get("/file", file_handler)
    app.router.add_get("/theme/bg/{name}", theme_bg)

    # 哈希资源文件名带内容指纹,可安全复用浏览器缓存;index.html 由 _page 走 no-cache。
    app.router.add_static("/static/", STATIC_DIR)
    return app
