/** 侧栏数据:agent 库 + 实例 + 归档记录。4s 轮询由 useSidebarPolling 驱动。 */
import { create } from 'zustand';
import type { Agent, ArchivedSession, Instance } from '../types';
import { getSessions, listAgents, listInstances } from '../api';

interface HubState {
  agents: Agent[];
  instances: Instance[];
  archived: ArchivedSession[];
  error: string | null;
  refreshing: boolean;
  refresh(): Promise<void>;
}

export const useHubStore = create<HubState>((set, get) => ({
  agents: [],
  instances: [],
  archived: [],
  error: null,
  refreshing: false,

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const [agents, instances, sessions] = await Promise.all([
        listAgents(),
        listInstances(),
        getSessions(),
      ]);
      set({ agents, instances, archived: sessions.archived, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ refreshing: false });
    }
  },
}));
