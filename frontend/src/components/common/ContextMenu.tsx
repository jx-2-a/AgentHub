import { useEffect, useMemo } from 'react';
import { useUiStore } from '../../stores/uiStore';

/** 右键/溢出菜单:全局渲染于光标处,Esc / 点击别处 / 滚动 关闭。 */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onClose = () => close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClose);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClose);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [menu, close]);

  const style = useMemo(() => {
    if (!menu) return undefined;
    const width = 168;
    const height = menu.items.length * 36 + 8;
    return {
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div className="ctx-menu" style={style}>
      {menu.items.map((item, i) => (
        <button
          key={i}
          className={`ctx-item${item.danger ? ' danger' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            close();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
