import { useNavigate } from 'react-router-dom';
import { deleteTranscript } from '../../api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore, type ContextMenuItem } from '../../stores/uiStore';

function fmtMtime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 归档记录列表:点击进入只读回看;右键/⋯ 菜单 = 打开回看 / 删除记录。 */
export function ArchivedList() {
  const archived = useHubStore((s) => s.archived);
  const refresh = useHubStore((s) => s.refresh);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');

  if (archived.length === 0) {
    return <div className="list-empty">（无）</div>;
  }

  const openTranscript = (sid: string) => {
    if (isMobile) closeSidebar(); // 仅手机端收起抽屉
    navigate(`/transcripts/${sid}`);
  };

  const openMenu = (e: React.MouseEvent, sid: string) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { label: '打开回看', onClick: () => openTranscript(sid) },
      {
        label: '删除记录',
        danger: true,
        onClick: () => {
          if (window.confirm(`删除会话 #${sid} 的记录？`)) {
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
      {archived.map((a) => (
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
        </div>
      ))}
    </>
  );
}
