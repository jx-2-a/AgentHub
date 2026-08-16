/** 聊天 store:WS 事件流状态 + 发送 action(经 ws.ts 发送)。 */
import { create } from 'zustand';
import { getOlderEvents } from '../api';
import type { ServerEvent } from '../types';
import { reduceChat } from '../events/reducer';
import { initialChatState, type ChatState } from '../events/types';
import { sendIfOpen } from '../ws';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

/** 自动上限:防止页面消息无限堆长(旧消息已在转录落盘,丢弃仅释放内存)。
 * 阈值取高,避免工具调用一多就顶掉前面的对话;真正的清理靠手动"归档以上内容"。 */
const MAX_MESSAGES = 2000;

function capMessages(state: ChatState): ChatState {
  if (state.messages.length <= MAX_MESSAGES) return state;
  const drop = state.messages.length - MAX_MESSAGES;
  const messages = state.messages.slice(drop);
  const toolIndex: Record<string, number> = {};
  messages.forEach((m, i) => {
    if (m.kind === 'tool') toolIndex[m.id] = i;
  });
  return { ...state, messages, toolIndex };
}

interface ChatStore extends ChatState {
  sid: string | null;
  connection: ConnectionState;
  notFound: boolean; // 会话不存在(WS 握手 404)
  timer: { end: number; text: string } | null; // 定时/休眠倒计时(end = 绝对 epoch 秒)
  toast: string | null;
  pendingOutbox: string[]; // 断线期间发不出消息的待发队列,重连后补发(避免吞消息)
  hasMore: boolean; // 还有更早历史可上滑分页拉取
  olderCursor: number | null; // 当前窗口起点的转录行号(下一次 before=)
  loadingOlder: boolean; // 正在拉取更早历史(防并发)
  residualStatic: 'thinking' | 'assistant' | null; // 重放残留的增量块:保持静态呈现直到其闭合
  reset(sid: string): void;
  applyEvent(ev: ServerEvent): void;
  setConnection(c: ConnectionState): void;
  setNotFound(b: boolean): void;
  setStatus(text: string): void;
  setTitle(t: string): void;
  notify(text: string): void;
  clearToast(): void;
  clearTimer(): void;
  flushOutbox(): void;
  trimMessages(keep: number): void;
  finalizeBuffers(): void; // 断线时把开着的思考/回复块收成闭合,不留"思考中…"/光标
  loadOlder(): Promise<void>; // 上滑到顶时拉更早一页,前插,保持滚动位置
  reportRead(): void; // 贴底时上报"上次看到位置"
  sendMessage(text: string): void;
  sendAskAnswer(id: string, text: string | null): void;
  sendRequirementAnswer(id: string, values: Record<string, string> | null): void;
  sendSetting(key: string, value: unknown): void;
  interrupt(): void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...initialChatState(),
  sid: null,
  connection: 'idle',
  notFound: false,
  timer: null,
  toast: null,
  pendingOutbox: [],
  hasMore: false,
  olderCursor: null,
  loadingOlder: false,
  residualStatic: null,

  // 服务器每次连接都重放「尾部窗口」→ 连接建立时清空重建(reconnect 也如此,避免重复)。
  // title 保留:meta.label 不可重放,重连后标题应沿用。
  reset(sid) {
    set((s) => ({
      ...initialChatState(),
      sid,
      title: s.title,
      connection: s.connection,
      notFound: false,
      timer: null,
      toast: null,
      hasMore: false,
      olderCursor: null,
      loadingOlder: false,
      residualStatic: null,
      ...(s.sid && s.sid !== sid ? { pendingOutbox: [] } : {}), // 切了会话,丢弃旧会话的待发队列
    }));
  },
  applyEvent(ev) {
    // 休眠/定时:实时倒计时(不入消息流)
    if (ev.type === 'sleep_start') {
      set({ timer: { end: Date.now() / 1000 + Math.max(1, ev.seconds), text: ev.text || '自动唤醒' } });
      return;
    }
    if (ev.type === 'sleep_end') {
      set({ timer: null });
      return;
    }
    // 重放残留块:其闭合事件/思考被新回复收掉后,后续新块恢复直播流式
    const rs = get().residualStatic;
    if (
      rs &&
      ((rs === 'thinking' && (ev.type === 'thinking_end' || ev.type === 'assistant_delta')) ||
        (rs === 'assistant' && (ev.type === 'assistant_final' || ev.type === 'assistant_end')))
    ) {
      set({ residualStatic: null });
    }
    // 初始重放完成:取分页游标 + 置位(前端据此锚滚动)。
    // 断线/已结束会话 → 直接把残留增量块收成完成消息(不留"思考中…");连接中的会话 → 保持静态呈现,
    // 避免"刷新像重新跑一遍/思考中闪现"。
    if (ev.type === 'replay_done') {
      const open = get().thinkingOpen ? 'thinking' : get().assistantOpen ? 'assistant' : null;
      set({ replayDone: true, hasMore: !!ev.hasMore, olderCursor: ev.nextBefore ?? null });
      if (ev.status && ev.status !== 'connected') {
        get().finalizeBuffers();
      } else {
        set({ residualStatic: open });
      }
      return;
    }
    set(capMessages(reduceChat(get(), ev))); // 自动上限:防页面无限堆长
  },
  setConnection(c) {
    set({ connection: c });
  },
  setNotFound(b) {
    set({ notFound: b });
  },
  setStatus(text) {
    set({ status: text });
  },
  setTitle(t) {
    set({ title: t });
  },
  notify(text) {
    set({ toast: text });
  },
  clearToast() {
    set({ toast: null });
  },
  clearTimer() {
    set({ timer: null });
  },
  // 重连后补发断线期间排队的消息
  flushOutbox() {
    const outbox = get().pendingOutbox;
    if (!outbox.length) return;
    const remaining: string[] = [];
    for (const text of outbox) {
      if (!sendIfOpen({ type: 'message', text })) remaining.push(text);
    }
    if (remaining.length !== outbox.length) set({ pendingOutbox: remaining });
  },
  // 归档以上内容:保留最近 keep 条消息(旧消息已在转录落盘,丢弃仅释放内存),顶部加已归档标记
  trimMessages(keep) {
    const cur = get().messages;
    if (cur.length <= keep) return;
    const dropped = cur.length - keep;
    const messages = cur.slice(cur.length - keep);
    messages.unshift({
      kind: 'system',
      text: `🔖 以上 ${dropped} 条内容已归档，完整记录在归档中`,
      level: 'hint',
    });
    const toolIndex: Record<string, number> = {};
    messages.forEach((m, i) => {
      if (m.kind === 'tool') toolIndex[m.id] = i;
    });
    set({ messages, toolIndex });
  },

