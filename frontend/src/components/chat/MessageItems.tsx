import { useEffect, useMemo } from 'react';
import type { ChatItem } from '../../events/types';
import { useFollowScroll } from '../../hooks/useFollowScroll';
import { AssistantBubble } from './messages/AssistantBubble';
import { FileCard } from './messages/FileCard';
import { SystemBubble } from './messages/SystemBubble';
import { ThinkingBlock } from './messages/ThinkingBlock';
import { ToolCard } from './messages/ToolCard';
import { UserBubble } from './messages/UserBubble';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type RenderedItem = ChatItem | { kind: '__group'; items: ToolItem[] };

/** 把连续的工具调用合成一个伸缩组(避免工具一多往上翻很久)。 */
function groupItems(items: ChatItem[]): RenderedItem[] {
  const out: RenderedItem[] = [];
  let group: ToolItem[] = [];
  for (const item of items) {
    if (item.kind === 'tool') {
      group.push(item);
    } else {
      if (group.length) {
        out.push({ kind: '__group', items: group });
        group = [];
      }
      out.push(item);
    }
  }
  if (group.length) out.push({ kind: '__group', items: group });
  return out;
}

/** 工具调用伸缩组:active(最后一组,工具阶段未完)时保持展开,避免工具之间反复开合。 */
function ToolGroup({ items, active }: { items: ToolItem[]; active: boolean }) {
  const total = items.length;
  const done = items.filter((i) => i.status !== 'running').length;
  const live = done < total;
  const okCount = items.filter((i) => i.status === 'ok').length;
  const errCount = items.filter((i) => i.status === 'err').length;
  return (
    <details className="tool-group" {...(active ? { open: true } : {})}>
      <summary>
        <span className="tg-icon">🔧</span>
        <span className="tg-title">工具调用 ×{total}</span>
        {live ? (
          <span className="tg-progress">
            {done}/{total}
          </span>
        ) : (
          <span className="tg-result">
            {okCount ? `✓${okCount}` : ''}
            {errCount ? ` ✗${errCount}` : ''}
          </span>
        )}
      </summary>
      <div className="tg-body">
        {items.map((card) => (
          <ToolCard key={card.id} card={card} />
        ))}
      </div>
    </details>
  );
}

interface MessageItemsProps {
  items: ChatItem[];
  thinkingOpen?: boolean;
  thinkingBuffer?: string;
  assistantOpen?: boolean;
  assistantBuffer?: string;
  sid?: string | null;
  followLive?: boolean;
}

/** 通用消息流:既服务实时聊天(chatStore),也服务转录回看(本地 reducer 状态)。 */
export function MessageItems({
  items,
  thinkingOpen = false,
  thinkingBuffer = '',
  assistantOpen = false,
  assistantBuffer = '',
  sid,
  followLive = true,
}: MessageItemsProps) {
  const { ref, follow, scrollToBottom } = useFollowScroll<HTMLDivElement>();
  const itemCount = items.length;
  const grouped = useMemo(() => groupItems(items), [items]);

  useEffect(() => {
    if (followLive && follow) scrollToBottom();
  }, [itemCount, assistantBuffer, thinkingBuffer, follow, scrollToBottom, followLive]);

  return (
    <div id="messages" ref={ref}>
      {grouped.map((g, i) =>
        g.kind === '__group' ? (
          <ToolGroup key={`g${i}`} items={g.items} active={i === grouped.length - 1} />
        ) : (
          <MessageItem key={`m${i}`} item={g} sid={sid} />
        ),
      )}
      {thinkingOpen && <ThinkingBlock text={thinkingBuffer} closed={false} />}
      {assistantOpen && <AssistantBubble text={assistantBuffer} md={null} sid={sid} />}
    </div>
  );
}

function MessageItem({ item, sid }: { item: ChatItem; sid?: string | null }) {
  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} />;
    case 'assistant':
      return <AssistantBubble text={item.text} md={item.md} sid={sid} />;
    case 'thinking':
      return <ThinkingBlock text={item.text} closed={item.closed} />;
    case 'file':
      return <FileCard item={item} sid={sid} />;
    case 'system':
      return <SystemBubble text={item.text} level={item.level} />;
    case 'tool':
      return <ToolCard card={item} />;
    default:
      return null;
  }
}
