"""Agent Hub — aiohttp 应用与全部路由。

多 agent 统一 Web 聊天：agent 连 /ws/agent 注册，浏览器连 /ws/chat/{sid} 观看；
每会话多端实时同步；文件 /transcripts/ /api/theme 等服务。
"""
import asyncio
import json
from pathlib import Path

from aiohttp import web

from . import agents as agents_mod
from . import files_api
from . import relay
from . import term
from .files import guess_type, resolve
from .instances import InstanceManager
from .sessions import SessionRegistry
from .theme import PRESETS, ThemeStore
from .transcripts import TranscriptStore

STATIC_DIR = Path(__file__).parent / "static"


class Hub:
    def __init__(self, data_dir, host="127.0.0.1", port=8500):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.host = host
        self.port = port
        self.registry = SessionRegistry()
        self.transcripts = TranscriptStore(self.data_dir)
        self.themes = ThemeStore(self.data_dir)
        self.instances = InstanceManager(port, host, self.data_dir)


# ---------------------------------------------------------------------------
# 页面
# ---------------------------------------------------------------------------

async def _page(path):
    return web.FileResponse(STATIC_DIR / path)


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
            session = hub.registry.reuse(resume, label) if resume else None
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
            hub.transcripts.append(session.sid, {
                "type": "meta", "label": label, "file_roots": session.file_roots,
                "instance_id": instance_id,
            })
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
    v = await relay.attach_viewer(session, ws)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    continue
                relay.forward_input(session, data)
            elif msg.type in (web.WSMsgType.CLOSED, web.WSMsgType.ERROR):
                break
    finally:
        session.viewers.discard(v)
        v.task.cancel()
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
    hub.transcripts.mark_archived(sid, session.label)
    return web.json_response({"ok": True, "archived": len(events)})


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

    async def _shutdown(_app):
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

    app.router.add_get("/api/sessions", api_sessions)
    app.router.add_get("/api/agents", api_agents)
    app.router.add_get("/api/instances", api_instances)
    app.router.add_post("/api/instances", api_spawn_instance)
    app.router.add_delete("/api/instances/{id}", api_stop_instance)
    app.router.add_post("/api/instances/{id}/restart", api_restart_instance)
    app.router.add_post("/api/instances/{id}/archive", api_archive_instance)
    app.router.add_get("/api/transcript/{sid}", api_transcript)
    app.router.add_delete("/api/transcript/{sid}", api_delete_transcript)
    app.router.add_post("/api/sessions/{sid}/trim", api_trim_session)
    app.router.add_get("/api/theme", api_theme)
    app.router.add_post("/api/files/upload", upload_background)
    app.router.add_get("/file", file_handler)
    app.router.add_get("/theme/bg/{name}", theme_bg)

    app.router.add_static("/static/", STATIC_DIR)
    return app
