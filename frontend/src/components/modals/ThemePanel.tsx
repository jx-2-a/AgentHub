import { useEffect, useState } from 'react';
import { getThemePresets, uploadBackground, type ThemePreset } from '../../api';
import { useThemeStore } from '../../stores/themeStore';

const THEME_KEYS = ['light', 'dark', 'green'] as const;
const ACCENT_KEYS = ['blue', 'purple', 'red', 'amber'] as const;

/** 外观面板(设置面板左侧列表的「外观」页):主题/强调色/背景图。 */
export function ThemePanel() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [presets, setPresets] = useState<Record<string, ThemePreset>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getThemePresets().then(setPresets).catch(() => setPresets({}));
  }, []);

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
              className={theme.theme === k ? 'selected' : ''}
              onClick={() => setTheme({ theme: k })}
            >
              {presets[k]?.name ?? k}
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
              className={theme.accent === k ? 'selected' : ''}
              onClick={() => setTheme({ accent: k })}
            >
              {k}
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
