/** 纯 reducer:WS 实时流与转录回看共用同一个 reduceChat。 */
import type { ServerEvent } from '../types';
import type { ChatItem, ChatState } from './types';

function truncateSummary(v: unknown): string | undefined {
  // web 版不截断（不怕刷屏）:仅把 None/空串规整为"不渲染"
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

/** 助手内容开始时把还在流的思考块收进 messages(顺序守卫)。 */
function flushThinking(s: ChatState): {
  messages: ChatItem[];
  thinkingOpen: boolean;
  thinkingBuffer: string;
} {
  if (!s.thinkingOpen) {
    return { messages: s.messages, thinkingOpen: false, thinkingBuffer: s.thinkingBuffer };
  }
  return {
    messages: [...s.messages, { kind: 'thinking', text: s.thinkingBuffer, closed: true }],
    thinkingOpen: false,
    thinkingBuffer: '',
  };
}

export function reduceChat(s: ChatState, ev: ServerEvent): ChatState {
  switch (ev.type) {
    case 'session_state': {
      if (ev.status === 'connected') {
        return { ...s, status: '' };
      }
      // 断线/结束时:收掉开着的思考/回复块(agent 被杀/重启时 thinking_end 可能没到,
      // 否则思考块一直"思考中…"卡住),并清掉挂起的交互(否则弹窗关不掉)
      let messages = s.messages;
      if (s.thinkingOpen) {
        messages = [...messages, { kind: 'thinking', text: s.thinkingBuffer, closed: true }];
      }
      if (s.assistantOpen) {
        messages = [...messages, { kind: 'assistant', text: s.assistantBuffer, md: null }];
      }
      return {
        ...s,
        status: `会话 ${ev.status}`,
        messages,
        thinkingOpen: false,
        thinkingBuffer: '',
        assistantOpen: false,
        assistantBuffer: '',
        pendingAsk: null,
        pendingRequirement: null,
      };
    }

    case 'log': {
      // silent:只落转录记录、不上聊天屏(前端直接忽略)
      if (ev.level === 'silent') return s;
      // 每条 log = 一段独立展示,按等级渲染(agent 侧用 log(text, level) 分段)
      const level = ev.level ?? 'info';
      return { ...s, messages: [...s.messages, { kind: 'system', text: ev.text, level }] };
    }

    case 'user': {
      // 本地已回显同样文本 → 跳过 agent 的重复回显(避免双份)
      const last = s.messages[s.messages.length - 1];
      if (last && last.kind === 'user' && last.text === ev.text) return s;
      return {
        ...s,
        messages: [
          ...s.messages,
          { kind: 'user', text: ev.text, ...(ev.turn !== undefined ? { turn: ev.turn } : {}) },
        ],
      };
    }

    case 'assistant_delta': {
      const fl = flushThinking(s);
      return {
        ...s,
        ...fl,
        assistantOpen: true,
        assistantBuffer: s.assistantBuffer + ev.content,
      };
    }

    case 'assistant_final': {
      const fl = flushThinking(s);
      return {
        ...s,
        ...fl,
        assistantOpen: false,
        assistantBuffer: '',
        messages: [...fl.messages, { kind: 'assistant', text: ev.content, md: ev.content }],
      };
    }

    case 'assistant_end': {
      let messages = s.messages;
      if (s.assistantOpen) {
        messages = [...messages, { kind: 'assistant', text: s.assistantBuffer, md: null }];
      }
      return { ...s, messages, assistantOpen: false, assistantBuffer: '' };
    }

    case 'thinking_delta':
      return { ...s, thinkingOpen: true, thinkingBuffer: s.thinkingBuffer + ev.content };

    case 'thinking_end': {
      const fl = flushThinking(s);
      // 重放剥离的思考块带 pos:展开时按 pos 取回完整内容
      let messages = fl.messages;
      if (ev.pos !== undefined && messages.length) {
        const last = messages[messages.length - 1];
        if (last.kind === 'thinking') {
          const t = last as Extract<ChatItem, { kind: 'thinking' }>;
          messages = [...messages.slice(0, -1), { ...t, pos: ev.pos }];
        }
      }
      return { ...s, ...fl, messages };
    }

    case 'status':
      return { ...s, status: ev.text };

    case 'tool_start': {
      const idx = s.messages.length;
      return {
        ...s,
        messages: [
          ...s.messages,
          {
            kind: 'tool',
            id: ev.id,
            name: ev.name,
            ...(ev.args != null ? { args: ev.args } : {}), // null/undefined 都不渲染,避免显示 "null"
            status: 'running' as const,
          },
        ],
        toolIndex: { ...s.toolIndex, [ev.id]: idx },
      };
    }

    case 'tool_end': {
      const idx = s.toolIndex[ev.id];
      if (idx === undefined) return s;
      const messages = s.messages.slice();
      const item = messages[idx];
      if (!item || item.kind !== 'tool') return s;
      const summary = truncateSummary(ev.summary);
      const error = truncateSummary(ev.error);
      messages[idx] = {
        ...item,
        status: ev.ok ? 'ok' : 'err',
        ...(summary !== undefined ? { summary } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(ev.pos !== undefined ? { pos: ev.pos } : {}), // 重放剥离的工具卡:展开按 pos 取回详情
      };
      const toolIndex = { ...s.toolIndex };
      delete toolIndex[ev.id];
      return { ...s, messages, toolIndex };
    }

    case 'file':
      return {
        ...s,
        messages: [
          ...s.messages,
          { kind: 'file', path: ev.path, ...(ev.caption !== undefined ? { caption: ev.caption } : {}) },
        ],
      };

    case 'settings':
      return { ...s, settings: ev.settings };

    case 'ask':
      // 对话内提问:不产生系统气泡(避免聊天时冒"系统等待"黄框);prompt 仅作为输入提示
      return {
        ...s,
        pendingAsk: { id: ev.id, prompt: ev.prompt || '', mode: ev.mode === 'confirm' ? 'confirm' : 'input' },
      };

    case 'ask_done':
      return { ...s, pendingAsk: null };

    case 'requirement': {
      const reason = ev.reason || '';
      const item: ChatItem = { kind: 'system', text: reason, level: 'prompt' };
      const messages = reason.trim() ? [...s.messages, item] : s.messages;
      return { ...s, messages, pendingRequirement: { id: ev.id, reason, fields: ev.fields } };
    }

    case 'requirement_done':
      return { ...s, pendingRequirement: null };

    case 'session_end':
      return { ...s, status: '会话已结束' };

    case 'meta':
      return { ...s, title: ev.label || s.title };

    case 'read_marker':
      // 未读锚点分隔条:重放时服务端在「上次看到位置」插入
      return { ...s, messages: [...s.messages, { kind: 'separator', text: ev.text || '上次看到这里' }] };

    case 'replay_done':
      // 初始重放窗口完成(chatStore 里会单独拦截取分页游标,这里兜底置位)
      return { ...s, replayDone: true };

    default:
      return s; // 向前兼容:未识别事件忽略
  }
}
