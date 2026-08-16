"""会话注册表与 Session 模型。

每个连接的 agent = 一个 Session：持有 agent 的 WS、浏览器 viewer 集合、内存历史。
同一 agent 断线重连（register 带 resume_sid）复用原 Session，记录续写。
"""
import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class Session:
    sid: str
    label: str = "agent"
    file_roots: list = field(default_factory=list)
    capabilities: list = field(default_factory=list)
    created: float = field(default_factory=time.time)
    status: str = "connected"          # connected | disconnected | exited
    agent_ws: object = None            # aiohttp WebSocketResponse（agent 连接）
    agent_out: object = None           # asyncio.Queue：浏览器输入 → agent 的发送队列
    viewers: set = field(default_factory=set)
    history: deque = field(default_factory=lambda: deque(maxlen=2000))  # 重连重放上限,和前端对齐
    last_ask: dict = None              # 最近一个 pending ask（新 viewer 连入时补发）
    last_requirement: dict = None      # 最近一个 pending requirement（新 viewer 连入时补发）
    last_sleep: dict = None            # 最近一个休眠倒计时（新 viewer 连入时补发）
    last_settings: dict = None         # 最近一次 settings(运行时参数),每次连入都发 → 设置面板永有参数
    instance_id: str = None            # 由 Hub 实例管理启动的 agent（AGENT_HUB_INSTANCE）
    project_root: str = None           # 会话选定的实验路径（meta 事件更新，用于分类）
    last_active: float = field(default_factory=time.time)

    def touch(self):
        self.last_active = time.time()

    def trim_history(self, keep):
        """归档以上内容:只保留最近 keep 条内存历史(旧事件已在转录落盘,仅限内存+重放)。"""
        if keep <= 0:
            self.history.clear()
            return
        while len(self.history) > keep:
            self.history.popleft()

    def to_dict(self):
        return {
            "sid": self.sid,
            "label": self.label,
            "status": self.status,
            "file_roots": list(self.file_roots),
            "project_root": self.project_root,
            "created": self.created,
            "last_active": self.last_active,
            "viewers": len(self.viewers),
            "history_len": len(self.history),
            "online": self.agent_ws is not None,
        }


class SessionRegistry:
    """sid → Session。单事件循环访问，无需锁。"""

    def __init__(self):
        self._sessions = {}
        self._counter = 0

    def _next_sid(self):
        self._counter += 1
        return str(self._counter)

    def get(self, sid):
        return self._sessions.get(sid)

    def all(self):
        return list(self._sessions.values())

    def create(self, label, file_roots, capabilities):
        sid = self._next_sid()
        s = Session(sid=sid, label=label, file_roots=list(file_roots),
                    capabilities=list(capabilities))
        self._sessions[sid] = s
        return s

    def reuse(self, sid, label):
        """按 resume_sid 复用断线会话（label 一致且非在线）。"""
        s = self._sessions.get(sid)
        if s and s.label == label and s.agent_ws is None:
            return s
        return None

    def remove(self, sid):
        self._sessions.pop(sid, None)
