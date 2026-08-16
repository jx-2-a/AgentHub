"""文件浏览/上传/预览,免登录。路径统一用绝对路径(正斜杠)。

两种模式:
- 带 ?root=:收藏边界模式,path 必须在 boundary 内,不可越界。
  root 相对 → FILE_ROOT 内;绝对 → 任意位置。
- 不带 root:整机浏览,path 为空 = 此电脑(各盘)。

越界防护:_resolve_boundary/_resolve_in 校验。复用 hub/files.py 的 guess_type。
"""
import os
import string
from pathlib import Path

from aiohttp import web

from .files import guess_type

# 默认根:D:\DsEdit(含各 agent 项目),可用 FILE_ROOT 覆盖
_FILE_ROOT_DEFAULT = str(Path(__file__).resolve().parent.parent.parent)
FILE_ROOT = os.environ.get("FILE_ROOT", "").strip() or _FILE_ROOT_DEFAULT


def _root() -> Path:
    return Path(FILE_ROOT).resolve()


def _norm(p: Path) -> str:
    """路径转正斜杠(Windows 盘符友好)。"""
    return str(p).replace("\\", "/")


def _resolve_boundary(root: str) -> Path | None:
    """?root= 收藏边界。空 → FILE_ROOT;相对 → FILE_ROOT 内;绝对 → 任意路径。"""
    if not root:
        return _root()
    p = Path(root)
    cand = (p if p.is_absolute() else _root() / p).resolve()
    if not p.is_absolute():
        try:
            cand.relative_to(_root())
        except ValueError:
            return None
    return cand


def _resolve_in(boundary: Path | None, path: str) -> Path | None:
    """解析 path(始终绝对路径;空 = boundary 本身,或此电脑)。boundary 非空时必须在界内。"""
    if not path:
        return boundary
    p = Path(path)
    cand = (p if p.is_absolute() else Path.cwd() / p).resolve()
    if boundary is not None:
        try:
            cand.relative_to(boundary)
        except ValueError:
            return None
    return cand


def _drive_entries() -> list[dict]:
    out = []
    for letter in string.ascii_uppercase:
        p = Path(f"{letter}:\\")
        try:
            if p.exists():
                out.append({"name": f"{letter}:", "path": f"{letter}:/",
                            "dir": True, "size": None, "mtime": 0})
        except OSError:
            continue
    return out


def _iter_entries(base: Path) -> list[dict]:
    out = []
    for p in sorted(base.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        try:
            st = p.stat()
        except OSError:
            continue
        out.append({
            "name": p.name,
            "path": _norm(p),
            "dir": p.is_dir(),
            "size": st.st_size if p.is_file() else None,
            "mtime": st.st_mtime,
        })
    return out


async def api_list(request):
    """列目录。?path= 绝对路径,&root= 收藏边界(省略 = 整机浏览)。"""
    root_present = "root" in request.query
    boundary = _resolve_boundary(request.query.get("root", "")) if root_present else None
    if root_present and boundary is None:
        return web.json_response({"error": "根越界"}, status=403)

    if boundary is None:
        cand = _resolve_in(None, request.query.get("path", ""))
        if cand is None:
            return web.json_response({
                "root": _norm(_root()), "path": "", "boundary": "",
                "entries": _drive_entries(), "unbounded": True,
            })
        if not cand.is_dir():
            return web.json_response({"error": "目录不存在"}, status=404)
        return web.json_response({
            "root": _norm(_root()), "path": _norm(cand), "boundary": "",
            "entries": _iter_entries(cand), "unbounded": True,
        })

    cand = _resolve_in(boundary, request.query.get("path", ""))
    if cand is None or not cand.is_dir():
        return web.json_response({"error": "目录不存在或越界"}, status=404)
    return web.json_response({
        "root": _norm(_root()), "path": _norm(cand), "boundary": _norm(boundary),
        "entries": _iter_entries(cand),
    })


async def api_upload(request):
    """上传文件。表单:path=目标目录(绝对), root=边界(省略 = 整机), file=文件。"""
    reader = await request.multipart()
    target_dir = ""
    target_root_present = False
    target_root = ""
    file_part = None
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "path":
            target_dir = (await part.read()).decode("utf-8", errors="ignore")
        elif part.name == "root":
            target_root_present = True
            target_root = (await part.read()).decode("utf-8", errors="ignore")
        elif part.name == "file":
            file_part = part
    if file_part is None:
        return web.json_response({"error": "缺少文件"}, status=400)

    boundary = _resolve_boundary(target_root) if target_root_present else None
    if target_root_present and boundary is None:
        return web.json_response({"error": "根越界"}, status=403)
    dir_cand = _resolve_in(boundary, target_dir or "")
    if dir_cand is None or not dir_cand.is_dir():
        return web.json_response({"error": "目标目录不存在或越界"}, status=400)

    filename = Path(file_part.filename or "upload").name  # 只取文件名,防路径注入
    dest = (dir_cand / filename).resolve()
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
    """预览/下载文件。?path= 绝对路径,&root= 边界(省略 = 整机)。"""
    root_present = "root" in request.query
    boundary = _resolve_boundary(request.query.get("root", "")) if root_present else None
    if root_present and boundary is None:
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
