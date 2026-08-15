"""Agent 库：从 data/agents.json 加载 agent 定义，解析路径。

每个 agent：venv / cwd / cmd / env / hub（是否已接入 SDK）/ file_root / experiments。
"""
import json
from pathlib import Path

DEFAULT_AGENTS_FILE = Path(__file__).resolve().parent.parent / "data" / "agents.json"


def load_agents(path=None):
    p = Path(path) if path else DEFAULT_AGENTS_FILE
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out = {}
    for key, a in data.items():
        cwd = Path(a.get("cwd", "."))
        entry = {
            "key": key,
            "name": a.get("name", key),
            "description": a.get("description", ""),
            "hub": bool(a.get("hub", False)),
            "cwd": str(cwd),
            "file_root": str(cwd / a["file_root"]) if a.get("file_root") else str(cwd),
            "label_default": a.get("label_default", a.get("name", key)),
            "venv": a.get("venv", ""),
            "cmd": list(a.get("cmd", [])),
            "env": dict(a.get("env", {})),
            "experiments": a.get("experiments", "none"),
        }
        out[key] = entry
    return out


def experiment_history(agent, workspace=None):
    """读 agent 的实验历史（Emisinver 的 .agentspace/config/experiment_history.json）。

    返回 [{label, path, last_used}]。其他 agent 返回 []。
    """
    if agent.get("experiments") != "history":
        return []
    # Emisinver 历史文件在 cwd/.agentspace/config/experiment_history.json
    cand = Path(agent["cwd"]) / ".agentspace" / "config" / "experiment_history.json"
    if not cand.exists():
        return []
    try:
        data = json.loads(cand.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [{"label": e.get("label", ""), "path": e.get("path", ""),
             "last_used": e.get("last_used", "")}
            for e in data if e.get("path")][:20]


def to_public(agent):
    """API 返回的 agent 摘要（不含内部命令细节）。"""
    return {
        "key": agent["key"],
        "name": agent["name"],
        "description": agent["description"],
        "hub": agent["hub"],
        "label_default": agent["label_default"],
        "experiments": experiment_history(agent),
    }
