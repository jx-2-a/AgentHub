/** 聊天 store:WS 事件流状态 + 发送 action(经 ws.ts 发送)。 */
import { create } from 'zustand';
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

  // 服务器每次连接都重放完整历史 → 连接建立时清空重建(reconnect 也如此,避免重复)。
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
