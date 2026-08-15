/** UI 状态:侧栏开关、active 会话、置顶、各类全局模态。 */
import { create } from 'zustand';

export interface FileModalState {
  url: string;
  name: string;
  kind: 'image' | 'doc';
}

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const PIN_KEY = 'hub_pinned';

function loadPinned(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PIN_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function savePinned(p: string[]): void {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

interface UiState {
  sidebarOpen: boolean;
  activeSid: string | null;
  startModal: boolean;
  startAgent: string | null;
  startLabel: string;
  settingsModal: boolean;   // 全局设置(外观等)
  runtimeModal: boolean;    // 运行时参数(当前 agent 各自的配置,独立弹窗)
  fileModal: FileModalState | null;
  contextMenu: ContextMenuState | null;
  pinned: string[]; // 置顶实例的 label(跨重启稳定)

  openSidebar(): void;
  closeSidebar(): void;
  toggleSidebar(): void;
  setActiveSid(sid: string | null): void;
  openStart(agent?: string | null, label?: string): void;
  closeStart(): void;
  openSettings(): void;
  closeSettings(): void;
  openRuntime(): void;
  closeRuntime(): void;
  openFile(f: FileModalState): void;
  closeFile(): void;
  openContextMenu(x: number, y: number, items: ContextMenuItem[]): void;
  closeContextMenu(): void;
  togglePin(label: string): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  // 桌面默认展开,移动端默认收起(避免首屏闪抽屉)
  sidebarOpen: typeof window !== 'undefined' ? !window.matchMedia('(max-width: 768px)').matches : true,
  activeSid: null,
  startModal: false,
  startAgent: null,
  startLabel: '',
  settingsModal: false,
  runtimeModal: false,
  fileModal: null,
  contextMenu: null,
  pinned: loadPinned(),

  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveSid: (sid) => set({ activeSid: sid }),
  openStart: (agent = null, label = '') => set({ startModal: true, startAgent: agent, startLabel: label }),
  closeStart: () => set({ startModal: false }),
  openSettings: () => set({ settingsModal: true }),
  closeSettings: () => set({ settingsModal: false }),
  openRuntime: () => set({ runtimeModal: true }),
  closeRuntime: () => set({ runtimeModal: false }),
  openFile: (f) => set({ fileModal: f }),
  closeFile: () => set({ fileModal: null }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),

  togglePin(label) {
    const cur = get().pinned;
    const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
    savePinned(next);
    set({ pinned: next });
  },
}));
