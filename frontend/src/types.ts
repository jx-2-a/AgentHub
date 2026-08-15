/** 与后端 REST/WS 契约对应的类型。字段名严格对齐 hub/ 里的 Python 模型。 */

export interface Experiment {
  label: string;
  path: string;
  last_used: string;
}

export interface Agent {
  key: string;
  name: string;
  description: string;
  hub: boolean;
  label_default: string;
  experiments: Experiment[];
}

export interface Instance {
  id: string;
  agent_key: string;
  label: string;
  pid: number | null;
  status: 'starting' | 'connected' | 'exited';
  created: number;
  session_id: string | null;
  error: string | null;
}

export interface ArchivedSession {
  sid: string;
  size: number;
  mtime: number;
  label?: string; // 归档卡同名(取自转录首条 meta)
}

/** requirement 表单 + settings 共用的字段 schema（PROTOCOL §6）。
 * 支持多种形式:选择列表(select)、字符输入(text/password/otp/number/textarea)。 */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'password' | 'otp' | 'number' | 'toggle' | 'select' | 'textarea';
  value?: unknown;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

/** log 等级:info 简单信息 / choice 启动选择项 / welcome 欢迎卡片 / hint 提示段 / prompt 系统询问(需要输入) / silent 只落转录不上屏。 */
export type LogLevel = 'info' | 'choice' | 'welcome' | 'hint' | 'prompt' | 'silent';

/** WS /ws/chat/{sid} 服务器→浏览器的全部事件（PROTOCOL §5）。 */
export type ServerEvent =
  | { type: 'session_state'; status: string }
  | { type: 'log'; text: string; level?: LogLevel }
  | { type: 'user'; text: string; turn?: number }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_final'; content: string }
  | { type: 'assistant_end' }
  | { type: 'thinking_delta'; content: string }
  | { type: 'thinking_end' }
  | { type: 'status'; text: string }
  | { type: 'tool_start'; id: string; name: string; args?: unknown }
  | { type: 'tool_end'; id: string; ok: boolean; summary?: string; error?: string }
  | { type: 'file'; path: string; caption?: string }
  | { type: 'settings'; settings: FieldSpec[] }
  | { type: 'sleep_start'; seconds: number; text?: string }
  | { type: 'sleep_end' }
  | { type: 'ask'; id: string; prompt: string; mode?: 'input' | 'confirm' }
  | { type: 'ask_done' }
  | { type: 'requirement'; id: string; reason: string; fields: FieldSpec[] }
  | { type: 'requirement_done' }
  | { type: 'session_end' }
  | { type: 'meta'; label?: string; project_root?: string };
