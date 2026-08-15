"""跨项目集成：Emisinver AgentForWeb/Local/chat.py 的 _session 分发 → WebSessionClient → Hub → 浏览器。

运行（用 Emisinver venv，它有 chat 依赖 + agentweb + aiohttp）：
D:\\PyVenv\\Emisinver\\.venv\\Scripts\\python.exe tests\\test_chat_integration.py
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
from agentweb.client import WebSessionClient
from ALb.AgentForWeb.Local import chat as chat_mod
from ALb.AgentForWeb.Local import llm as llm_mod


def fake_stream(messages, tools=None, api_base="", api_key="", model="",
                temperature=0.3, max_tokens=8192, thinking=None,
                reasoning_effort="", cancel=None):
    yield {"type": "reasoning", "content": "分析中"}
    yield {"type": "delta", "content": "你好，"}
    yield {"type": "delta", "content": "这是回复。"}
    yield {"type": "done", "content": "你好，这是回复。", "reasoning_content": "分析中"}


async def main():
    tmp = tempfile.mkdtemp(prefix="chatint")
    app = create_app(tmp)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    hub_url = f"ws://127.0.0.1:{port}/ws/agent"
    holder = {}

    def client_thread():
        c = WebSessionClient(hub_url, label="集成测试", file_roots=[tmp])
        holder["c"] = c
        chat_mod._session = c
        llm_mod.chat_stream = fake_stream
        c.run()

    threading.Thread(target=client_thread, daemon=True).start()
    await asyncio.sleep(1.0)

    async with aiohttp.ClientSession() as sess:
        ws = await sess.ws_connect(f"ws://127.0.0.1:{port}/ws/chat/1")
        # 等注册完成（收到 session_state）
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=2)
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.TEXT:
                if json.loads(msg.data).get("type") == "session_state":
                    break

        # 驱动 chat.py 的辅助函数（模拟一轮对话 + 工具 + 流式）
        chat_mod._user_echo(1, "帮我看看实验")
        chat_mod._tool_start("get_context", {"x": 1}, verbosity=2)
        chat_mod._tool_end("get_context", {"ok": True, "data": {"tasks": 3}}, verbosity=2)
        resp = chat_mod._stream_response(
            [{"role": "user", "content": "hi"}], None, "思考中...",
            "http://x", "k", "m", 0.3, 4096, False, "high")

        # 收集浏览器收到的结构化事件
        seen = []
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=2)
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.TEXT:
                seen.append(json.loads(msg.data))
                if any(e.get("type") == "assistant_final" for e in seen):
                    break

        types = [e.get("type") for e in seen]
        print("event types:", types)
        assert "user" in types and any("帮我看看实验" in (e.get("text") or "") for e in seen), seen
        assert "tool_start" in types and "tool_end" in types, types
        assert "assistant_delta" in types and "assistant_final" in types, types
        assert any("这是回复" in (e.get("content") or "") for e in seen), seen
        assert resp.get("type") == "text", resp
        await ws.close()

    await runner.cleanup()
    print("CHAT INTEGRATION PASSED")


if __name__ == "__main__":
    asyncio.run(main())
