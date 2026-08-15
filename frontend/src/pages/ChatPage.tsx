import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { useChatConnection } from '../hooks/useChatConnection';
import { useChatStore } from '../stores/chatStore';
import { useHubStore } from '../stores/hubStore';
import { useUiStore } from '../stores/uiStore';

/** /chat/:sid:深链直连对应会话。标题来自实例 label 或 meta 上报。 */
export function ChatPage() {
  const { sid } = useParams();
  const navigate = useNavigate();
  const instances = useHubStore((s) => s.instances);
  const setTitle = useChatStore((s) => s.setTitle);
  const setActiveSid = useUiStore((s) => s.setActiveSid);
  const notFound = useChatStore((s) => s.notFound);

  useChatConnection(sid ?? null);

  const inst = sid ? instances.find((i) => i.session_id === sid) : undefined;

  useEffect(() => {
    setActiveSid(sid ?? null);
    setTitle(inst?.label ?? (sid ? `会话 #${sid}` : ''));
    return () => setActiveSid(null);
  }, [sid, inst?.label, setActiveSid, setTitle]);

  if (!sid) return null;

  // 会话不存在(已删除/实例重启换了新会话)→ 友好空态,别再一片空白
  if (notFound) {
    return (
      <div id="empty-state">
        <div className="empty-box">
          <div className="empty-title">会话不存在或已归档</div>
          <div className="empty-sub">该会话可能已被删除，或实例重启后换成了新会话</div>
          <button className="empty-btn" onClick={() => navigate('/')}>
            ← 返回首页
          </button>
        </div>
      </div>
    );
  }

  return <ChatView sid={sid} />;
}
