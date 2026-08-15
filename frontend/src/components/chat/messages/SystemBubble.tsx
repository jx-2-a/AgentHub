import type { LogLevel } from '../../../types';

/** 系统提示气泡:透明背景、固定宽度、无内部滚动。
 * 按等级区分:info 左对齐 / choice 选择卡(左对齐) / welcome 欢迎卡(居中) / hint 提示 / prompt 系统询问(彩色)。 */
export function SystemBubble({ text, level }: { text: string; level: LogLevel }) {
  return (
    <div className={`msg system${level === 'welcome' ? ' sys-welcome-row' : ''}`}>
      <div className={`system-bubble sys-${level}`}>{text}</div>
    </div>
  );
}
