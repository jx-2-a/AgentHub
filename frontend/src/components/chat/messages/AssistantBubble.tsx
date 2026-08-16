import { Markdown } from '../Markdown';

/** 助手气泡:流式中(open)纯文本+光标;闭合后 md 渲染(有 md)或纯文本(无光标)。 */
export function AssistantBubble({
  text,
  md,
  open = false,
  sid,
}: {
  text: string;
  md: string | null;
  open?: boolean;
  sid?: string | null;
}) {
  return (
    <div className="msg assistant">
      <div className="bubble">
        {md !== null && !open ? (
          <Markdown content={md} sid={sid} />
        ) : (
          <span className="raw">
            {text}
            {open && <span className="stream-caret">▍</span>}
          </span>
        )}
      </div>
    </div>
  );
}
