/** 主题持久化与应用。沿用现状 localStorage 键 hub_theme。 */
export type ThemeKind = 'light' | 'dark' | 'green';
export type AccentKind = 'blue' | 'purple' | 'red' | 'amber';

export interface HubTheme {
  theme: ThemeKind;
  accent: AccentKind;
  bg?: string;
}

const KEY = 'hub_theme';
const THEMES: ThemeKind[] = ['light', 'dark', 'green'];
const ACCENTS: AccentKind[] = ['blue', 'purple', 'red', 'amber'];

function isTheme(v: unknown): v is ThemeKind {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}
function isAccent(v: unknown): v is AccentKind {
  return typeof v === 'string' && (ACCENTS as string[]).includes(v);
}

export function loadTheme(): HubTheme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return {
      theme: isTheme(t.theme) ? t.theme : 'light',
      accent: isAccent(t.accent) ? t.accent : 'blue',
      ...(typeof t.bg === 'string' && t.bg ? { bg: t.bg } : {}),
    };
  } catch {
    return { theme: 'light', accent: 'blue' };
  }
}

export function saveTheme(t: HubTheme): void {
  localStorage.setItem(KEY, JSON.stringify(t));
}

/** 把主题应用到 document（data-theme / data-accent / --bg-image）。 */
export function applyTheme(t: HubTheme): void {
  const root = document.documentElement;
  root.dataset.theme = t.theme;
  root.dataset.accent = t.accent;
  root.style.setProperty('--bg-image', t.bg ? `url(${t.bg})` : 'none');
}

/** 首次渲染前应用已存主题，避免 FOUC。 */
export function initTheme(): void {
  applyTheme(loadTheme());
}
