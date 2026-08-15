""""进去再说"流程：web 模式 project_root 为空 → 在 web 输入栏选实验 → agent 继续。

运行（Emisinver venv）：
D:\\PyVenv\\Emisinver\\.venv\\Scripts\\python.exe tests\\test_web_choose.py
"""
import asyncio
import json
import sys
import tempfile
import threading
from pathlib import Path

AGENTHUB = Path(__file__).resolve().parent.parent
EMISINVER = Path(r"D:\DsEdit\Emisinver")
sys.path.insert(0, str(AGENTHUB))
sys.path.insert(0, str(EMISINVER))

import aiohttp
from aiohttp import web

from hub.app import create_app
from ALb.Agent.Local import chat as chat_mod


async def main():
    tmp = tempfile.mkdtemp(prefix="webchoose")
    ws = Path(tmp) / "workspace"
    (ws / "config").mkdir(parents=True)
    (ws / "config" / "experiment_history.json").write_text(json.dumps([
        {"label": "exp_test", "path": "/remote/exp_test", "last_used": "2026-01-01"},
    ], ensure_ascii=False), encoding="utf-8")

    app = create_app(str(Path(tmp) / "data"))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    resolved = {}
    def fake_impl(ssh_host, project_root, llm_cfg, workspace, mem_cfg=None, ssh_port=22):
        resolved["project_root"] = project_root
    chat_mod._run_chat_impl = fake_impl

    def run_chat_thread():
        chat_mod.run_chat("user@host", "", {}, ws,
                          web={"hub_url": f"ws://127.0.0.1:{port}/ws/agent",
                               "label": "科研", "file_roots": []})
    threading.Thread(target=run_chat_thread, daemon=True).start()

    async with aiohttp.ClientSession() as sess:
        await asyncio.sleep(1.0)
        vws = await sess.ws_connect(f"ws://127.0.0.1:{port}/ws/chat/1")
        seen = []
        deadline = asyncio.get_event_loop().time() + 8
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(vws.receive(), timeout=2)
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.TEXT:
                ev = json.loads(msg.data)
                seen.append(ev)
                if ev.get("type") == "ask":
                    break
        logs = "".join(e.get("text", "") for e in seen if e.get("type") == "log")
        assert "exp_test" in logs, logs
        ask_ev = next((e for e in seen if e.get("type") == "ask"), None)
        assert ask_ev, seen
        await vws.send_json({"type": "ask_answer", "id": ask_ev["id"], "text": "1"})
        deadline = asyncio.get_event_loop().time() + 8
        while asyncio.get_event_loop().time() < deadline and not resolved.get("project_root"):
            try:
                msg = await asyncio.wait_for(vws.receive(), timeout=1)
                if msg.type == aiohttp.WSMsgType.TEXT:
                    seen.append(json.loads(msg.data))
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(0.05)
        print("--- seen after answer ---")
        for e in seen:
            print("  ", e.get("type"), str(e.get("text") or e.get("content") or "")[:80])
        assert resolved.get("project_root") == "/remote/exp_test", resolved
        await vws.close()

    await asyncio.sleep(0.5)
    await runner.cleanup()
    print("WEB-CHOOSE PASSED, project_root =", resolved.get("project_root"))


if __name__ == "__main__":
    asyncio.run(main())
