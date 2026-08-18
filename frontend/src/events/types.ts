/** 聊天流状态:把 WS 事件流规整成可渲染的消息项。 */
import type { FieldSpec, LogLevel } from '../types';

export type ChatItem =
  | { kind: 'system'; text: string; level: LogLevel } // 系统提示(一段一气泡,带等级)
  | { kind: 'user'; text: string; turn?: number }
  | { kind: 'assistant'; text: string; md: string | null } // md 在 assistant_final 时置为渲染用 markdown
  | { kind: 'thinking'; text: string; closed: boolean; pos?: number; hydrated?: boolean } // pos=转录行号,重放剥离后按需取回
  | { kind: 'tool'; id: string; name: string; args?: unknown; status: 'running' | 'ok' | 'err'; summary?: string; error?: string; pos?: number; hydrated?: boolean }
  | { kind: 'file'; path: string; caption?: string }
  | { kind: 'separator'; text: string }; // 「上次看到这里」未读分隔条(重放合成)

export interface PendingAsk {
  id: string;
  prompt: string;
  mode: 'input' | 'confirm';
}

export interface PendingRequirement {
  id: string;
  reason: string;
  fields: FieldSpec[];
}

export interface ChatState {
  messages: ChatItem[];
  assistantBuffer: string;
  assistantOpen: boolean;
  thinkingBuffer: string;
  thinkingOpen: boolean;
  toolIndex: Record<string, number>; // tool id → messages 中的下标(原地更新)
  status: string;
  title: string;
  settings: FieldSpec[];
  pendingAsk: PendingAsk | null;
  pendingRequirement: PendingRequirement | null;
  replayDone: boolean; // 初始重放窗口已完成(可锚滚动/可上滑分页)
}

export function initialChatState(): ChatState {
  return {
    messages: [],
    assistantBuffer: '',
    assistantOpen: false,
    thinkingBuffer: '',
    thinkingOpen: false,
    toolIndex: {},
    status: '',
    title: '',
    settings: [],
    pendingAsk: null,
    pendingRequirement: null,
    replayDone: false,
  };
}
