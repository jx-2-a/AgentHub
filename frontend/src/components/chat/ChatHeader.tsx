import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useUiStore } from '../../stores/uiStore';
import { IconBack, IconGear, IconStop } from '../common/icons';
import { FullscreenToggle } from '../common/FullscreenToggle';
import { SidebarToggle } from '../common/SidebarToggle';

/** 聊天头部:☰(侧栏关闭时)+ 标题/状态行 + ⚙运行时参数 / ⏹打断 / ⛶全屏。 */
export function ChatHeader({ sid }: { sid?: string }) {
  const title = useChatStore((s) => s.title);
  const status = useChatStore((s) => s.status);
  const connection = useChatStore((s) => s.connection);
  const interrupt = useChatStore((s) => s.interrupt);
  const openRuntime = useUiStore((s) => s.openRuntime);
  const navigate = useNavigate();

  const connLabel =
    connection === 'reconnecting' ? '重连中…'
    : connection === 'connecting' ? '连接中…'
    : connection === 'ended' ? '已结束'
    : '';
  const statusText = status || connLabel;

  return (
    <header id="chat-header">
      <button className="icon-btn" onClick={() => navigate('/')} title="退出聊天" aria-label="退出聊天">
        <IconBack />
      </button>
      <SidebarToggle />
      <div id="chat-title">{title || (sid ? `会话 #${sid}` : '')}</div>
      <div id="chat-status">{statusText}</div>
      <div id="chat-actions">
        <button className="icon-btn" title="运行时参数" onClick={openRuntime}>
          <IconGear />
        </button>
        <button className="icon-btn" title="打断" onClick={interrupt}>
          <IconStop />
        </button>
        <FullscreenToggle />
      </div>
    </header>
  );
}
