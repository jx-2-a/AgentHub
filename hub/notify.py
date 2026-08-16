"""手机推送通知 —— 在 agent 需要用户输入时推送(ask / requirement 等明确信号)。

配置(环境变量,启动 hub 前设置):
  GOTIFY_URL / GOTIFY_TOKEN    → Gotify 推送(支持点通知跳转)
  NOTIFY_URL_TEMPLATE         → 通用模板(PushPlus/Bark/任意 GET webhook):
      Bark(iPhone):   https://api.day.app/KEY/{title}/{content}
      PushPlus(微信): https://www.pushplus.plus/send?token=T&title={title}&content={content}
  HUB_PUBLIC_URL              → 通知点击跳转的 hub 地址(如 http://100.104.123.123:8500),可空

未配置 → 全部 no-op。发送 best-effort、后台线程,不阻塞事件循环。
"""
import json
import os
import threading
import urllib.parse
import urllib.request

GOTIFY_URL = os.environ.get("GOTIFY_URL", "").rstrip("/")
GOTIFY_TOKEN = os.environ.get("GOTIFY_TOKEN", "").strip()
TEMPLATE = os.environ.get("NOTIFY_URL_TEMPLATE", "").strip()
HUB_URL = os.environ.get("HUB_PUBLIC_URL", "").rstrip("/")


def is_enabled() -> bool:
    return bool((GOTIFY_URL and GOTIFY_TOKEN) or TEMPLATE)


def send(title: str, content: str = "", url: str | None = None, priority: int = 8) -> None:
    """推送一条通知(异步、best-effort)。未配置则 no-op。"""
    if not is_enabled():
        return
    if not url and HUB_URL:
        url = HUB_URL
    threading.Thread(target=_send_sync, args=(title, content, url, priority), daemon=True).start()


def _send_sync(title: str, content: str, url: str | None, priority: int) -> None:
    try:
        if GOTIFY_URL and GOTIFY_TOKEN:
            payload = {"title": title, "message": content, "priority": priority}
            if url:
                payload["extras"] = {"client::notification": {"click": {"url": url}}}
            req = urllib.request.Request(
                f"{GOTIFY_URL}/message?token={urllib.parse.quote(GOTIFY_TOKEN)}",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=8).close()
        elif TEMPLATE:
            target = (
                TEMPLATE.replace("{title}", urllib.parse.quote(title))
                .replace("{content}", urllib.parse.quote(content))
            )
            urllib.request.urlopen(target, timeout=8).close()
    except Exception:
        pass  # best-effort,失败静默
