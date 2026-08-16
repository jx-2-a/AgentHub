"""Hub 运行时设置(持久化 data/settings.json):通知推送开关等。"""
import json
import threading
from pathlib import Path


class HubSettings:
    def __init__(self, data_dir):
        self._path = Path(data_dir) / "settings.json"
        self._data = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        try:
            self._data = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            self._data = {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        with self._lock:
            self._data[key] = value
            try:
                self._path.write_text(
                    json.dumps(self._data, ensure_ascii=False, indent=1), encoding="utf-8")
            except OSError:
                pass
