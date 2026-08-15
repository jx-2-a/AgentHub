/** 思考链折叠块:流式中展开显示,结束后收起(像工具卡一样可折叠)。 */
export function ThinkingBlock({ text, closed }: { text: string; closed: boolean }) {
  return (
    <details className="thinking-block" {...(closed ? {} : { open: true })}>
      <summary>
        <span className="th-icon">💭</span>
        <span className="th-title">思考过程</span>
        {closed ? (
          <span className="th-hint">展开查看</span>
        ) : (
          <span className="th-hint th-live">思考中…</span>
        )}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}
