import { useNavigate } from 'react-router-dom';
import { deleteTranscript, renameTranscript } from '../../api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore, type ContextMenuItem } from '../../stores/uiStore';

function fmtMtime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 归档记录列表:pinnedOnly 只列置顶归档;点击进入只读回看;右键/⋯ = 打开回看 / 删除。 */
export function ArchivedList({ pinnedOnly }: { pinnedOnly?: boolean }) {
  const archived = useHubStore((s) => s.archived);
  const refresh = useHubStore((s) => s.refresh);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const pinnedArchives = useUiStore((s) => s.pinnedArchives);
  const togglePinArchive = useUiStore((s) => s.togglePinArchive);
  const unpinArchive = useUiStore((s) => s.unpinArchive);
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const list = pinnedOnly
    ? archived.filter((a) => pinnedArchives.includes(a.sid))
    : archived.filter((a) => !pinnedArchives.includes(a.sid));

  if (list.length === 0) {
    return <div className="list-empty">（无）</div>;
  }

  const openTranscript = (sid: string) => {
    if (isMobile) closeSidebar(); // 仅手机端收起抽屉
    navigate(`/transcripts/${sid}`);
  };

  const openMenu = (e: React.MouseEvent, sid: string) => {
    e.preventDefault();
    const pinned = pinnedArchives.includes(sid);
    const items: ContextMenuItem[] = [
      { label: '打开回看', onClick: () => openTranscript(sid) },
      {
        label: pinned ? '取消置顶' : '置顶',
        onClick: () => togglePinArchive(sid),
      },
      {
        label: '重命名',
        onClick: () => {
          const cur = archived.find((x) => x.sid === sid);
          const name = window.prompt('重命名归档', cur?.label || `会话 #${sid}`);
          if (name && name.trim()) {
            void renameTranscript(sid, name.trim()).then(refresh);
          }
        },
      },
      {
        label: '删除记录',
        danger: true,
        onClick: () => {
          if (window.confirm(`删除会话 #${sid} 的记录？`)) {
            unpinArchive(sid); // 记录删了,置顶同步清掉
            void deleteTranscript(sid).then(() => {
              // 正在回看的记录被删 → 回首页
              if (window.location.pathname.startsWith(`/transcripts/${sid}`)) navigate('/');
              void refresh();
            });
          }
        },
      },
    ];
    useUiStore.getState().openContextMenu(e.clientX, e.clientY, items);
  };

  return (
    <>
      {list.map((a) => {
        const pinned = pinnedArchives.includes(a.sid);
        return (
          <div
            key={a.sid}
            className="archived-item"
            onClick={() => openTranscript(a.sid)}
            onContextMenu={(e) => openMenu(e, a.sid)}
          >
            <div className="ar-label">{a.label || `会话 #${a.sid}`}</div>
            <div className="ar-meta">
              {a.label ? `#${a.sid} · ` : ''}
              {fmtMtime(a.mtime)}
            </div>
            <button
              className={`ar-pin ${pinned ? 'on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                togglePinArchive(a.sid);
              }}
              title={pinned ? '取消置顶' : '置顶'}
            >
              {pinned ? '📍' : '📌'}
            </button>
          </div>
        );
      })}
    </>
  );
}
