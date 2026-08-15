import { useUiStore } from '../../stores/uiStore';
import { ThemePanel } from './ThemePanel';

/** 全局设置面板:左侧列表(外观),右侧内容;后续全局设置页在此追加。
 * 注意:agent 各自的运行时参数不在这里(见 RuntimeModal),不同 agent 配置不同。 */
export function SettingsModal() {
  const open = useUiStore((s) => s.settingsModal);
  const close = useUiStore((s) => s.closeSettings);

  if (!open) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box settings-box">
        <div className="settings-nav">
          <button className="active">外观</button>
          {/* 后续全局设置页(关于/通知等)在此追加 */}
        </div>
        <div className="settings-panel">
          <ThemePanel />
        </div>
        <div className="modal-actions">
          <button onClick={close}>关闭</button>
        </div>
      </div>
    </div>
  );
}
