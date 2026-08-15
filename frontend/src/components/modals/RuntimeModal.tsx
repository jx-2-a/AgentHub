import { useUiStore } from '../../stores/uiStore';
import { RuntimePanel } from './RuntimePanel';

/** 运行时参数弹窗:当前 agent 各自的配置(不同 agent 配置不同,独立于全局设置)。 */
export function RuntimeModal() {
  const open = useUiStore((s) => s.runtimeModal);
  const close = useUiStore((s) => s.closeRuntime);
  if (!open) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box">
        <h3>运行时参数</h3>
        <RuntimePanel />
        <div className="modal-actions">
          <button onClick={close}>关闭</button>
        </div>
      </div>
    </div>
  );
}
