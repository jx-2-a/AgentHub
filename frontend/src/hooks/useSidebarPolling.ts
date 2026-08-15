import { useEffect } from 'react';
import { useHubStore } from '../stores/hubStore';

const POLL_MS = 4000;

/** 侧栏数据 4s 轮询(对等现状 setInterval 行为)。 */
export function useSidebarPolling(): void {
  const refresh = useHubStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);
}
