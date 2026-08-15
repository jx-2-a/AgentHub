import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spawnInstance } from '../../api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore } from '../../stores/uiStore';

/** 启动实例:选 agent + 标签 → POST /api/instances。 */
export function StartInstanceModal() {
  const open = useUiStore((s) => s.startModal);
  const close = useUiStore((s) => s.closeStart);
  const startAgent = useUiStore((s) => s.startAgent);
  const startLabel = useUiStore((s) => s.startLabel);
  const agents = useHubStore((s) => s.agents);
  const refresh = useHubStore((s) => s.refresh);

  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const picked = startAgent && agents.some((a) => a.key === startAgent) ? startAgent : null;
      const initial = picked ?? agents.find((a) => a.hub)?.key ?? agents[0]?.key ?? null;
      setAgentKey(initial);
      const hubReady = agents.find((a) => a.key === initial);
      setLabel(startLabel || hubReady?.label_default || '');
      setError(null);
    }
    // 仅打开时初始化;agents 轮询更新不应覆盖用户选择
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const navigate = useNavigate();
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const doStart = async () => {
    if (!agentKey) return;
    setBusy(true);
    setError(null);
    try {
      const inst = await spawnInstance(agentKey, label.trim() || undefined);
      close();
      if (isMobile) closeSidebar(); // 手机端创建后收起抽屉
      void refresh();
      navigate(`/wait/${inst.id}`); // 创建后自动进等待页,连上后跳进聊天
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box">
        <h3>启动实例</h3>
        <div id="start-agent-list">
          {agents.map((a) => (
            <div
              key={a.key}
              className={`start-agent ${a.key === agentKey ? 'selected' : ''}`}
              onClick={() => {
                setAgentKey(a.key);
                setLabel(a.label_default);
              }}
            >
              <div className="sa-name">{a.name}</div>
              {a.description && <div className="sa-desc">{a.description}</div>}
            </div>
          ))}
        </div>
        <label>
          标签{' '}
          <input
            id="start-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="实例标签(默认用 agent 名)"
          />
        </label>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button onClick={close}>取消</button>
          <button className="primary" onClick={doStart} disabled={busy || !agentKey}>
            {busy ? '启动中…' : '启动'}
          </button>
        </div>
      </div>
    </div>
  );
}
