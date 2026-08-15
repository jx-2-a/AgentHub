import { useChatStore } from '../../stores/chatStore';

/** ask mode=confirm:确认/取消(取消 → text:null,确认 → 'y')。点击遮罩视为取消。 */
export function ConfirmModal() {
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const sendAskAnswer = useChatStore((s) => s.sendAskAnswer);

  if (!pendingAsk || pendingAsk.mode !== 'confirm') return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) sendAskAnswer(pendingAsk.id, null);
      }}
    >
      <div className="modal-box">
        <h3>需要确认</h3>
        <p className="confirm-text">{pendingAsk.prompt}</p>
        <div className="modal-actions">
          <button onClick={() => sendAskAnswer(pendingAsk.id, null)}>取消</button>
          <button className="primary" onClick={() => sendAskAnswer(pendingAsk.id, 'y')}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
