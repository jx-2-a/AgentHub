"""会话注册表与 Session 模型。

每个连接的 agent = 一个 Session：持有 agent 的 WS、浏览器 viewer 集合、内存历史。
同一 agent 断线重连（register 带 resume_sid）复用原 Session，记录续写。
会话元数据落盘(data/sessions.json):Hub 重启后 restore() 重建注册表 + 从转录重放历史,
让「重启服务」后 agent 能真正续接原会话、浏览器仍能看到旧记录。
"""
import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path


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
    sleep_since: float = 0             # 休眠开始时刻(重连时按剩余秒数补发,不重置倒计时)
    last_settings: dict = None         # 最近一次 settings(运行时参数),每次连入都发 → 设置面板永有参数
    instance_id: str = None            # 由 Hub 实例管理启动的 agent（AGENT_HUB_INSTANCE）
    project_root: str = None           # 会话选定的实验路径（meta 事件更新，用于分类）
    last_active: float = field(default_factory=time.time)
    # --- 事件流游标（历史分页窗口 + 上次看到位置）---
    stream_len: int = 0                # 转录总事件数（也=下一行号）
    clean_points: list = field(default_factory=list)  # 干净切点行号（无未闭合思考/回复/工具）
    read_pos: int = 0                  # 上次看到的事件数（客户端贴底上报）
    _o_thinking: bool = False          # 增量镜像:思考块开
    _o_assistant: bool = False         # 增量镜像:回复块开
    _o_tools: int = 0                  # 增量镜像:未闭合工具数

    def touch(self):
        self.last_active = time.time()

    def mark_event(self, ev):
        """事件已入列（history+转录）:推进 stream_len，维护开闭镜像，闭合时记一个干净切点。
        镜像与前端 reducer 一致：thinking_delta 开思；assistant_delta/final 先收思；thinking_end 收思；
        assistant_final/end 收回；tool_start/end 记工具。"""
        self.stream_len += 1
        t = ev.get("type")
        if t == "thinking_delta":
            self._o_thinking = True
        elif t == "assistant_delta":
            self._o_thinking = False
            self._o_assistant = True
        elif t == "thinking_end":
            self._o_thinking = False
        elif t == "assistant_final":
            self._o_thinking = False
            self._o_assistant = False
        elif t == "assistant_end":
            self._o_assistant = False
        elif t == "tool_start":
            self._o_tools += 1
        elif t == "tool_end":
            self._o_tools = max(0, self._o_tools - 1)
        if not (self._o_thinking or self._o_assistant or self._o_tools):
            self.clean_points.append(self.stream_len)

    def reset_log(self):
        """归档以上内容:转录已剪切走,事件流游标全部清零。"""
        self.stream_len = 0
        self.clean_points = []
        self.read_pos = 0
        self._o_thinking = False
        self._o_assistant = False
        self._o_tools = 0

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
            "read_pos": self.read_pos,
        }


class SessionRegistry:
    """sid → Session。单事件循环访问，无需锁。data_dir 给定时会落盘会话元数据。"""

    def __init__(self, data_dir=None):
        self._sessions = {}
        self._counter = 0
        self._state_file = Path(data_dir) / "sessions.json" if data_dir else None

    def _next_sid(self):
        self._counter += 1
        return str(self._counter)

    def persist(self):
        """把会话元数据落盘,供重启恢复。"""
        if not self._state_file:
            return
        try:
            data = [{
                "sid": s.sid, "label": s.label,
                "file_roots": list(s.file_roots),
                "capabilities": list(s.capabilities),
                "instance_id": s.instance_id,
                "project_root": s.project_root,
                "created": s.created,
                "read_pos": s.read_pos,
            } for s in self._sessions.values()]
            self._state_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass

    def restore(self, transcripts):
        """重建注册表:从 sessions.json 恢复会话 + 从转录重放历史(重连/回看有旧记录)。"""
        if not self._state_file or not self._state_file.exists():
            return
        try:
            data = json.loads(self._state_file.read_text(encoding="utf-8"))
        except Exception:
            return
        for item in data:
            sid = str(item.get("sid", ""))
            if not sid:
                continue
            s = Session(
                sid=sid,
                label=item.get("label") or "agent",
                file_roots=list(item.get("file_roots") or []),
                capabilities=list(item.get("capabilities") or []),
                created=float(item.get("created") or time.time()),
            )
            s.instance_id = item.get("instance_id")
            s.project_root = item.get("project_root")
            s.read_pos = int(item.get("read_pos") or 0)
            s.status = "disconnected"   # 重启后 agent 还没连回来
            for ev in transcripts.read(sid):
                # 内存 history 只存 agent 事件(meta 是会话登记行,只占转录/游标)
                if ev.get("type") != "meta":
                    s.history.append(ev)
                s.mark_event(ev)        # 重建 stream_len + clean_points(位置=转录行号)
            self._sessions[sid] = s
            if sid.isdigit():
                self._counter = max(self._counter, int(sid))

    def get(self, sid):
        return self._sessions.get(sid)

    def all(self):
        return list(self._sessions.values())

    def create(self, label, file_roots, capabilities):
        sid = self._next_sid()
        s = Session(sid=sid, label=label, file_roots=list(file_roots),
                    capabilities=list(capabilities))
        self._sessions[sid] = s
        self.persist()
        return s

    @staticmethod
    def _free(s):
        """会话可复用:无 agent 连接,或连接已关闭(agent 刚被杀/重启)。"""
        return s.agent_ws is None or getattr(s.agent_ws, "closed", False)

    def reuse(self, sid, label):
        """按 resume_sid 复用断线会话（label 一致且可复用）。"""
        s = self._sessions.get(sid)
        if s and s.label == label and self._free(s):
            return s
        return None

    def by_instance(self, instance_id):
        """按实例 id 找回原会话（agent 状态里的 resume_sid 可能过期时兜底）。
        取该实例最近创建的会话(历史累积的旧会话不干扰)。"""
        if not instance_id:
            return None
        best = None
        for s in self._sessions.values():
            if s.instance_id == instance_id and self._free(s):
                if best is None or s.created > best.created:
                    best = s
        return best

    def remove(self, sid):
        self._sessions.pop(sid, None)
        self.persist()

    def prune(self, instances):
        """清理孤儿会话:instance_id 指向已不存在的实例(删除/重启遗留)。"""
        if not self._state_file:
            return
        live_ids = {i["id"] for i in instances.list()}
        removed = False
        for sid, s in list(self._sessions.items()):
            if s.instance_id and s.instance_id not in live_ids:
                self._sessions.pop(sid, None)
                removed = True
        if removed:
            self.persist()
