import { FullscreenToggle } from '../components/common/FullscreenToggle';
import { SidebarToggle } from '../components/common/SidebarToggle';

export function HomePage() {
  return (
    <div id="empty-state">
      <div className="home-toggle">
        <SidebarToggle />
      </div>
      <div className="home-fullscreen">
        <FullscreenToggle />
      </div>
      <div className="empty-box">
        <div className="empty-title">Agent Hub</div>
        <div className="empty-sub">选择左侧一个实例打开聊天，或点「＋」启动新实例</div>
      </div>
    </div>
  );
}
