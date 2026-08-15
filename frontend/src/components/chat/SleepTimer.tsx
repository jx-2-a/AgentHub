import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';

/** 定时/休眠倒计时条:实时跳秒,点击打断接管。 */
export function SleepTimer() {
  const timer = useChatStore((s) => s.timer);
  const clearTimer = useChatStore((s) => s.clearTimer);
  const interrupt = useChatStore((s) => s.interrupt);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => {
      const t = useChatStore.getState().timer;
      if (t && Date.now() / 1000 >= t.end) {
        useChatStore.getState().clearTimer(); // 到点自动消失
      } else {
        setNow(Date.now() / 1000);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [timer, clearTimer]);

  if (!timer) return null;
  const remain = Math.max(0, Math.round(timer.end - now));
  if (remain <= 0) return null;

  const h = Math.floor(remain / 3600);
  const m = Math.floor((remain % 3600) / 60);
  const s = remain % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  return (
    <div className="sleep-banner" onClick={interrupt} title="点击打断接管">
      <span>⏰ {timer.text}</span>
      <span className="sleep-clock">{clock}</span>
      <span className="sleep-tap">点击打断</span>
    </div>
  );
}
