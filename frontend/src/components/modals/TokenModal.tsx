import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '../../stores/uiStore';

/** 终端 token 弹窗:校验 SHELL_TOKEN 并启动终端(只有进终端要鉴权)。 */
export function TokenModal() {
  const open = useUiStore((s) => s.termModal);
  const close = useUiStore((s) => s.closeTerm);
  const setTerm = useUiStore((s) => s.setTerm);
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const start = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/term/start?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || '启动失败');
        return;
      }
      setTerm({ id: data.term_id, token }); // token 只存内存,不进 URL
      close();
      navigate('/term');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box">
        <h3>进入终端</h3>
        <p className="req-reason">终端可控制系统 Shell,需要 token 鉴权</p>
        <label>
          Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') start();
            }}
            placeholder="输入终端 token"
            autoFocus
          />
        </label>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button onClick={close}>取消</button>
          <button className="primary" onClick={start} disabled={busy}>
            {busy ? '启动中…' : '进入终端'}
          </button>
        </div>
      </div>
    </div>
  );
}
