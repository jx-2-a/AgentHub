"""无头集成测试：Hub + SDK 客户端 + 浏览器 viewer，验证完整协议。

注意：主线程（服务器事件循环）绝不能用 time.sleep 阻塞——否则 client 的
ws_connect 握手会被卡住。全部用 await asyncio.sleep。

运行：D:\\PyVenv\\AgentHub\\.venv\\Scripts\\python.exe tests\\test_hub.py
"""
import asyncio
import json
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aiohttp
from aiohttp import web

from agentweb.client import WebSessionClient
from hub.app import create_app


async def main():
    tmp = tempfile.mkdtemp(prefix="hubtest")
    (Path(tmp) / "note.txt").write_text("hello from file", encoding="utf-8")

    app = create_app(tmp)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    hub_url = f"ws://127.0.0.1:{port}/ws/agent"
    http = f"http://127.0.0.1:{port}"

    ask_result = {}
    holder = {}

    def client_thread():
        c = WebSessionClient(hub_url, label="测试Agent", file_roots=[tmp])
        holder["c"] = c
        c.render("启动完成")
        c.set_status("等待输入")

        def ask_worker():
            ask_result["val"] = c.ask("你 > ")
            ask_result["resolved"] = True
        threading.Thread(target=ask_worker, daemon=True).start()
        c.run()

    threading.Thread(target=client_thread, daemon=True).start()
    await asyncio.sleep(1.0)   # 等注册 + ask 发出（服务器循环保持运行）

    async with aiohttp.ClientSession() as sess:
        # 1) 首页可访问
        r = await sess.get(http + "/")
        assert r.status == 200 and "Agent Hub" in await r.text()

        # 2) 会话列表含 agent
        r = await sess.get(http + "/api/sessions")
        d = await r.json()
        assert d["live"] and d["live"][0]["label"] == "测试Agent", d

        # 3) viewer 连接，应收到 历史(log/status) + 实时(ask)
        ws = await sess.ws_connect(f"ws://127.0.0.1:{port}/ws/chat/1")
        seen = []
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=2)
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.TEXT:
                seen.append(json.loads(msg.data))
                if any(e.get("type") == "ask" for e in seen):
                    break
        types = [e.get("type") for e in seen]
        assert "log" in types, seen
        assert "status" in types, seen
        assert "ask" in types, seen

        # 4) 应答 ask（message 在 ask 挂起时即应答）
        await ws.send_json({"type": "message", "text": "你好，Hub"})
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline and not ask_result.get("resolved"):
            await asyncio.sleep(0.05)
        got = ask_result.get("val")
        assert got == "你好，Hub", f"{repr(got)} vs {repr('你好，Hub')}"

        # 5) 文件服务
        r = await sess.get(http + "/file", params={"sid": "1", "path": "note.txt"})
        assert r.status == 200 and "hello from file" in await r.text()

        # 6) 多端同看：driver 发 user 事件，两个 viewer 都收到
        ws2 = await sess.ws_connect(f"ws://127.0.0.1:{port}/ws/chat/1")
        def driver():
            import time
            time.sleep(0.5)
            holder["c"].user_message("多端同步消息", turn=2)
        threading.Thread(target=driver, daemon=True).start()
        seen1, seen2 = [], []
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline and not (
                any(e.get("type") == "user" and "多端同步消息" in (e.get("text") or "") for e in seen1)
                and any(e.get("type") == "user" and "多端同步消息" in (e.get("text") or "") for e in seen2)):
            for v, acc in ((ws, seen1), (ws2, seen2)):
                try:
                    msg = await asyncio.wait_for(v.receive(), timeout=1)
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        acc.append(json.loads(msg.data))
                except asyncio.TimeoutError:
                    pass
        assert any(e.get("type") == "user" and "多端同步消息" in (e.get("text") or "") for e in seen1), seen1
        assert any(e.get("type") == "user" and "多端同步消息" in (e.get("text") or "") for e in seen2), seen2
        await ws.close()
        await ws2.close()

    # 7) 记录已落盘
    tr = Path(tmp) / "transcripts" / "1.jsonl"
    assert tr.exists()
    lines = tr.read_text(encoding="utf-8").strip().splitlines()
    assert any("启动完成" in l for l in lines), lines
    assert any("多端同步消息" in l for l in lines), lines   # agent 主动发的 user 事件被记录

    await runner.cleanup()
    print("ALL TESTS PASSED")
    print("  events:", types)
    print("  ask resolved:", ask_result.get("val"))
    print("  transcript lines:", len(lines))


if __name__ == "__main__":
    asyncio.run(main())
