import { useEffect } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore } from '../../stores/uiStore';
import { IconGear } from '../common/icons';
import { ArchivedList } from '../sidebar/ArchivedList';
import { FileBrowser } from '../sidebar/FileBrowser';
import { InstanceList } from '../sidebar/InstanceList';

/**
 * 侧栏结构(自上而下):
 *   品牌 + 关闭按钮 / ＋ 新实例 / 文件(占位) / 置顶实例 / 实例 / 归档 / 底部状态+设置
 * 桌面常驻可折叠;移动端(<768px)为 off-canvas 抽屉。
 */
export function Sidebar() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const open = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const openStart = useUiStore((s) => s.openStart);
  const openSettings = useUiStore((s) => s.openSettings);
  const pinned = useUiStore((s) => s.pinned);
  const pinnedArchives = useUiStore((s) => s.pinnedArchives);
  const error = useHubStore((s) => s.error);
  const instances = useHubStore((s) => s.instances);
  const archived = useHubStore((s) => s.archived);

  // 置顶只在确实有「置顶的实例或归档」时显示;残留的置顶 label(实例已删)不撑空行
  const hasPinned =
    instances.some((i) => pinned.includes(i.id)) ||
    archived.some((a) => pinnedArchives.includes(a.sid));

  // 断点切换时:桌面展开,移动端收起
  useEffect(() => {
    if (isMobile) useUiStore.getState().closeSidebar();
    else useUiStore.getState().openSidebar();
  }, [isMobile]);

  // 移动端抽屉打开时锁 body 滚动
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, open]);

  return (
    <aside id="sidebar" className={open ? '' : 'closed'}>
      <div id="sidebar-head">
        <div id="brand">AgentHub</div>
        <button id="btn-close-sidebar" onClick={closeSidebar} aria-label="收起侧栏" title="收起侧栏">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      </div>

      <div id="sidebar-body">
        <button id="btn-new-instance" onClick={() => openStart()}>
          ＋ 新实例
        </button>

        <section className="sidebar-section">
          <FileBrowser />
        </section>

        {hasPinned ? (
          <section className="sidebar-section">
            <div className="section-title">置顶</div>
            <InstanceList pinnedOnly />
            <ArchivedList pinnedOnly />
          </section>
        ) : null}

        <section className="sidebar-section">
          <div className="section-title">实例</div>
          <InstanceList />
        </section>

        <section className="sidebar-section">
          <div className="section-title">归档</div>
          <ArchivedList />
        </section>
      </div>

      <div id="sidebar-foot">
        <div id="hub-status" className={error ? 'offline' : ''}>
          <span className="dot" />
          {error ? '离线' : '在线'} · {instances.length} 实例
        </div>
        <button id="btn-sidebar-settings" onClick={openSettings} title="外观设置" aria-label="外观设置">
          <IconGear />
        </button>
      </div>
    </aside>
  );
}
