import { useCallback, useEffect, useRef, useState } from 'react';
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

/** /files:大文件页。root=收藏目录边界,不可越过;列表/预览/下载/上传/收藏。 */
export function FilesPage() {
  const [searchParams] = useSearchParams();
  const boundary = searchParams.get('root') ?? ''; // 相对 FILE_ROOT,空 = 整根
  const navigate = useNavigate();
  const favs = useUiStore((s) => s.favorites);
  const addFavorite = useUiStore((s) => s.addFavorite);
  const removeFavorite = useUiStore((s) => s.removeFavorite);
  const openFile = useUiStore((s) => s.openFile);

  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        const q = new URLSearchParams({ path: p });
        if (boundary) q.set('root', boundary);
        const res = await fetch(`/api/files?${q.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '加载失败');
          setEntries([]);
          return;
        }
        setPath(data.path || '');
        setEntries(data.entries || []);
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [boundary],
  );

  useEffect(() => {
    void refresh('');
  }, [refresh]);

  const atBoundary = path === boundary; // ''==='' 或 'Emisinver'==='Emisinver'
  const curIsFav = favs.includes(path);

  // 面包屑:[边界根, ...path 在边界内的子段];边界根不可再往上
  const crumbs: { name: string; path: string; root: boolean }[] = [];
  crumbs.push({ name: boundary ? favName(boundary) : '文件库', path: boundary, root: true });
  let sub = '';
  if (!boundary) sub = path;
  else if (path === boundary) sub = '';
  else if (path.startsWith(boundary + '/')) sub = path.slice(boundary.length + 1);
  const subParts = sub.split('/').filter(Boolean);
  subParts.forEach((s, i) => {
    const joined = subParts.slice(0, i + 1).join('/');
    crumbs.push({ name: s, path: boundary ? `${boundary}/${joined}` : joined, root: false });
  });

  const goUp = () => {
    if (atBoundary) return;
    const parts = path.split('/');
    parts.pop();
    void refresh(parts.join('/'));
  };

  const toggleFav = (p: string) => {
    if (favs.includes(p)) removeFavorite(p);
    else addFavorite(p);
  };

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('path', path);
    if (boundary) fd.append('root', boundary);
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
      url: fileUrl(e.path, boundary),
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
          {atBoundary && boundary ? `🔒 ${favName(boundary)}` : rootName(boundary)}
          {!atBoundary && path ? ` · ${favName(path)}` : ''}
        </div>
        <div id="chat-actions">
          <button
            className={`icon-btn fav-star${curIsFav ? ' on' : ''}`}
            onClick={() => toggleFav(path)}
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
                  if (!(c.root && atBoundary)) void refresh(c.path);
                }}
              >
                {c.root && !boundary ? '📁 ' : ''}
                {c.name}
              </span>
            </span>
          ))}
        </div>
        <div className="files-actions">
          <button className="btn-ghost" onClick={goUp} disabled={atBoundary} title="上一级">
            ↑ 上级
          </button>
          <label className="file-picker" title="上传文件到当前目录">
            ⬆ 上传
            <input
              type="file"
              ref={fileInputRef}
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
            {e.dir && (
              <button
                className={`files-fav${favs.includes(e.path) ? ' on' : ''}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggleFav(e.path);
                }}
                title={favs.includes(e.path) ? '取消收藏' : '收藏此目录'}
              >
                {favs.includes(e.path) ? '★' : '☆'}
              </button>
            )}
            {!e.dir && (
              <a
                className="files-dl"
                href={fileUrl(e.path, boundary, true)}
                onClick={(ev) => ev.stopPropagation()}
                title="下载"
              >
                ↓
              </a>
            )}
          </div>
        ))}
        {!busy && entries.length === 0 && <div className="fb-empty files-empty">（空目录）</div>}
      </div>
    </div>
  );
}

function rootName(boundary: string): string {
  return boundary ? favName(boundary) : '文件库';
}
