import { useNavigate } from 'react-router-dom';
import type { Instance } from '../../types';
import { archiveInstance, restartInstance, stopInstance, trimSession } from '../../api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useChatStore } from '../../stores/chatStore';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore, type ContextMenuItem } from '../../stores/uiStore';

/** 实例条目:置顶、状态色、点击打开会话;右键/⋯ 菜单 = 停止/归档记录/删除。 */
export function InstanceItem({ instance }: { instance: Instance }) {
  const navigate = useNavigate();
  const refresh = useHubStore((s) => s.refresh);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const active = useUiStore((s) => s.activeSid) === instance.session_id;
  const pinned = useUiStore((s) => s.pinned.includes(instance.label));
  const togglePin = useUiStore((s) => s.togglePin);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const select = () => {
    if (isMobile) closeSidebar(); // 仅手机端收起抽屉;桌面保持侧栏展开
    if (!instance.session_id) {
      // 实例还没连上会话 → 进入等待页,连上后自动跳进聊天
      navigate(`/wait/${instance.id}`);
      return;
    }
    navigate(`/chat/${instance.session_id}`);
  };

  const openMenu = (x: number, y: number) => {
    const items: ContextMenuItem[] = [
      {
        label: '重启',
        onClick: () => {
          void restartInstance(instance.id).then(refresh);
        },
      },
    ];
    if (instance.status !== 'exited') {
      items.push({
        label: '停止',
        onClick: () => {
          void stopInstance(instance.id).then(refresh);
        },
      });
    }
    if (instance.session_id) {
      items.push({
        label: '归档以上内容',
        onClick: () => {
          const sid = instance.session_id;
          if (sid && window.confirm('归档当前会话全部内容?剪切到永久归档,实例页面清空')) {
            void trimSession(sid, 0);
            useChatStore.getState().trimMessages(0);
          }
        },
      });
      items.push({
        label: '归档记录',
        onClick: () => {
          closeSidebar();
          navigate(`/transcripts/${instance.session_id}`);
        },
      });
    }
    items.push({
      label: '完全归档',
      onClick: () => {
        if (window.confirm(`完全归档实例 ${instance.label}？实例将从列表移除，记录保留在归档（只读）`)) {
          void archiveInstance(instance.id).then(refresh);
        }
      },
    });
    items.push({
      label: '删除',
      danger: true,
      onClick: () => {
        if (window.confirm(`删除实例 ${instance.label}？临时记录删除,已归档的记录保留`)) {
          void (async () => {
            await stopInstance(instance.id, true); // purge 已删临时记录;归档保留
            // 正在看的会话被删 → 关闭聊天回首页
            if (instance.session_id && window.location.pathname.startsWith(`/chat/${instance.session_id}`)) {
              navigate('/');
            }
            await refresh();
          })();
        }
      },
    });
    useUiStore.getState().openContextMenu(x, y, items);
  };

  return (
    <div
      className={`instance-item ${active ? 'active' : ''}`}
      onClick={select}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
    >
      <div className="ii-top">
        <span className="ii-label">{instance.label || instance.agent_key}</span>
        <span className={`ii-status ${instance.status}`}>{instance.status}</span>
      </div>
      <div className="ii-sub">
        <button
          className={`ii-pin ${pinned ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(instance.label);
          }}
          title={pinned ? '取消置顶' : '置顶'}
        >
          {pinned ? '📍' : '📌'}
        </button>
        <span className="ii-kind">
          {instance.agent_key || ''}
          {instance.session_id ? ' · 会话' : ''}
        </span>
        <button
          className="ii-menu"
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="操作(停止/归档/删除)"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}
