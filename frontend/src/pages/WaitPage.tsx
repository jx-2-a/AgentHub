import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listInstances } from '../api';

/** 等待页:点击"启动中"的实例进入,轮询直到实例连上会话,然后自动跳进聊天。 */
export function WaitPage() {
  const { instId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('正在连接 Agent…');
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!instId) return;
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const instances = await listInstances();
        if (cancelled) return;
        const inst = instances.find((i) => i.id === instId);
        if (!inst) {
          setGone(true);
          setStatus('实例不存在或已删除');
          return;
        }
        if (inst.status === 'exited') {
          setGone(true);
          setStatus('实例已退出');
          return;
        }
        if (inst.session_id) {
          navigate(`/chat/${inst.session_id}`, { replace: true });
          return;
        }
        setStatus(inst.status === 'starting' ? '正在启动…' : '正在连接…');
        timer = window.setTimeout(poll, 1000);
      } catch {
        if (!cancelled) {
          setGone(true);
          setStatus('无法连接 Hub');
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [instId, navigate]);

  return (
    <div id="empty-state">
      <div className="empty-box">
        {gone ? (
          <>
            <div className="empty-title">{status}</div>
            <button className="empty-btn" onClick={() => navigate('/')}>
              ← 返回首页
            </button>
          </>
        ) : (
          <>
            <div className="spinner" />
            <div className="empty-title" style={{ marginTop: 18 }}>
              等待实例启动…
            </div>
            <div className="empty-sub">{status}</div>
          </>
        )}
      </div>
    </div>
  );
}
