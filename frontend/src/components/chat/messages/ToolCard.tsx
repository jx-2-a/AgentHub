import type { ChatItem } from '../../../events/types';
import { Markdown } from '../Markdown';

const ARGS_LIMIT = 4000;

function formatArgs(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v, null, 1);
  } catch {
    s = String(v);
  }
  return s.length > ARGS_LIMIT ? `${s.slice(0, ARGS_LIMIT)}\n…(已截断)` : s;
}

/** 工具卡片:显示工具名 + ✓/✗ 状态,展开显示 输入/结果/错误 三字段。结果(summary)用 markdown 渲染。 */
export function ToolCard({ card, sid }: { card: Extract<ChatItem, { kind: 'tool' }>; sid?: string | null }) {
  return (
    <details className="tool-card">
      <summary>
        <span className="t-name">▸ {card.name}</span>
        <span className={`t-status ${card.status}`}>
          {card.status === 'running' ? '…' : card.status === 'ok' ? '✓' : '✗'}
        </span>
      </summary>
      {(card.args != null || card.summary != null || card.error != null) && (
        <div className="t-detail">
          {card.args != null && (
            <>
              <div className="t-label">输入</div>
              <pre>{formatArgs(card.args)}</pre>
            </>
          )}
          {card.summary != null && (
            <>
              <div className="t-label">结果</div>
              <Markdown content={card.summary} sid={sid} />
            </>
          )}
          {card.error != null && (
            <>
              <div className="t-label t-label-err">错误</div>
              <pre className="t-error">{card.error}</pre>
            </>
          )}
        </div>
      )}
    </details>
  );
}
