import { useState } from 'react';
import { uploadBackground } from '../../api';
import { useThemeStore } from '../../stores/themeStore';
import { ACCENT_NAMES, THEME_NAMES, type AccentKind, type ThemeKind } from '../../theme';

const THEME_KEYS: ThemeKind[] = ['light', 'dark', 'green', 'sepia', 'ocean'];
const ACCENT_KEYS: AccentKind[] = ['blue', 'purple', 'red', 'amber', 'cyan', 'pink', 'orange'];

// 预览色块:每个主题给 bg/fg/accent 三点(纯视觉提示,不参与实际应用)
const THEME_PREVIEW: Record<ThemeKind, { bg: string; fg: string; accent: string }> = {
  light: { bg: '#ffffff', fg: '#1f2328', accent: '#0969da' },
  dark: { bg: '#0d1117', fg: '#e6edf3', accent: '#58a6ff' },
  green: { bg: '#0f1c14', fg: '#e6f4ea', accent: '#2ea043' },
  sepia: { bg: '#f7f2e7', fg: '#3f3a30', accent: '#b0773c' },
  ocean: { bg: '#0a1e2a', fg: '#dceff7', accent: '#2aa9d4' },
};
const ACCENT_COLORS: Record<AccentKind, string> = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  red: '#ef4444',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  pink: '#ec4899',
  orange: '#f97316',
};

/** 外观面板(设置面板「外观」页):主题/强调色/背景图。名字本地化,不再闪英文。 */
export function ThemePanel() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadBackground(file, file.name);
      setTheme({ bg: url });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="theme-section">
        <div className="settings-label">主题</div>
        <div className="theme-options">
          {THEME_KEYS.map((k) => (
            <button
              key={k}
              className={`theme-option${theme.theme === k ? ' selected' : ''}`}
              onClick={() => setTheme({ theme: k })}
              title={THEME_NAMES[k]}
            >
              <span className="th-swatch" style={{ background: THEME_PREVIEW[k].bg }}>
                <span className="th-dot" style={{ background: THEME_PREVIEW[k].accent }} />
                <span className="th-line" style={{ background: THEME_PREVIEW[k].fg }} />
              </span>
              {THEME_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="theme-section">
        <div className="settings-label">强调色</div>
        <div className="theme-options">
          {ACCENT_KEYS.map((k) => (
            <button
              key={k}
              className={`accent-option${theme.accent === k ? ' selected' : ''}`}
              onClick={() => setTheme({ accent: k })}
            >
              <span className="ac-dot" style={{ background: ACCENT_COLORS[k] }} />
              {ACCENT_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="theme-section">
        <div className="settings-label">背景图</div>
        <div className="theme-bg-row">
          <label className="file-picker">
            选择图片
            <input type="file" accept="image/*" onChange={onUpload} disabled={busy} />
          </label>
          {theme.bg && (
            <button className="btn-ghost" onClick={() => setTheme({ bg: undefined })}>
              清除
            </button>
          )}
        </div>
      </div>
    </>
  );
}
