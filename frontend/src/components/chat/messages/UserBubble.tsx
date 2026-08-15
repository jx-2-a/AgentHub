/** 用户气泡:右对齐;去掉 turn 前缀(不再显示 "[N] 你 >"),空回显不渲染。 */
export function UserBubble({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="msg user">
      <div className="bubble">{text}</div>
    </div>
  );
}
