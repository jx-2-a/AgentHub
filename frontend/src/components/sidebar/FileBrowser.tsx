import { useCallback, useEffect, useState } from 'react';
import { useFileTreeStore } from '../../stores/fileTreeStore';
import { useUiStore } from '../../stores/uiStore';
import { favName, fileUrl } from '../../utils/files';

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

/** 侧栏「文件」树:根 = 收藏。收藏根视图列收藏文件夹,进入后钻目录,向上回收藏根。 */
export function FileBrowser() {
  const path = useFileTreeStore((s) => s.path);
  const boundary = useFileTreeStore((s) => s.boundary);
  const enter = useFileTreeStore((s) => s.enter);
  const navigate = useFileTreeStore((s) => s.navigate);
  const toRoot = useFileTreeStore((s) => s.toRoot);
  const favs = useUiStore((s) => s.favorites);
  const removeFavorite = useUiStore((s) => s.removeFavorite);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (p: string) => {
    if (!p) return; // 收藏根视图,不发请求
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        setEntries([]);
        return;
      }
      setEntries(data.entries || []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh(path);
  }, [path, refresh]);

  const openFile = (e: Entry) => {
    const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
    useUiStore.getState().openFile({
      url: fileUrl(e.path),
      name: e.name,
      kind: IMG_EXT.includes(ext) ? 'image' : 'doc',
    });
  };

  // ---- 收藏根视图 ----
  if (path === '') {
    return (
      <div className="file-browser">
        <div className="fb-bar">
          <span className="fb-crumb fb-root">收藏</span>
        </div>
        {favs.length === 0 ? (
          <div className="fb-empty">暂无收藏</div>
        ) : (
          <div className="fb-list">
            {favs.map((p) => (
              <div key={p} className="fb-item" onClick={() => enter(p)} title={`进入 ${favName(p)}`}>
                <span className="fb-icon">📁</span>
                <span className="fb-name">{favName(p)}</span>
                <button
                  className="fb-del"
                  title="取消收藏"
                  aria-label="取消收藏"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(p);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- 树内视图(在某个收藏里钻) ----
  let rel = path;
  if (boundary) {
    if (path === boundary) rel = '';
    else if (path.startsWith(boundary + '/')) rel = path.slice(boundary.length + 1);
  }
  const relParts = rel.split('/').filter(Boolean);
  const crumbs: { name: string; path: string; kind: 'root' | 'boundary' | 'seg' }[] = [
    { name: '收藏', path: '', kind: 'root' },
    { name: favName(boundary), path: boundary, kind: 'boundary' },
    ...relParts.map((s, i) => ({
      name: s,
      path: `${boundary}/${relParts.slice(0, i + 1).join('/')}`,
      kind: 'seg' as const,
    })),
  ];

  return (
    <div className="file-browser">
      <div className="fb-bar">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="fb-sep">/</span>}
            <span
              className={`fb-crumb${c.kind === 'root' ? ' fb-root' : ''}`}
              onClick={() => (c.kind === 'root' ? toRoot() : navigate(c.path))}
            >
              {c.name}
            </span>
          </span>
        ))}
      </div>
      {error && <div className="fb-empty">{error}</div>}
      <div className="fb-list">
        {entries.map((e) => (
          <div key={e.path} className="fb-item" onClick={() => (e.dir ? navigate(e.path) : openFile(e))}>
            <span className="fb-icon">{e.dir ? '📁' : '📄'}</span>
            <span className="fb-name">{e.name}</span>
            <span className="fb-meta">{e.dir ? '' : fmtSize(e.size)}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="fb-empty">（空）</div>}
      </div>
    </div>
  );
}
