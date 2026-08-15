/**
 * 浏览器 viewer WebSocket 生命周期:
 * - 连接 / 断线指数退避重连(1s→10s)
 * - 每次 onopen 清空 store 再让服务器重放历史(重连不重复)
 * - 代际计数器防 StrictMode 双挂载 / 切 sid 后的旧回调生效
 */
import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';
import { clearSocket, registerSocket } from '../ws';

export function useChatConnection(sid: string | null): void {
  const genRef = useRef(0);

  useEffect(() => {
    if (!sid) return;
    genRef.current += 1;
    const gen = genRef.current;
    let current: WebSocket | null = null;
    let timer: number | null = null;
    let backoff = 1000;
    let lastReceived = Date.now();

    useChatStore.getState().setConnection('connecting');

    // 切回前台但连接长时间无数据 → 可能是僵尸连接(浏览器后台挂起的 WS),
    // 主动关闭触发重连,避免消息发到死连接上"被吞"
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastReceived > 30000) {
        current?.close();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const connect = () => {
      if (gen !== genRef.current) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/chat/${sid}`);
      current = ws;
      registerSocket(ws);
      let opened = false;

      ws.onopen = () => {
        if (gen !== genRef.current) return;
        opened = true;
        backoff = 1000;
        const st = useChatStore.getState();
        st.reset(sid); // 清空 → 服务器重放历史 → 无重复
        st.setConnection('connected');
      };

      ws.onmessage = (e) => {
        if (gen !== genRef.current) return;
        lastReceived = Date.now();
        try {
          useChatStore.getState().applyEvent(JSON.parse(String(e.data)));
        } catch {
          /* 忽略坏帧 */
        }
      };

      ws.onerror = () => {
        /* onclose 会随后触发 */
      };

      ws.onclose = () => {
        if (gen !== genRef.current) return;
        clearSocket();
        const st = useChatStore.getState();
        st.setConnection('reconnecting');
        st.setStatus(opened ? '已断开，重连中…' : '会话不存在或已归档');
        st.setNotFound(!opened);
        const delay = backoff;
        backoff = Math.min(backoff * 2, 10000);
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      genRef.current += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearTimeout(timer);
      if (current) {
        try {
          current.close();
        } catch {
          /* noop */
        }
      }
      clearSocket();
    };
  }, [sid]);
}
