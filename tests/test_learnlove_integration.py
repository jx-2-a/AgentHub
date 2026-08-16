"""跨项目集成：LearnLove agent/chat.py 的 _execute_tool_loop → WebSessionClient → Hub → 浏览器。

验证 Web 模式分发：
  - 思考链（thinking_delta / thinking_end）
  - 流式文本（assistant_delta / assistant_final）
  - 工具卡（tool_start / tool_end）—— 真实调用 get_current_time（不依赖微信 DB）
  - 假流两轮：先思考→正文→调工具，再思考→完成

运行（用 LearnLove venv，它有 agent 依赖 + agentweb + aiohttp + psutil）：
D:\\DsEdit\\LearnLove\\.venv\\Scripts\\python.exe tests\\test_learnlove_integration.py
"""
import asyncio
import json
import sys
import tempfile
import threading
from pathlib import Path

AGENTHUB = Path(__file__).resolve().parent.parent
LEARNLOVE = Path(r"D:\DsEdit\LearnLove")
sys.path.insert(0, str(AGENTHUB))
sys.path.insert(0, str(LEARNLOVE))

import aiohttp
from aiohttp import web

from hub.app import create_app
from agentweb.client import WebSessionClient
from agent import chat as chat_mod


def fake_stream(messages, tools=None, api_base="", api_key="", model="",
                temperature=0.7, max_tokens=4096, provider="", thinking=False,
                reasoning_effort="", cancel=None):
    """第一轮：思考 → 先说正文 → 调工具；第二轮：思考 → 完成。"""
    called = getattr(fake_stream, "_n", 0)
    fake_stream._n = called + 1
    if called == 0:
        yield {"type": "reasoning", "content": "分析一下现在几点。"}
        yield {"type": "delta", "content": "我先看看当前时间。"}
        yield {"type": "tool_calls",
               "calls": [{"name": "get_current_time", "args": {}, "id": "call_1"}],
               "reasoning_content": "分析一下现在几点。"}
    else:
        yield {"type": "reasoning", "content": "整理回复。"}
        yield {"type": "delta", "content": "现在是"}
        yield {"type": "done", "content": "现在是下午。我帮你整理好了。", "reasoning_content": "整理回复。"}


async def main():
    tmp = tempfile.mkdtemp(prefix="learnloveint")
    app = create_app(tmp)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    hub_url = f"ws://127.0.0.1:{port}/ws/agent"
    holder = {}

    def client_thread():
        c = WebSessionClient(hub_url, label="LearnLove集成测试", file_roots=[tmp])
        holder["c"] = c
        c.run()

    threading.Thread(target=client_thread, daemon=True).start()
    await asyncio.sleep(1.0)

    # 注入 _session 并替换 chat_stream 为假流（chat.py 里 `from agent.llm import chat_stream`
    # 绑定的是模块局部名，须 patch agent.chat.chat_stream）
    chat_mod.chat_stream = fake_stream
    chat_mod._session = holder["c"]

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

        # 驱动工具调用循环（Web 流式路径）。放另一线程跑，避免阻塞事件循环。
        llm_cfg = {"api_base": "http://x", "api_key": "k", "model": "m",
                   "provider": "deepseek", "thinking": True}
        messages = [{"role": "user", "content": "现在几点？帮我整理一下。"}]
        reply = await asyncio.to_thread(chat_mod._execute_tool_loop, messages, llm_cfg)

        # 收集浏览器收到的结构化事件。注意：工具轮前的正文也会先发一条 assistant_final
        # （preamble 收尾），故要收到 2 条 assistant_final（preamble + 最终回复）才停。
        seen = []
        deadline = asyncio.get_event_loop().time() + 5
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=2)
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.TEXT:
                seen.append(json.loads(msg.data))
                if len([e for e in seen if e.get("type") == "assistant_final"]) >= 2:
                    break

        types = [e.get("type") for e in seen]
        print("reply:", reply)
        print("event types:", types)
        assert "thinking_delta" in types and "thinking_end" in types, types
        assert "tool_start" in types and "tool_end" in types, types
        assert "assistant_delta" in types and "assistant_final" in types, types
        assert any("整理好了" in (e.get("content") or "") for e in seen), seen
        assert any("分析一下" in (e.get("content") or "") for e in seen), seen
        assert reply and "整理好了" in reply, reply
        await ws.close()

    chat_mod._session = None
    await runner.cleanup()
    print("LEARNLOVE INTEGRATION PASSED")


if __name__ == "__main__":
    asyncio.run(main())
