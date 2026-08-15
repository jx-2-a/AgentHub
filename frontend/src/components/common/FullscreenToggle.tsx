import { IconFullscreen } from './icons';

function toggleFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const isFs = document.fullscreenElement || doc.webkitFullscreenElement;
  if (!isFs) {
    // 进入全屏:优先标准 API,兼容 webkit(iOS Safari 只认 webkit 前缀)
    if (el.requestFullscreen) void el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) void document.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  }
}

/** 全屏按钮:各页面右上角常驻。SVG 图标 + vendor 前缀(手机能进能退)。 */
export function FullscreenToggle() {
  return (
    <button className="icon-btn" title="全屏" aria-label="全屏" onClick={toggleFullscreen}>
      <IconFullscreen />
    </button>
  );
}
