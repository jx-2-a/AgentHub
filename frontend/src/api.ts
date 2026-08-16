/** REST 封装。绝对路径在 dev 经 vite 代理、在 prod 直连，两端一致。 */
import type { Agent, ArchivedSession, Instance, ServerEvent } from './types';

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export async function listAgents(): Promise<Agent[]> {
  const d = await json<{ agents?: Agent[] }>(await fetch('/api/agents'));
  return d.agents ?? [];
}

export async function listInstances(): Promise<Instance[]> {
  const d = await json<{ instances?: Instance[] }>(await fetch('/api/instances'));
  return d.instances ?? [];
}

export async function getSessions(): Promise<{ archived: ArchivedSession[] }> {
  return json<{ live: unknown[]; archived: ArchivedSession[] }>(await fetch('/api/sessions'));
}

export async function getTranscript(sid: string): Promise<ServerEvent[]> {
  const d = await json<unknown>(await fetch(`/api/transcript/${sid}`));
  return Array.isArray(d) ? (d as ServerEvent[]) : [];
}

export interface ThemePreset {
  name: string;
  vars: Record<string, string>;
}

export async function getThemePresets(): Promise<Record<string, ThemePreset>> {
  const d = await json<{ presets?: Record<string, ThemePreset> }>(await fetch('/api/theme'));
  return d.presets ?? {};
}

export async function spawnInstance(agent: string, label?: string): Promise<Instance> {
  const r = await fetch('/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, ...(label ? { label } : {}) }),
  });
  const d = await r.json();
  if (d.error) throw new Error(String(d.error));
  return d as Instance;
}

export async function stopInstance(id: string, purge = false): Promise<void> {
  await fetch(`/api/instances/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' });
}

/** 一键清理所有后台实例:停掉并删除实例 + 临时会话/转录(永久归档保留)。 */
export async function cleanAllInstances(): Promise<{ cleaned: number }> {
  const r = await fetch('/api/instances/clean_all', { method: 'POST' });
  const d = await r.json();
  if (d.error) throw new Error(String(d.error));
  return d as { cleaned: number };
}

export async function restartInstance(id: string, resume = false): Promise<void> {
  await fetch(`/api/instances/${id}/restart${resume ? '?resume=1' : ''}`, { method: 'POST' });
}

export async function archiveInstance(id: string): Promise<void> {
  await fetch(`/api/instances/${id}/archive`, { method: 'POST' });
}

export async function deleteTranscript(sid: string): Promise<void> {
  await fetch(`/api/transcript/${sid}`, { method: 'DELETE' });
}

export async function trimSession(sid: string, keep: number): Promise<void> {
  await fetch(`/api/sessions/${sid}/trim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep }),
  });
}

/** 分页拉更早历史:before = 当前窗口起点(干净切点行号),返回之前一页(纯展示事件)。
 * nextBefore = 下一页游标;hasMore=false 表示已到最早。 */
export async function getOlderEvents(
  sid: string,
  before: number,
  limit = 300,
): Promise<{ events: ServerEvent[]; nextBefore: number | null; hasMore: boolean }> {
  const r = await fetch(`/api/sessions/${sid}/history?before=${before}&limit=${limit}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<{ events: ServerEvent[]; nextBefore: number | null; hasMore: boolean }>;
}

export async function uploadBackground(file: Blob, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file, filename);
  const r = await fetch('/api/theme/upload', { method: 'POST', body: fd });
  const d = await r.json();
  if (d.error) throw new Error(String(d.error));
  return String(d.url);
}

/** agent 输出里的文件路径 → 绝对 /file 链接（链接在 markdown.ts 后处理中生成）。 */
export function fileUrl(sid: string, path: string): string {
  const u = new URL('/file', window.location.origin);
  u.searchParams.set('sid', sid);
  u.searchParams.set('path', path);
  return u.toString();
}