  finalizeBuffers() {
    set((s) => {
      let messages = s.messages;
      if (s.thinkingOpen) {
        messages = [...messages, { kind: 'thinking', text: s.thinkingBuffer, closed: true }];
      }
      if (s.assistantOpen) {
        messages = [...messages, { kind: 'assistant', text: s.assistantBuffer, md: null }];
      }
      return {
        ...s,
        messages,
        thinkingOpen: false,
        thinkingBuffer: '',
        assistantOpen: false,
        assistantBuffer: '',
      };
    });
  },

  // 上滑到顶 → 拉更早一页,独立 reduce 后前插,保持滚动位置(由视图层负责 scrollTop 补偿)。
  // 分页按「干净切点」切 → 每页自洽,无空窗、无半个思考/回复/工具块。
  async loadOlder() {
    const { sid, olderCursor, loadingOlder } = get();
    if (!sid || olderCursor == null || loadingOlder) return;
    set({ loadingOlder: true });
    try {
      const page = await getOlderEvents(sid, olderCursor, 300);
      let ps = initialChatState();
      for (const ev of page.events) ps = reduceChat(ps, ev);
      set((s) => {
        const k = ps.messages.length;
        // 前插 K 条 → 现有 toolIndex(直播中工具)下标右移 K
        const toolIndex: Record<string, number> = {};
        for (const [id, idx] of Object.entries(s.toolIndex)) toolIndex[id] = idx + k;
        return {
          messages: [...ps.messages, ...s.messages],
          toolIndex,
          olderCursor: page.nextBefore,
          hasMore: page.hasMore,
          loadingOlder: false,
        };
      });
    } catch {
      set({ loadingOlder: false }); // 拉取失败:允许重试,不卡死
    }
  },

  // 贴底时上报"上次看到位置"→ 服务端记 read_pos = stream_len;未读锚点据此插分隔条
  reportRead() {
    sendIfOpen({ type: 'read_pos' });
  },

  sendMessage(text) {
    if (!sendIfOpen({ type: 'message', text })) {
      get().notify('连接已断开，消息将在重连后自动发送');
      set((s) => ({ pendingOutbox: [...s.pendingOutbox, text] })); // 断开期间排队,不吞
    }
    // 本地回显:立即显示自己的消息,不等 agent echo(避免断连/回显丢失时消息"被吞")
    set((s) => capMessages({ ...s, messages: [...s.messages, { kind: 'user', text }] }));
  },
  sendAskAnswer(id, text) {
    if (!sendIfOpen({ type: 'ask_answer', id, text })) get().notify('连接已断开');
    set({ pendingAsk: null }); // 本地立即关闭,不等 agent 回 ask_done
  },
  sendRequirementAnswer(id, values) {
    if (!sendIfOpen({ type: 'requirement_answer', id, values })) get().notify('连接已断开');
    set({ pendingRequirement: null }); // 本地立即关闭,不等 agent 回 requirement_done
  },
  sendSetting(key, value) {
    if (!sendIfOpen({ type: 'settings_set', key, value })) get().notify('连接已断开');
  },
  interrupt() {
    if (!sendIfOpen({ type: 'interrupt' })) get().notify('连接已断开');
    get().finalizeBuffers(); // 手动打断:立即收掉思考/回复块(不等 agent 的 thinking_end)
  },
}));
