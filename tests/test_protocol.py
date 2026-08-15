"""协议新接口：thinking / file / set_meta / settings / require / settings_set。"""
import asyncio
import json
import sys
import tempfile
import threading
from pathlib import Path

AGENTHUB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENTHUB))

import aiohttp
from aiohttp import web

from hub.app import create_app
from agentweb.client import WebSessionClient


async def find_sid(session, port, label, timeout=5):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        r = await session.get(f"http://127.0.0.1:{port}/api/sessions")
        data = await r.json()
        for s in data["live"]:
            if s["label"] == label:
                return s["sid"]
        await asyncio.sleep(0.2)
    raise AssertionError(f"no session for {label}")


async def main():
    tmp = tempfile.mkdtemp(prefix="proto")
    app = create_app(str(Path(tmp) / "data"))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    cli = WebSessionClient(f"ws://127.0.0.1:{port}/ws/agent", label="驱动端",
                           file_roots=["D:\\DsEdit\\Emisinver"])
    setting_applied = {}
    cli.on_setting = lambda k, v: setting_applied.update(key=k, value=v)
    threading.Thread(target=cli.run, daemon=True).start()

    async with aiohttp.ClientSession() as sess:
        sid = await find_sid(sess, port, "驱动端")
        vws = await sess.ws_connect(f"ws://127.0.0.1:{port}/ws/chat/{sid}")
        evs = []

        async def recv_until(predicate, timeout=4):
            deadline = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < deadline:
                try:
                    msg = await asyncio.wait_for(vws.receive(), timeout=1)
                except asyncio.TimeoutError:
                    continue
                if msg.type == aiohttp.WSMsgType.TEXT:
                    ev = json.loads(msg.data)
                    evs.append(ev)
                    if predicate(ev):
                        return ev
            return None

        # 上行：thinking / file / meta / settings
        cli.thinking_delta("推理中")
        cli.thinking_end()
        cli.send_file("D:\\DsEdit\\Emisinver\\a.png", "一张图")
        cli.set_meta(label="科研·exp_test", project_root="/remote/exp_test")
        cli.set_settings([{"key": "model", "label": "模型", "type": "select",
                           "options": [{"label": "v4", "value": "v4"}], "value": "v4"}])
        types = []
        while "settings" not in types:
            await recv_until(lambda e: e["type"] == "settings", timeout=4)
            types = [e["type"] for e in evs]
        print("上行 types =", sorted(set(types)))
        assert "thinking_delta" in types and "thinking_end" in types, types
        assert any(e["type"] == "file" and e["caption"] == "一张图" for e in evs), evs
        assert any(e["type"] == "meta" and e["project_root"] == "/remote/exp_test" for e in evs), evs

        # 下行：settings_set → on_setting
        await vws.send_json({"type": "settings_set", "key": "thinking", "value": True})
        deadline = asyncio.get_event_loop().time() + 3
        while asyncio.get_event_loop().time() < deadline and not setting_applied:
            await asyncio.sleep(0.05)
        print("settings_set applied =", setting_applied)
        assert setting_applied.get("key") == "thinking" and setting_applied.get("value") is True, setting_applied

        # require：agent 阻塞等表单，browser 提交
        req_result = {}
        def do_require():
            req_result["values"] = cli.require("SSH 连接", [
                {"key": "username", "label": "账号", "type": "text"},
                {"key": "password", "label": "密码", "type": "password"},
                {"key": "totp", "label": "动态码", "type": "otp"},
            ])
        threading.Thread(target=do_require, daemon=True).start()
        req_ev = await recv_until(lambda e: e["type"] == "requirement", timeout=4)
        assert req_ev, "no requirement event"
        print("requirement fields =", [f["key"] for f in req_ev["fields"]])
        await vws.send_json({"type": "requirement_answer", "id": req_ev["id"],
                             "values": {"username": "zwchen", "password": "x", "totp": "123456"}})
        deadline = asyncio.get_event_loop().time() + 4
        while asyncio.get_event_loop().time() < deadline and "values" not in req_result:
            await asyncio.sleep(0.05)
        print("require values =", req_result.get("values"))
        assert req_result.get("values", {}).get("username") == "zwchen", req_result
        await vws.close()

    cli.stop()
    await asyncio.sleep(0.5)
    await runner.cleanup()
    print("PROTOCOL PASSED")


if __name__ == "__main__":
    asyncio.run(main())
