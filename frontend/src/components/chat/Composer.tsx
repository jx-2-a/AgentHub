import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';

/** 输入栏:圆角胶囊输入框,发送按钮为内嵌箭头;ask(input 模式)时转为应答。 */
export function Composer({ readOnly }: { readOnly?: boolean }) {
  const [text, setText] = useState('');
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendAskAnswer = useChatStore((s) => s.sendAskAnswer);

  if (readOnly) {
    return (
      <footer id="inputbar">
        <div className="input-hint">只读回看</div>
      </footer>
    );
  }

  const ask = pendingAsk && pendingAsk.mode === 'input' ? pendingAsk : null;
  const canSend = text.trim().length > 0;
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (ask) sendAskAnswer(ask.id, value);
    else sendMessage(value);
    setText('');
  };

  return (
    <footer id="inputbar">
      <div className="composer">
        <input
          id="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="输入消息，Enter 发送"
          autoComplete="off"
        />
        <button id="btn-send" onClick={submit} disabled={!canSend} aria-label="发送" title="发送">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
    </footer>
  );
}
