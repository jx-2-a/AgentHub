import { useUiStore } from '../../stores/uiStore';

/** ☰ 开侧栏按钮:侧栏关闭时显示,融入标题前(不占独立列)。 */
export function SidebarToggle() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const openSidebar = useUiStore((s) => s.openSidebar);
  if (sidebarOpen) return null;
  return (
    <button className="icon-btn" onClick={openSidebar} aria-label="打开侧栏" title="打开侧栏">
      ☰
    </button>
  );
}
