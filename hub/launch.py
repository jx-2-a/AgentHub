"""Agent Hub 启动入口：python -m hub.launch [--port 8500] [--bind 127.0.0.1] [--data data]

远程（Tailscale）时用 --bind 0.0.0.0，手机开 http://<tailscale-ip>:端口。
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # 保证 hub 包可导入


def _load_dotenv():
    """读项目根 .env(手机推送等配置),已存在的环境变量优先。"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def main():
    _load_dotenv()
    parser = argparse.ArgumentParser(description="Agent Hub — 多 agent 统一 Web 聊天")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AGENT_HUB_PORT", 8500)))
    parser.add_argument("--bind", default=os.environ.get("AGENT_HUB_BIND", "127.0.0.1"))
    parser.add_argument("--data", default=os.environ.get("AGENT_HUB_DATA", "data"))
    args = parser.parse_args()

    from aiohttp import web
    from hub.app import create_app

    app = create_app(args.data, args.bind, args.port)
    url = f"http://{'127.0.0.1' if args.bind in ('127.0.0.1', 'localhost') else args.bind}:{args.port}"
    print(f"Agent Hub: {url}")
    print(f"  数据目录: {os.path.abspath(args.data)}")
    if args.bind == "0.0.0.0":
        print("  已绑定 0.0.0.0 — 远程经 Tailscale 访问，确保网络可信！")
    web.run_app(app, host=args.bind, port=args.port, print=None)


if __name__ == "__main__":
    main()
