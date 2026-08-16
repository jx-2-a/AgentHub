import type { LogLevel } from '../../../types';
import { Markdown } from '../Markdown';

/** 系统提示气泡:透明背景、固定宽度、无内部滚动。
 * 按等级区分:info 左对齐 / choice 选择卡(左对齐) / welcome 欢迎卡(居中) / hint 提示 / prompt 系统询问(彩色)。
 * info/hint 是自由文本日志(常带表格/列表的中间结论)→ markdown 渲染;welcome 是 ASCII art、choice 是等宽菜单、
 * prompt 是短询问,保持原样。 */
export function SystemBubble({ text, level, sid }: { text: string; level: LogLevel; sid?: string | null }) {
  const rich = level === 'info' || level === 'hint';
  return (
    <div className={`msg system${level === 'welcome' ? ' sys-welcome-row' : ''}`}>
      <div className={`system-bubble sys-${level}`}>
        {rich ? <Markdown content={text} sid={sid} /> : text}
      </div>
    </div>
  );
}
