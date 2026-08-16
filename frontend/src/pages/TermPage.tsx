import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBack } from '../components/common/icons';
import { TerminalView } from '../components/term/TerminalView';
import { useUiStore, type TermConn } from '../stores/uiStore';

const STATUS_TEXT: Record<TermConn, string> = {
  connecting: '连接中…',
  connected: '系统 Shell · ← 退出',
  closed: '已断开,自动重连中…',
};

/** /term:终端独立页(经 hub 代理的持久 ttyd 会话,手机可用)。 */
export function TermPage() {
  const term = useUiStore((s) => s.term);
  const setTerm = useUiStore((s) => s.setTerm);
  const conn = useUiStore((s) => s.termConn);
  const navigate = useNavigate();

  useEffect(() => {
    if (!term) navigate('/', { replace: true });
  }, [term, navigate]);

  const onState = useCallback((s: TermConn) => {
    useUiStore.setState({ termConn: s });
  }, []);

  if (!term) return null;

  const exit = () => {
    const id = term.id;
    setTerm(null);
    useUiStore.setState({ termConn: 'closed' });
    fetch(`/api/term/${id}/stop`, { method: 'POST' }).catch(() => {});
    navigate('/', { replace: true });
  };

  return (
    <div id="chat-view">
      <header id="chat-header">
        <button className="icon-btn" onClick={exit} title="退出终端" aria-label="退出终端">
          <IconBack />
        </button>
        <span className={`term-dot ${conn}`} />
        <div id="chat-title">终端</div>
        <div id="chat-status">{STATUS_TEXT[conn]}</div>
      </header>
      <TerminalView termId={term.id} token={term.token} onState={onState} />
    </div>
  );
}
