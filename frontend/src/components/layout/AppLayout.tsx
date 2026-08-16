import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSidebarPolling } from '../../hooks/useSidebarPolling';
import { useTheme } from '../../hooks/useTheme';
import { useUiStore } from '../../stores/uiStore';
import { ContextMenu } from '../common/ContextMenu';
import { Toast } from '../common/Toast';
import { ConfirmModal } from '../modals/ConfirmModal';
import { FileModal } from '../modals/FileModal';
import { RequirementModal } from '../modals/RequirementModal';
import { RuntimeModal } from '../modals/RuntimeModal';
import { SettingsModal } from '../modals/SettingsModal';
import { TokenModal } from '../modals/TokenModal';
import { StartInstanceModal } from '../sidebar/StartInstanceModal';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  useTheme();
  useSidebarPolling();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);

  return (
    <div id="app">
      <Sidebar />
      {isMobile && sidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} />}
      <main id="main">
        <Outlet />
      </main>
      <StartInstanceModal />
      <FileModal />
      <ConfirmModal />
      <RequirementModal />
      <RuntimeModal />
      <SettingsModal />
      <TokenModal />
      <ContextMenu />
      <Toast />
    </div>
  );
}
