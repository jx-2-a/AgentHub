import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cleanAllInstances } from '../../api';
import { useHubStore } from '../../stores/hubStore';
import { useUiStore } from '../../stores/uiStore';
import { ThemePanel } from './ThemePanel';

/**
 * 全局设置面板:左侧列表(外观 / 控制),右侧内容。
 * 「控制」= 系统控制(终端、文件管理),终端入口藏在这里,单独点开仍要 token。
 * agent 各自的运行时参数不在这里(见 RuntimeModal)。
 */
export function SettingsModal() {
  const open = useUiStore((s) => s.settingsModal);
  const close = useUiStore((s) => s.closeSettings);
  const openTerm = useUiStore((s) => s.openTerm);
  const navigate = useNavigate();
  const instances = useHubStore((s) => s.instances);
  const refresh = useHubStore((s) => s.refresh);
  const [tab, setTab] = useState<'appearance' | 'control'>('appearance');
  const [cleaning, setCleaning] = useState(false);
  // 后台实例 = 运行中(starting/connected);已停止(exited)的条目只是残留记录,不算后台
  const runningCount = instances.filter((i) => i.status !== 'exited').length;

  if (!open) return null;

  const openFiles = () => {
    close();
    navigate('/files');
  };

  // 一键清理:停掉所有后台实例 + 删临时会话记录(归档保留),避免旧实例续接旧会话串内容
  const cleanAll = () => {
    if (cleaning) return;
    if (!instances.length) return;
    const msg =
      runningCount > 0
        ? `清理全部 ${runningCount} 个后台实例?将停掉 agent、移除实例,并删除它们的临时会话记录(永久归档保留)。此操作不可逆。`
        : `清掉 ${instances.length} 个已停止实例的记录?移除实例条目,并删除临时会话记录(永久归档保留)。此操作不可逆。`;
    if (!window.confirm(msg)) return;
    setCleaning(true);
    void cleanAllInstances()
      .then(() => refresh())
      .finally(() => setCleaning(false));
  };

  const openTerminal = () => {
    close();
    openTerm();
  };

  const openSystem = () => {
    close();
    navigate('/system');
  };

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box settings-box">
        <div className="settings-head">
          <h3>设置</h3>
          <button className="settings-close" onClick={close} title="关闭" aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-nav">
            <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
              外观
            </button>
            <button className={tab === 'control' ? 'active' : ''} onClick={() => setTab('control')}>
              控制
            </button>
          </div>
          <div className="settings-panel">
            {tab === 'appearance' ? (
              <ThemePanel />
            ) : (
              <div className="control-panel">
                <div className="settings-label">系统控制</div>
                <p className="control-hint">电脑状态、终端与文件管理在这里进入;终端会再次校验 token。</p>
                <button className="control-btn" onClick={openSystem}>
                  <span className="cb-main">电脑状态</span>
                  <span className="cb-sub">内存/网络/Tailscale/VPN · 工具</span>
                </button>
                <button className="control-btn" onClick={openTerminal}>
                  <span className="cb-main">终端</span>
                  <span className="cb-sub">系统 Shell · 需 token</span>
                </button>
                <button className="control-btn" onClick={openFiles}>
                  <span className="cb-main">打开全部文件</span>
                  <span className="cb-sub">大文件页 · 可收藏常用目录</span>
                </button>
                <button className="control-btn danger" onClick={cleanAll} disabled={cleaning || instances.length === 0}>
                  <span className="cb-main">{cleaning ? '清理中…' : '清理所有后台实例'}</span>
                  <span className="cb-sub">
                    {runningCount > 0
                      ? `停掉 ${runningCount} 个后台 agent · 删除临时会话(归档保留)`
                      : instances.length > 0
                        ? `清掉 ${instances.length} 个已停止实例的记录`
                        : '当前没有实例'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
