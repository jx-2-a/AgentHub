"""实例管理：Hub 直接启动/停止 agent 子进程（无终端窗口），agent 连回 /ws/agent。

启动：venv python <cmd> --hub ws://127.0.0.1:<port>/ws/agent --label <标签> --file-root <root>
连回：register 带 instance_id（env AGENT_HUB_INSTANCE）→ Hub 把实例与会话关联。
自动恢复：在跑实例列表落盘 data/instances/active.json，Hub 重启后 restore() 重新拉起。
"""
import json
import os
import subprocess
import threading
import time
from pathlib import Path

from . import agents as agents_mod

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class Instance:
    def __init__(self, inst_id, agent_key, label):
        self.id = inst_id
        self.agent_key = agent_key
        self.label = label
        self.pid = None
        self.proc = None
        self.status = "starting"        # starting | connected | exited
        self.created = time.time()
        self.session_id = None
        self.error = None
        self.log_path = None
        self.resume_sid = None           # 重启时续接的旧会话(agent 需接受 --resume)

    def to_dict(self):
        return {
            "id": self.id,
            "agent_key": self.agent_key,
            "label": self.label,
            "pid": self.pid,
            "status": self.status,
            "created": self.created,
            "session_id": self.session_id,
            "error": self.error,
        }


class InstanceManager:
    def __init__(self, hub_port, hub_host="127.0.0.1", data_dir="data"):
        self._port = hub_port
        self._host = hub_host
        self._data_dir = Path(data_dir)
        self._log_dir = self._data_dir / "instances"
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._active_file = self._data_dir / "instances" / "active.json"
        self._instances = {}
        self._by_session = {}
        self._counter = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # 在跑实例落盘（Hub 重启后 restore 重新拉起）
    # ------------------------------------------------------------------

    def _save_active(self):
        try:
            active = [{"agent_key": i.agent_key, "label": i.label}
                      for i in self._instances.values()
                      if i.status in ("starting", "connected")]
            self._active_file.write_text(
                json.dumps(active, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass

    def restore(self):
        """Hub 启动时重新拉起上次在跑的实例（agent 重连后记录仍在，可回看）。"""
        try:
            if not self._active_file.exists():
                return
            active = json.loads(self._active_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        for entry in active:
            try:
                self.spawn(entry.get("agent_key", ""), entry.get("label", ""))
            except Exception:
                pass

    def list(self):
        with self._lock:
            return [i.to_dict() for i in self._instances.values()]

    def get(self, inst_id):
        with self._lock:
            return self._instances.get(inst_id)

    def spawn(self, agent_key, label=None):
        agent = agents_mod.load_agents().get(agent_key)
        if not agent:
            raise KeyError(f"未知 agent: {agent_key}")
        with self._lock:
            self._counter += 1
            inst_id = str(self._counter)
        inst = Instance(inst_id, agent_key, label or agent["label_default"])
        self._instances[inst_id] = inst
        self._launch(inst, agent)
        return inst

    def restart(self, inst_id, resume=False):
        """重启实例(复用同一条目):先停,再按原 agent/label 重拉。
        resume=True 时续接旧会话(传 --resume <sid>;agent 需接受该参数)。"""
        inst = self._instances.get(inst_id)
        if not inst:
            raise KeyError(f"未知实例: {inst_id}")
        agent = agents_mod.load_agents().get(inst.agent_key)
        if not agent:
            raise KeyError(f"未知 agent: {inst.agent_key}")
        old_sid = inst.session_id
        self.stop(inst_id)
        inst.resume_sid = old_sid if (resume and old_sid) else None
        inst.pid = None
        inst.proc = None
        inst.status = "starting"
        inst.session_id = None
        inst.error = None
        self._launch(inst, agent)
        return inst

    def _launch(self, inst, agent):
        """按实例条目 + agent 定义启动子进程(复用实例条目,不新建)。"""
        if not agent["hub"]:
            # 未接入 SDK 的 agent：无法经 Hub 交互，标记不可启动
            inst.status = "exited"
            inst.error = "该 agent 尚未接入 AgentHub SDK"
            return

        cmd = [agent["venv"], *agent["cmd"],
               "--hub", f"ws://127.0.0.1:{self._port}/ws/agent",
               "--label", inst.label,
               "--file-root", agent["file_root"]]
        if inst.resume_sid:
            cmd += ["--resume", inst.resume_sid]
        env = dict(os.environ)
        for k, v in agent["env"].items():
            env[k] = v if v != "." else agent["cwd"]
        env["AGENT_HUB_INSTANCE"] = inst.id

        inst.log_path = self._log_dir / f"{inst.id}.log"
        try:
            logf = open(inst.log_path, "a", encoding="utf-8")
            proc = subprocess.Popen(cmd, cwd=agent["cwd"], env=env,
                                    stdout=logf, stderr=subprocess.STDOUT,
                                    creationflags=_NO_WINDOW)
            inst.proc = proc
            inst.pid = proc.pid
        except Exception as e:
            inst.status = "exited"
            inst.error = str(e)
            return

        threading.Thread(target=self._watch, args=(inst.id,), daemon=True).start()
        self._save_active()

    def stop(self, inst_id):
        inst = self._instances.get(inst_id)
        if not inst or inst.proc is None or inst.proc.poll() is not None:
            return
        try:
            subprocess.run(["taskkill", "/PID", str(inst.pid), "/T", "/F"],
                           capture_output=True)
        except Exception:
            pass
        inst.status = "exited"
        self._save_active()

    def _watch(self, inst_id):
        inst = self._instances.get(inst_id)
        if not inst or inst.proc is None:
            return
        inst.proc.wait()
        if inst.status != "exited":
            inst.status = "exited"
            self._save_active()

    def link_session(self, inst_id, session_id):
        with self._lock:
            inst = self._instances.get(inst_id)
            if inst:
                inst.session_id = session_id
                inst.status = "connected"
                self._by_session[session_id] = inst_id

    def update_label(self, inst_id, label):
        inst = self._instances.get(inst_id)
        if inst and label:
            inst.label = label

    def session_instance(self, session_id):
        with self._lock:
            return self._by_session.get(session_id)

    def remove(self, inst_id):
        """从实例列表中移除(先停止)。供"删除实例"用。"""
        inst = self._instances.pop(inst_id, None)
        if inst and inst.session_id:
            self._by_session.pop(inst.session_id, None)
        self._save_active()

    def shutdown(self):
        for inst_id in list(self._instances):
            self.stop(inst_id)
