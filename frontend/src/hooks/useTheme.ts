import { useEffect } from 'react';
import { useThemeStore } from '../stores/themeStore';

/** Ctrl+Shift+T 切换亮/暗(对等现状快捷键)。 */
export function useTheme(): void {
  const toggle = useThemeStore((s) => s.toggleLightDark);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
