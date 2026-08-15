import { useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';

/** 轻提示:发送失败/断开时的内联 toast,自动消失。 */
export function Toast() {
  const toast = useChatStore((s) => s.toast);
  const clearToast = useChatStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(clearToast, 2600);
    return () => window.clearTimeout(t);
  }, [toast, clearToast]);

  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
