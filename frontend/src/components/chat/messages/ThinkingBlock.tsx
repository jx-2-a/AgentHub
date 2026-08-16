/**
 * 思考链折叠块。
 * - 流式中(closed=false):跟随用户偏好 thinkingExpanded —— 开=内容实时流式显示,折叠=静默累积字数;
 *   用户在流式时点开/收起会记住偏好,后续自动跟随。
 * - 完成后(closed=true):自动收起,可手动展开。
 */
export function ThinkingBlock({
  text,
  closed,
  expanded,
  onToggle,
}: {
  text: string;
  closed: boolean;
  expanded?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const trimmed = text.trim();
  const preview = trimmed
    ? trimmed.length > 26
      ? `${trimmed.slice(0, 26)}…`
      : trimmed
    : '';
  return (
    <details
      className="thinking-block"
      open={closed ? undefined : expanded}
      onToggle={closed || !onToggle ? undefined : (e) => onToggle(e.currentTarget.open)}
    >
      <summary>
        <span className="th-caret">▸</span>
        <span className="th-icon">💭</span>
        <span className="th-title">思考过程</span>
        {closed ? (
          <>
            <span className="th-preview">{preview}</span>
            <span className="th-hint">展开 · {text.length} 字</span>
          </>
        ) : (
          <span className="th-hint th-live">思考中… {text.length} 字</span>
        )}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}
