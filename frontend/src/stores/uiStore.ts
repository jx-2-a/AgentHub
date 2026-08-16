/** UI 状态:侧栏开关、active 会话、置顶、各类全局模态。 */
import { create } from 'zustand';

export interface FileModalState {
  url: string;
  name: string;
  kind: 'image' | 'doc';
}

export type TermConn = 'connecting' | 'connected' | 'closed';

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
const TOOL_GROUP_KEY = 'hub_tool_group_open';
const FAV_KEY = 'hub_fav';

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

/** 文件收藏:路径(相对 FILE_ROOT)列表,点击跳大文件页并作为浏览边界。 */
function loadFavs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveFavs(p: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

interface UiState {
  sidebarOpen: boolean;
  toolGroupOpen: boolean; // 工具组默认展开/收起(用户开合过就记住)
  activeSid: string | null;
  startModal: boolean;
  startAgent: string | null;
  startLabel: string;
  settingsModal: boolean;   // 全局设置(外观等)
  runtimeModal: boolean;    // 运行时参数(当前 agent 各自的配置,独立弹窗)
  termModal: boolean;       // 终端 token 弹窗
  term: { id: string; token: string } | null; // 当前终端会话(token 只在内存,不进 URL)
  termConn: TermConn;       // 终端连接状态(状态点用)
  fileModal: FileModalState | null;
  contextMenu: ContextMenuState | null;
  pinned: string[]; // 置顶实例的 label(跨重启稳定)
  favorites: string[]; // 文件收藏路径(相对 FILE_ROOT)

  openSidebar(): void;
  closeSidebar(): void;
  toggleSidebar(): void;
  setToolGroupOpen(b: boolean): void;
  setActiveSid(sid: string | null): void;
  openStart(agent?: string | null, label?: string): void;
  closeStart(): void;
  openSettings(): void;
  closeSettings(): void;
  openRuntime(): void;
  closeRuntime(): void;
  openTerm(): void;
  closeTerm(): void;
  setTerm(t: { id: string; token: string } | null): void;
  openFile(f: FileModalState): void;
  closeFile(): void;
  openContextMenu(x: number, y: number, items: ContextMenuItem[]): void;
  closeContextMenu(): void;
  togglePin(label: string): void;
  addFavorite(path: string): void;
  removeFavorite(path: string): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  // 桌面默认展开,移动端默认收起(避免首屏闪抽屉)
  sidebarOpen: typeof window !== 'undefined' ? !window.matchMedia('(max-width: 768px)').matches : true,
  toolGroupOpen: localStorage.getItem(TOOL_GROUP_KEY) === '1',
  activeSid: null,
  startModal: false,
  startAgent: null,
  startLabel: '',
  settingsModal: false,
  runtimeModal: false,
  termModal: false,
  term: null,
  termConn: 'connecting',
  fileModal: null,
  contextMenu: null,
  pinned: loadPinned(),
  favorites: loadFavs(),

  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setToolGroupOpen(b) {
    localStorage.setItem(TOOL_GROUP_KEY, b ? '1' : '0');
    set({ toolGroupOpen: b });
  },
  setActiveSid: (sid) => set({ activeSid: sid }),
  openStart: (agent = null, label = '') => set({ startModal: true, startAgent: agent, startLabel: label }),
  closeStart: () => set({ startModal: false }),
  openSettings: () => set({ settingsModal: true }),
  closeSettings: () => set({ settingsModal: false }),
  openRuntime: () => set({ runtimeModal: true }),
  closeRuntime: () => set({ runtimeModal: false }),
  openTerm: () => set({ termModal: true }),
  closeTerm: () => set({ termModal: false }),
  setTerm: (t) => set({ term: t }),
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
  addFavorite(path) {
    const cur = get().favorites;
    if (cur.includes(path)) return;
    const next = [...cur, path];
    saveFavs(next);
    set({ favorites: next });
  },
  removeFavorite(path) {
    const next = get().favorites.filter((p) => p !== path);
    saveFavs(next);
    set({ favorites: next });
  },
}));
