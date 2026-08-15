import { Markdown } from '../Markdown';

/** 助手气泡:流式(纯文本+光标)或 final 后(替换成 markdown)。 */
export function AssistantBubble({
  text,
  md,
  sid,
}: {
  text: string;
  md: string | null;
  sid?: string | null;
}) {
  return (
    <div className="msg assistant">
      <div className="bubble">
        {md !== null ? (
          <Markdown content={md} sid={sid} />
        ) : (
          <span className="raw">
            {text}
            <span className="stream-caret">▍</span>
          </span>
        )}
      </div>
    </div>
  );
}
