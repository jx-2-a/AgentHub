import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '../../events/types';
import { useFollowScroll } from '../../hooks/useFollowScroll';
import { useChatStore } from '../../stores/chatStore';
import { useUiStore } from '../../stores/uiStore';
import { AssistantBubble } from './messages/AssistantBubble';
import { FileCard } from './messages/FileCard';
import { SystemBubble } from './messages/SystemBubble';
import { ThinkingBlock } from './messages/ThinkingBlock';
import { ToolCard } from './messages/ToolCard';
import { UserBubble } from './messages/UserBubble';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type ProcessItem = ChatItem | { kind: '__group'; items: ToolItem[] };
type RenderedItem =
  | ChatItem
  | { kind: '__group'; items: ToolItem[] }
  | { kind: '__process'; items: ProcessItem[] };

/** 瞬间滚动(绕过 #messages 的 scroll-behavior:smooth;锚点/分页补偿要一步到位)。 */
function jumpTo(el: HTMLElement, top: number) {
  el.style.scrollBehavior = 'auto';
  el.scrollTop = top;
  requestAnimationFrame(() => {
    el.style.scrollBehavior = '';
  });
}

/** 分组:连续工具合成组;再把每轮「思考内容+工具调用」(到最终结论之前)包成可折叠 __process。
 * 最终结论(assistant)在包外独立显示;过程中日志并入;user/file/separator 收尾独立。 */
function groupItems(items: ChatItem[]): RenderedItem[] {
  const out: RenderedItem[] = [];
  let group: ToolItem[] = [];
  let proc: ProcessItem[] = [];
  const flushTools = () => {
    if (group.length) {
      proc.push({ kind: '__group', items: group });
      group = [];
    }
  };
  const flushProcess = () => {
    flushTools();
    if (proc.length) {
      out.push({ kind: '__process', items: proc });
      proc = [];
    }
  };
  for (const item of items) {
    if (item.kind === 'tool') {
      group.push(item);
    } else if (item.kind === 'thinking') {
      flushTools();
      proc.push(item);
    } else if (item.kind === 'assistant') {
      // 最终结论:不在思考过程包里,收尾过程后独立显示
      flushProcess();
      out.push(item);
    } else if (item.kind === 'system') {
      // 过程中的日志并入 process;无过程时独立
      if (proc.length) proc.push(item);
      else out.push(item);
    } else {
      // user / file / separator:先收掉开着的过程,再独立显示
      flushProcess();
      out.push(item);
    }
  }
  flushProcess();
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

/** 整轮「思考过程」外层折叠(到最终结论之前),独立开合。
 * 重放时默认收起(省空间/不重看),直播时默认展开(能看到流式);展开才渲染内部。
 * 内部同级两节:「思考内容」(思考链)和「工具调用」(工具组)。 */
function ProcessBlock({
  items,
  sid,
  replayDone,
}: {
  items: ProcessItem[];
  sid?: string | null;
  replayDone: boolean;
}) {
  const [open, setOpen] = useState(!replayDone); // 独立开合,不共享
  const hydrateBlock = useChatStore((s) => s.hydrateBlock);
  const thinkItems = items.filter((i) => i.kind === 'thinking');
  const rest = items.filter((i) => i.kind !== 'thinking'); // 工具组 + 过程日志
  const thinkingCount = thinkItems.length;
  const toolCount = rest.reduce(
    (n, i) => n + (i.kind === '__group' ? i.items.length : 0),
    0,
  );
  const label = [
    thinkingCount ? `思考 ${thinkingCount} 段` : '',
    toolCount ? `工具 ${toolCount} 次` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // 展开时才取回重放时被剥离的思考正文/工具详情(按 pos 按需加载)
  useEffect(() => {
    if (!open) return;
    const need: number[] = [];
    const scan = (it: ProcessItem) => {
      if (it.kind === '__group') {
        it.items.forEach((t) => t.pos != null && !t.hydrated && need.push(t.pos));
      } else if ((it.kind === 'thinking' || it.kind === 'tool') && it.pos != null && !it.hydrated) {
        need.push(it.pos);
      }
    };
    items.forEach(scan);
    if (need.length) need.forEach((p) => void hydrateBlock(p));
  }, [open, items, hydrateBlock]);
  return (
    <details className="process-block" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="pb-caret">▸</span>
        <span className="pb-title">思考过程</span>
        {label && <span className="pb-hint">{label}</span>}
      </summary>
      {open && (
        <div className="pb-body">
          {items.map((it, i) =>
            it.kind === '__group' ? (
              <ToolGroup key={`pg${i}`} items={it.items} sid={sid} />
            ) : (
              <MessageItem key={`pm${i}`} item={it} sid={sid} />
            ),
          )}
        </div>
      )}
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
  const scrollTick = useChatStore((s) => s.scrollTick);
  // 重放中 / 重放残留增量块 → 以静态(已完成)样式呈现;直播流式样式只留给真正的新事件
  const staticBuffers = !replayDone || !!residualStatic;

  // 自动跟随底部:replayDone 前也跟随 → 初始加载即见最新(未读时随后锚到分隔条)
  useEffect(() => {
    if (followLive && follow) scrollToBottom();
  }, [itemCount, assistantBuffer, thinkingBuffer, follow, scrollToBottom, followLive]);

  // 发消息/应答后强制滚到底(即使已上滑读历史):scrollTick 自增触发
  useEffect(() => {
    if (followLive && scrollTick > 0) scrollToBottom();
  }, [scrollTick, followLive, scrollToBottom]);

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
        ) : g.kind === '__process' ? (
          <ProcessBlock key={`p${i}`} items={g.items} sid={sid} replayDone={replayDone} />
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
