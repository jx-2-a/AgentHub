"""文件服务：在会话注册的 file_roots 内按路径服务，_within 越界校验。

浏览器点击 agent 输出里的文件路径 → `/file?sid=&path=` → 校验 + MIME 预览。
"""
import mimetypes
from pathlib import Path


def resolve(session, path):
    """把请求路径解析为绝对路径；不在任何 file_root 内返回 None。"""
    if not path or not session.file_roots:
        return None
    p = Path(path)
    for root in session.file_roots:
        base = Path(root).resolve()
        cand = p if p.is_absolute() else (base / p)
        cand = cand.resolve()
        if not cand.exists() or not cand.is_file():
            continue
        try:
            cand.relative_to(base)
            return cand
        except ValueError:
            continue
    return None


def guess_type(path):
    """按扩展名返回 (mime, 是否可内联预览)。"""
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or "application/octet-stream"
    if mime.startswith("image/"):
        return mime, True
    if mime.startswith("text/") or mime in (
            "application/json", "application/x-yaml", "application/javascript",
            "application/xml", "application/x-sh"):
        return mime, True
    return mime, False
