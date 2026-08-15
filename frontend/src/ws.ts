/** 模块级当前 WebSocket 注册表：store 的发送 action 与 hook 解耦。 */
let currentSocket: WebSocket | null = null;

export function registerSocket(ws: WebSocket): void {
  currentSocket = ws;
}

export function clearSocket(): void {
  currentSocket = null;
}

export function isSocketOpen(): boolean {
  return currentSocket !== null && currentSocket.readyState === WebSocket.OPEN;
}

/** 发送 JSON 帧；断开时返回 false（调用方提示用户）。 */
export function sendIfOpen(obj: unknown): boolean {
  if (isSocketOpen()) {
    currentSocket!.send(JSON.stringify(obj));
    return true;
  }
  return false;
}
