import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TermConn } from '../../stores/uiStore';

const enc = new TextEncoder();

// ttyd 帧类型用 ASCII 字符码:客户端 '0'=输入 / '1'=resize / '2'=paste / '3'=resume;
// 服务端 '0'=输出。首帧 init 是 JSON(文本帧)。
const TYPE_INPUT = 0x30; // '0'
const TYPE_RESIZE = 0x31; // '1'
const TYPE_OUTPUT = 0x30; // '0'

const KEY_SEQS: Array<{ key: string; label: string; seq: string; accent?: boolean }> = [
  { key: 'esc', label: 'Esc', seq: '\x1b' },
  { key: 'tab', label: 'Tab', seq: '\x09' },
  { key: 'ctrlc', label: 'Ctrl+C', seq: '\x03', accent: true },
  { key: 'up', label: '↑', seq: '\x1b[A' },
  { key: 'down', label: '↓', seq: '\x1b[B' },
  { key: 'left', label: '←', seq: '\x1b[D' },
  { key: 'right', label: '→', seq: '\x1b[C' },
];

/**
 * 终端视图:连 hub 代理的持久 ttyd 会话。断线自动重连(指数退避),服务端缓冲回放,
 * 手机上切走再回来 shell 不丢。手机(coarse pointer)底部出快捷按键工具条。
 */
export function TerminalView({
  termId,
  token,
  onState,
}: {
  termId: string;
  token: string;
  onState?: (s: TermConn) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef<(type: number, data: string) => void>(() => {});
  const focusRef = useRef<() => void>(() => {});
  const retryRef = useRef<() => void>(() => {});
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const [conn, setConn] = useState<TermConn>('connecting');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      lineHeight: 1.15,
      scrollback: 20000,
      fontFamily: 'ui-monospace, Consolas, "Courier New", monospace',
      theme: {
        background: 'rgba(13,17,23,.72)', // 半透明深底,贴合玻璃又不刺眼
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117', brightBlack: '#484f58',
        red: '#f85149', brightRed: '#ff7b72',
        green: '#3fb950', brightGreen: '#56d364',
        yellow: '#e3b341', brightYellow: '#ffa657',
        blue: '#58a6ff', brightBlue: '#79c0ff',
        magenta: '#bc8cff', brightMagenta: '#d2a8ff',
        cyan: '#39c5cf', brightCyan: '#56d4dd',
        white: '#c9d1d9', brightWhite: '#f0f6fc',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    focusRef.current = () => term.focus();
    const decoder = new TextDecoder();
    let ws: WebSocket | null = null;
    let disposed = false;
    let retryTimer: number | null = null;
    let resizeTimer: number | null = null;
    let retries = 0;

    const report = (s: TermConn) => {
      setConn(s);
      onStateRef.current?.(s);
    };

    const sendProto = (type: number, data: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const encoded = enc.encode(data);
      const buf = new Uint8Array(1 + encoded.length);
      buf[0] = type;
      buf.set(encoded, 1);
      ws.send(buf);
    };
    sendRef.current = sendProto;

    const scheduleRetry = () => {
      retries++;
      const delay = Math.min(2000 * Math.pow(1.5, retries - 1), 15000);
      retryTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed) return;
      report('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(
          `${proto}://${location.host}/term/ws/${encodeURIComponent(termId)}?token=${encodeURIComponent(token)}`,
        );
      } catch {
        scheduleRetry();
        return;
      }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        retries = 0;
        report('connected');
        // ttyd 首帧 init(AuthToken + 尺寸);重连时 hub 会丢弃多余的 init
        ws!.send(JSON.stringify({ AuthToken: '', columns: term.cols, rows: term.rows }));
        requestAnimationFrame(() => term.scrollToBottom());
        term.focus();
      };
      ws.onmessage = (e) => {
        const buf = new Uint8Array(e.data as ArrayBuffer);
        if (buf[0] === TYPE_OUTPUT) {
          term.write(decoder.decode(buf.slice(1), { stream: true }));
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        report('closed');
        scheduleRetry();
      };
      ws.onerror = () => {};
    };
    retryRef.current = () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      connect();
    };
    connect();

    const onData = term.onData((d) => sendProto(TYPE_INPUT, d));
    const onResize = term.onResize(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => sendProto(TYPE_RESIZE, JSON.stringify({ columns: term.cols, rows: term.rows })),
        100,
      );
    });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
    });
    ro.observe(el);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
    });

    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      ws?.close();
      term.dispose();
    };
  }, [termId, token]);

  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  return (
    <div className="term-page">
      <div ref={containerRef} className="term-container" />
      {isTouch && (
        <div className="term-toolbar">
          {KEY_SEQS.map((k) => (
            <button
              key={k.key}
              className={`term-key${k.accent ? ' accent' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                sendRef.current(TYPE_INPUT, k.seq);
                focusRef.current();
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      {conn === 'closed' && (
        <div className="term-overlay" onClick={() => retryRef.current()}>
          <div className="term-overlay-big">📡</div>
          <div>连接已断开,正在自动重试…</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              retryRef.current();
            }}
          >
            立即重连
          </button>
        </div>
      )}
    </div>
  );
}
