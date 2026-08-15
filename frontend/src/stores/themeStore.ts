/** 主题 store:响应式主题状态,改动即持久化并应用到 document。 */
import { create } from 'zustand';
import { applyTheme, loadTheme, saveTheme, type HubTheme } from '../theme';

interface ThemeState {
  theme: HubTheme;
  setTheme(p: Partial<HubTheme>): void;
  toggleLightDark(): void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: loadTheme(),

  setTheme(p) {
    const t = { ...get().theme, ...p };
    saveTheme(t);
    applyTheme(t);
    set({ theme: t });
  },
  toggleLightDark() {
    const t = get().theme;
    get().setTheme({ theme: t.theme === 'dark' ? 'light' : 'dark' });
  },
}));
