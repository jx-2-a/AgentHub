"""会话记录落盘（JSONL）+ 回看。"""
import json
import time
from pathlib import Path


class TranscriptStore:
    def __init__(self, data_dir):
        self._dir = Path(data_dir) / "transcripts"
        self._dir.mkdir(parents=True, exist_ok=True)

    def path_for(self, sid):
        return self._dir / f"{sid}.jsonl"

    def append(self, sid, event):
        try:
            with open(self.path_for(sid), "a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def read(self, sid):
        return self.read_range(sid, 0, -1)

    def read_range(self, sid, start, end):
        """只读转录 [start,end) 行（游标分页用，不整读大文件）。end<0 表示读到末尾。"""
        p = self.path_for(sid)
        if not p.exists():
            return []
        events = []
        try:
            with open(p, encoding="utf-8") as f:
                for idx, line in enumerate(f):
                    if end >= 0 and idx >= end:
                        break
                    if idx < start:
                        continue
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            return []
        return events

    def delete(self, sid):
        """删除某会话的 JSONL 记录。"""
        p = self.path_for(sid)
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass

    # --- 永久归档:独立于临时记录,剪切过去的内容;删除实例不删归档 ---

    def archive_path(self, sid):
        return self._dir.parent / "archives" / f"{sid}.jsonl"

    def archive_append(self, sid, events):
        try:
            with open(self.archive_path(sid), "a", encoding="utf-8") as f:
                for ev in events:
                    f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def archive_read(self, sid):
        p = self.archive_path(sid)
        if not p.exists():
            return []
        events = []
        try:
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            return []
        return events

    def archive_delete(self, sid):
        """删除归档文件 + 归档标记(右键归档卡"删除记录")。"""
        for p in (self.archive_path(sid), self._archives_dir() / f"{sid}.json"):
            try:
                p.unlink()
            except OSError:
                pass

    # --- 显式归档标记:归档卡片只列这些(用过"归档以上/完全归档"才建卡) ---

    def _archives_dir(self):
        d = self._dir.parent / "archives"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def is_archived(self, sid):
        return (self._archives_dir() / f"{sid}.json").exists()

    def mark_archived(self, sid, label):
        p = self._archives_dir() / f"{sid}.json"
        try:
            p.write_text(json.dumps({"sid": sid, "label": label, "archived_at": time.time()},
                                    ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def unmark_archived(self, sid):
        p = self._archives_dir() / f"{sid}.json"
        try:
            p.unlink()
        except OSError:
            pass

    def rename_archived(self, sid, label):
        """改归档卡显示名(保留归档时间)。"""
        p = self._archives_dir() / f"{sid}.json"
        data = {"sid": sid, "label": label, "archived_at": time.time()}
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                data["label"] = label
            except Exception:
                pass
        try:
            p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def archived_list(self):
        """已显式归档的会话: [(sid, label, archived_at)] 按时间降序。"""
        out = []
        d = self._dir.parent / "archives"
        try:
            for p in d.glob("*.json"):
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                out.append((p.stem, data.get("label", ""), data.get("archived_at", 0)))
        except OSError:
            return []
        out.sort(key=lambda x: x[2], reverse=True)
        return out

    def list(self):
        """(sid, size, mtime, label) 按 mtime 降序。label 从转录首条 meta 事件解析(同名归档卡)。"""
        items = []
        try:
            files = list(self._dir.glob("*.jsonl"))
        except OSError:
            return []
        for p in files:
            try:
                st = p.stat()
            except OSError:
                continue
            if st.st_size == 0:
                continue
            label = None
            try:
                with open(p, encoding="utf-8") as f:
                    for i, line in enumerate(f):
                        if i >= 8:      # meta 事件在转录开头,只查前几行
                            break
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            ev = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if ev.get("type") == "meta" and ev.get("label"):
                            label = ev["label"]
                            break
            except OSError:
                pass
            items.append((p.stem, st.st_size, st.st_mtime, label))
        items.sort(key=lambda x: x[2], reverse=True)
        return items
