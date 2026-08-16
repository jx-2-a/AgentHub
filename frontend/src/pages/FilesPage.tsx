import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconBack } from '../components/common/icons';
import { useUiStore } from '../stores/uiStore';
import { favName, fileUrl } from '../utils/files';

interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size: number | null;
  mtime: number;
}

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

function fmtSize(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

/**
 * /files:文件大页。路径一律绝对。
 * 无 ?root= → 整机浏览(此电脑 → 各盘);带 ?root= → 收藏边界,不可越界。
 * 顶部 ⭐ 收藏当前目录(任意位置);列表里不再放逐目录星。
 */
export function FilesPage() {
  const [searchParams] = useSearchParams();
  const urlBoundary = searchParams.get('root'); // null = 整机;'' 或路径 = 收藏边界
  const navigate = useNavigate();
  const favs = useUiStore((s) => s.favorites);
  const addFavorite = useUiStore((s) => s.addFavorite);
  const removeFavorite = useUiStore((s) => s.removeFavorite);
  const openFile = useUiStore((s) => s.openFile);

  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [boundary, setBoundary] = useState(urlBoundary ?? ''); // 绝对边界;'' = 整机/此电脑
  const [unbounded, setUnbounded] = useState(urlBoundary === null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        const q = new URLSearchParams({ path: p });
        if (urlBoundary !== null) q.set('root', urlBoundary);
        const res = await fetch(`/api/files?${q.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '加载失败');
          setEntries([]);
          return;
        }
        setPath(data.path || '');
        setEntries(data.entries || []);
        setUnbounded(!!data.unbounded);
        if (data.boundary !== undefined) setBoundary(data.boundary || '');
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [urlBoundary],
  );

  useEffect(() => {
    void refresh('');
  }, [refresh]);

  const atTop = unbounded ? path === '' : path === boundary;

  // 面包屑
  const crumbs: { name: string; path: string; root: boolean }[] = [];
  if (unbounded) {
    crumbs.push({ name: '此电脑', path: '', root: true });
    const parts = path.split('/').filter(Boolean);
    parts.forEach((s, i) => {
      crumbs.push({ name: s, path: parts.slice(0, i + 1).join('/'), root: false });
    });
  } else {
    crumbs.push({ name: boundary ? favName(boundary) : '文件库', path: boundary, root: true });
    let rel = '';
    if (boundary) {
      if (path === boundary) rel = '';
      else if (path.startsWith(boundary + '/')) rel = path.slice(boundary.length + 1);
    }
    const relParts = rel.split('/').filter(Boolean);
    relParts.forEach((s, i) => {
      const joined = relParts.slice(0, i + 1).join('/');
      crumbs.push({ name: s, path: `${boundary}/${joined}`, root: false });
    });
  }

  const goUp = () => {
    if (atTop) return;
    const parts = path.split('/');
    parts.pop();
    void refresh(parts.join('/'));
  };

  // 顶部收藏星:收藏当前目录(任意位置都可以收藏)
  const curIsFav = favs.includes(path);
  const toggleCur = () => {
    if (curIsFav) removeFavorite(path);
    else addFavorite(path);
  };

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('path', path);
    if (urlBoundary !== null) fd.append('root', urlBoundary);
    fd.append('file', f);
    try {
      await fetch('/api/files/upload', { method: 'POST', body: fd });
    } catch {
      /* 静默,刷新即可看到结果 */
    }
    void refresh(path);
  };

  const openEntry = (e: Entry) => {
    if (e.dir) {
      void refresh(e.path);
      return;
    }
    const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
    openFile({
      url: fileUrl(e.path, unbounded ? undefined : boundary || undefined),
      name: e.name,
      kind: IMG_EXT.includes(ext) ? 'image' : 'doc',
    });
  };

  return (
    <div id="files-page">
      <header id="chat-header">
        <button className="icon-btn" onClick={() => navigate('/')} title="返回" aria-label="返回">
          <IconBack />
        </button>
        <div id="chat-title">文件管理</div>
        <div id="chat-status">
          {unbounded
            ? path
              ? favName(path)
              : '此电脑 · 整机'
            : atTop && boundary
              ? `🔒 ${favName(boundary)}`
              : crumbs[0]?.name || '文件库'}
        </div>
        <div id="chat-actions">
          <button
            className={`icon-btn fav-star${curIsFav ? ' on' : ''}`}
            onClick={toggleCur}
            title={curIsFav ? '取消收藏当前目录' : '收藏当前目录'}
          >
            {curIsFav ? '★' : '☆'}
          </button>
        </div>
      </header>

      <div className="files-toolbar">
        <div className="files-crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="fb-sep">/</span>}
              <span
                className={`fb-crumb${c.root ? ' root' : ''}`}
                onClick={() => {
                  if (!(c.root && atTop)) void refresh(c.path);
                }}
              >
                {c.name}
              </span>
            </span>
          ))}
        </div>
        <div className="files-actions">
          <button className="btn-ghost" onClick={goUp} disabled={atTop} title="上一级">
            ↑ 上级
          </button>
          <label className="file-picker" title="上传文件到当前目录">
            ⬆ 上传
            <input
              type="file"
              hidden
              onChange={(e) => {
                void onUpload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn-ghost" onClick={() => void refresh(path)} title="刷新">
            ⟳
          </button>
        </div>
      </div>

      {error && <div className="fb-empty files-empty">{error}</div>}
      <div className="files-list">
        {entries.map((e) => (
          <div key={e.path} className="files-item" onClick={() => openEntry(e)}>
            <span className="files-icon">{e.dir ? '📁' : '📄'}</span>
            <span className="files-name">{e.name}</span>
            <span className="files-meta">{e.dir ? '' : fmtSize(e.size)}</span>
            {!e.dir && (
              <a
                className="files-dl"
                href={fileUrl(e.path, unbounded ? undefined : boundary || undefined, true)}
                onClick={(ev) => ev.stopPropagation()}
                title="下载"
              >
                ↓
              </a>
            )}
          </div>
        ))}
        {!busy && entries.length === 0 && <div className="fb-empty files-empty">（空）</div>}
      </div>
    </div>
  );
}
