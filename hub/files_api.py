"""文件浏览(侧栏「文件」块):在 FILE_ROOT 内浏览/上传/预览,免登录。

路径越界防护:_within 校验。复用 hub/files.py 的 guess_type。
"""
import os
from pathlib import Path

from aiohttp import web

from .files import guess_type

# 默认根:D:\DsEdit(含各 agent 项目),可用 FILE_ROOT 覆盖
_FILE_ROOT_DEFAULT = str(Path(__file__).resolve().parent.parent.parent)
FILE_ROOT = os.environ.get("FILE_ROOT", "").strip() or _FILE_ROOT_DEFAULT


def _root() -> Path:
    return Path(FILE_ROOT).resolve()


def _resolve(path: str) -> Path | None:
    """把相对路径解析为根内绝对路径;越界返回 None。"""
    if not path:
        return _root()
    p = Path(path)
    cand = (p if p.is_absolute() else _root() / p).resolve()
    try:
        cand.relative_to(_root())
    except ValueError:
        return None
    return cand


def _resolve_boundary(root: str) -> Path | None:
    """解析 ?root= 参数(收藏根)为根内绝对路径;省略/为空 = FILE_ROOT。"""
    if not root:
        return _root()
    p = Path(root)
    cand = (p if p.is_absolute() else _root() / p).resolve()
    try:
        cand.relative_to(_root())
    except ValueError:
        return None
    return cand


def _resolve_in(boundary: Path, path: str) -> Path | None:
    """解析 path(相对 FILE_ROOT)到绝对路径;必须在 boundary 内,否则 None。"""
    if not path:
        return boundary
    p = Path(path)
    cand = (p if p.is_absolute() else _root() / p).resolve()
    try:
        cand.relative_to(_root())
    except ValueError:
        return None
    try:
        cand.relative_to(boundary)
    except ValueError:
        return None
    return cand


async def api_list(request):
    """列目录。?path= 相对根路径,&root= 限定浏览边界(收藏根,不可越界)。"""
    boundary = _resolve_boundary(request.query.get("root", ""))
    if boundary is None:
        return web.json_response({"error": "根越界"}, status=403)
    cand = _resolve_in(boundary, request.query.get("path", ""))
    if cand is None or not cand.is_dir():
        return web.json_response({"error": "目录不存在或越界"}, status=404)
    root = _root()
    entries = []
    for p in sorted(cand.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        try:
            st = p.stat()
        except OSError:
            continue
        entries.append({
            "name": p.name,
            "path": str(p.relative_to(root)).replace("\\", "/"),
            "dir": p.is_dir(),
            "size": st.st_size if p.is_file() else None,
            "mtime": st.st_mtime,
        })
    cur = "" if cand == root else str(cand.relative_to(root)).replace("\\", "/")
    # 返回当前浏览边界(相对根),前端据此决定能否再往上走
    root_rel = "" if boundary == _root() else str(boundary.relative_to(_root())).replace("\\", "/")
    return web.json_response({"root": str(root), "path": cur, "boundary": root_rel, "entries": entries})


async def api_upload(request):
    """上传文件到根内。表单:path=目标目录(相对根), root=浏览边界, file=文件。"""
    reader = await request.multipart()
    target_dir = ""
    target_root = ""
    file_part = None
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "path":
            target_dir = (await part.read()).decode("utf-8", errors="ignore")
        elif part.name == "root":
            target_root = (await part.read()).decode("utf-8", errors="ignore")
        elif part.name == "file":
            file_part = part
    if file_part is None:
        return web.json_response({"error": "缺少文件"}, status=400)
    boundary = _resolve_boundary(target_root or "")
    if boundary is None:
        return web.json_response({"error": "根越界"}, status=403)
    dir_cand = _resolve_in(boundary, target_dir or "")
    if dir_cand is None or not dir_cand.is_dir():
        return web.json_response({"error": "目标目录不存在或越界"}, status=400)
    filename = Path(file_part.filename or "upload").name  # 只取文件名,防路径注入
    dest = (dir_cand / filename).resolve()
    try:
        dest.relative_to(_root())
    except ValueError:
        return web.json_response({"error": "路径越界"}, status=403)
    try:
        with open(dest, "wb") as f:
            while True:
                chunk = await file_part.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
    except OSError as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"ok": True, "name": filename})


async def api_file(request):
    """预览/下载根内文件。?path= 相对根,&root= 限定边界。"""
    boundary = _resolve_boundary(request.query.get("root", ""))
    if boundary is None:
        raise web.HTTPForbidden(text="根越界")
    cand = _resolve_in(boundary, request.query.get("path", ""))
    if cand is None or not cand.is_file():
        raise web.HTTPNotFound(text="文件不存在或越界")
    mime, inline = guess_type(cand)
    headers = {}
    # ?download=1 强制附件下载(即使可内联预览的类型)
    if not inline or request.query.get("download") == "1":
        headers["Content-Disposition"] = f'attachment; filename="{cand.name}"'
    return web.FileResponse(cand, headers=headers)
