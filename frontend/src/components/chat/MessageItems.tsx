import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatItem } from '../../events/types';
import { useFollowScroll } from '../../hooks/useFollowScroll';
import { useUiStore } from '../../stores/uiStore';
import { AssistantBubble } from './messages/AssistantBubble';
import { FileCard } from './messages/FileCard';
import { SystemBubble } from './messages/SystemBubble';
import { ThinkingBlock } from './messages/ThinkingBlock';
import { ToolCard } from './messages/ToolCard';
import { UserBubble } from './messages/UserBubble';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type RenderedItem = ChatItem | { kind: '__group'; items: ToolItem[] };

/** 瞬间滚动(绕过 #messages 的 scroll-behavior:smooth;锚点/分页补偿要一步到位)。 */
function jumpTo(el: HTMLElement, top: number) {
  el.style.scrollBehavior = 'auto';
  el.scrollTop = top;
  requestAnimationFrame(() => {
    el.style.scrollBehavior = '';
  });
}

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

/** 工具调用伸缩组:默认开合由用户偏好决定(开过就记住,后续自动跟随)。 */
function ToolGroup({ items, sid }: { items: ToolItem[]; sid?: string | null }) {
  const toolGroupOpen = useUiStore((s) => s.toolGroupOpen);
  const setToolGroupOpen = useUiStore((s) => s.setToolGroupOpen);
  const total = items.length;
  const done = items.filter((i) => i.status !== 'running').length;
  const live = done < total;
  const okCount = items.filter((i) => i.status === 'ok').length;
  const errCount = items.filter((i) => i.status === 'err').length;
  return (
    <details
      className="tool-group"
      open={toolGroupOpen}
      onToggle={(e) => setToolGroupOpen(e.currentTarget.open)}
    >
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
          <ToolCard key={card.id} card={card} sid={sid} />
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
  // 历史分页窗口(仅 live 聊天;转录回看不传)
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  replayDone?: boolean;
  onReportRead?: () => void;
  residualStatic?: 'thinking' | 'assistant' | null; // 重放残留增量块:保持静态直至其闭合
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
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  replayDone = false,
  onReportRead,
  residualStatic = null,
}: MessageItemsProps) {
  const { ref, follow, scrollToBottom } = useFollowScroll<HTMLDivElement>();
  const itemCount = items.length;
  const grouped = useMemo(() => groupItems(items), [items]);
  const thinkingExpanded = useUiStore((s) => s.thinkingExpanded);
  const setThinkingExpanded = useUiStore((s) => s.setThinkingExpanded);
  // 重放中 / 重放残留增量块 → 以静态(已完成)样式呈现;直播流式样式只留给真正的新事件
  const staticBuffers = !replayDone || !!residualStatic;

  // 自动跟随底部:replayDone 前也跟随 → 初始加载即见最新(未读时随后锚到分隔条)
  useEffect(() => {
    if (followLive && follow) scrollToBottom();
  }, [itemCount, assistantBuffer, thinkingBuffer, follow, scrollToBottom, followLive]);

  // 初始重放完成 → 未读锚点:有分隔条则滚到「上次看到这里」上方,未读在下方慢慢翻;
  // 无分隔条 = 已读到底,贴底。useLayoutEffect 赶在绘制前,避免闪现。
  // 重连/新会话时 reset 会把 replayDone 置回 false → 锚点复位,下一轮重放再锚一次。
  const anchoredRef = useRef(false);
  const pendingAdjustRef = useRef<number | null>(null);
  useEffect(() => {
    if (!replayDone) {
      anchoredRef.current = false;
      pendingAdjustRef.current = null;
    }
  }, [replayDone]);
  useLayoutEffect(() => {
    if (!followLive || !replayDone || anchoredRef.current) return;
    anchoredRef.current = true;
    const el = ref.current;
    if (!el) return;
    const sep = el.querySelector('.msg-separator');
    if (sep) {
      jumpTo(
        el,
        Math.max(
          0,
          sep.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12,
        ),
      );
    } else {
      jumpTo(el, el.scrollHeight); // 无未读(或已读到底):直接贴底(重连时 follow 可能是旧的)
    }
  }, [replayDone, followLive, ref]);

  // 上滑到顶 → 拉更早一页;加载完成(loadingOlder true→false,内容前插)时按高度差补偿 scrollTop,
  // 保持视口不跳。只在这一拍补偿:早先 loadingOlder 翻 true 的 commit 不算(那时页还没插进来)。
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const prev = prevLoadingRef.current;
    prevLoadingRef.current = loadingOlder;
    const el = ref.current;
    if (pendingAdjustRef.current != null && el && prev && !loadingOlder) {
      jumpTo(el, el.scrollTop + el.scrollHeight - pendingAdjustRef.current);
      pendingAdjustRef.current = null;
    }
  }, [items, loadingOlder]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop <= 60 && hasMore && !loadingOlder && replayDone && onLoadOlder) {
        pendingAdjustRef.current = el.scrollHeight;
        onLoadOlder();
      }
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingOlder, replayDone, onLoadOlder, ref]);

  // 内容没填满视口还有更早历史 → 自动补加载(否则窗口太短没上滑空间,PC 上划不动)。
  // 加载后仍未满 → 继续补,直到填满或 hasMore=false。
  useEffect(() => {
    if (!followLive || !replayDone || !hasMore || loadingOlder || !onLoadOlder) return;
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 40) {
      onLoadOlder();
    }
  }, [followLive, replayDone, hasMore, loadingOlder, itemCount, onLoadOlder, ref]);

  // 已读上报:贴底(含滚到底、新消息追底)且重放完成后,延迟一拍等滚动锚定落定,节流 ~2s。
  // follow 进依赖:用户从上方一路滚到底(读完全部未读)也算已读。
  const lastReportRef = useRef(0);
  useEffect(() => {
    if (!followLive || !onReportRead || !replayDone) return;
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        const now = Date.now();
        if (now - lastReportRef.current > 2000) {
          lastReportRef.current = now;
          onReportRead();
        }
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [followLive, onReportRead, replayDone, itemCount, follow, ref]);

  return (
    <div id="messages" ref={ref}>
      {hasMore && (
        <div className={`load-older${loadingOlder ? ' loading' : ''}`}>
          {loadingOlder ? '加载更早…' : '↑ 上滑加载更早'}
        </div>
      )}
      {grouped.map((g, i) =>
        g.kind === '__group' ? (
          <ToolGroup key={`g${i}`} items={g.items} sid={sid} />
        ) : (
          <MessageItem key={`m${i}`} item={g} sid={sid} />
        ),
      )}
      {staticBuffers ? (
        <>
          {/* 重放中/重放残留:历史增量块渲染成"已完成"静态样式,避免刷新像"快速重跑一遍"/思考中闪现 */}
          {thinkingOpen && <ThinkingBlock text={thinkingBuffer} closed sid={sid} />}
          {assistantOpen && <AssistantBubble text={assistantBuffer} md={null} sid={sid} />}
        </>
      ) : (
        <>
          {thinkingOpen && (
            <ThinkingBlock
              text={thinkingBuffer}
              closed={false}
              expanded={thinkingExpanded}
              onToggle={setThinkingExpanded}
              sid={sid}
            />
          )}
          {assistantOpen && <AssistantBubble text={assistantBuffer} md={null} open sid={sid} />}
        </>
      )}
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
      return <ThinkingBlock text={item.text} closed={item.closed} sid={sid} />;
    case 'file':
      return <FileCard item={item} sid={sid} />;
    case 'system':
      return <SystemBubble text={item.text} level={item.level} sid={sid} />;
    case 'tool':
      return <ToolCard card={item} sid={sid} />;
    case 'separator':
      return (
        <div className="msg-separator">
          <span>{item.text}</span>
        </div>
      );
    default:
      return null;
  }
}
