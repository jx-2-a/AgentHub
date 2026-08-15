"""主题/背景：预设定义 + 背景图存储。

主题选择本身存浏览器 localStorage（跨会话生效）；服务器只提供预设元数据
和背景图上传（存 data/themes/，经 /theme/bg/<file> 引用）。
"""
import shutil
import uuid
from pathlib import Path

PRESETS = {
    "light": {
        "name": "明亮",
        "vars": {
            "--bg": "#ffffff",
            "--bg-soft": "#f6f8fa",
            "--fg": "#1f2328",
            "--fg-dim": "#656d76",
            "--accent": "#0969da",
            "--bubble-user": "#ddf4ff",
            "--bubble-agent": "#f6f8fa",
            "--border": "#d0d7de",
        },
    },
    "dark": {
        "name": "暗黑",
        "vars": {
            "--bg": "#0d1117",
            "--bg-soft": "#161b22",
            "--fg": "#e6edf3",
            "--fg-dim": "#8b949e",
            "--accent": "#58a6ff",
            "--bubble-user": "#1f6feb33",
            "--bubble-agent": "#161b22",
            "--border": "#30363d",
        },
    },
    "green": {
        "name": "墨绿",
        "vars": {
            "--bg": "#0f1c14",
            "--bg-soft": "#16261b",
            "--fg": "#e6f4ea",
            "--fg-dim": "#8aa89a",
            "--accent": "#2ea043",
            "--bubble-user": "#1f6f2f55",
            "--bubble-agent": "#16261b",
            "--border": "#2b4636",
        },
    },
}


class ThemeStore:
    def __init__(self, data_dir):
        self._dir = Path(data_dir) / "themes"
        self._dir.mkdir(parents=True, exist_ok=True)

    def save_background(self, data, filename):
        """保存上传的背景图，返回可访问的相对 URL。"""
        ext = Path(filename).suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
            ext = ".png"
        name = f"bg-{uuid.uuid4().hex[:8]}{ext}"
        dest = self._dir / name
        dest.write_bytes(data)
        return f"/theme/bg/{name}"

    def serve_background(self, name):
        p = self._dir / name
        if not p.exists():
            return None
        return p
