import { IconFullscreen } from './icons';

/** 兼容的屏幕方向锁定接口(Android Chrome 支持;iOS Safari 无此 API)。 */
type ScreenLike = {
  lockOrientation?: (o: string) => boolean;
  webkitLockOrientation?: (o: string) => boolean;
  orientation?: {
    lock?: (o: string) => Promise<void>;
    unlock?: () => void;
    webkitLockOrientation?: (o: string) => boolean;
  };
};

function lockPortrait() {
  const s = screen as unknown as ScreenLike;
  const so = s.orientation;
  if (so?.lock) so.lock('portrait').catch(() => {});
  else if (s.lockOrientation) s.lockOrientation('portrait');
  else if (s.webkitLockOrientation) s.webkitLockOrientation('portrait');
  else if (so?.webkitLockOrientation) so.webkitLockOrientation('portrait');
}

function unlockOrientation() {
  const so = (screen as unknown as ScreenLike).orientation;
  if (so?.unlock) so.unlock();
}

// 等 fullscreenchange(全屏真正激活)再锁,Android 才允许;退出时解锁
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) lockPortrait();
  else unlockOrientation();
});

async function toggleFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const isFs = document.fullscreenElement || doc.webkitFullscreenElement;
  if (!isFs) {
    if (el.requestFullscreen) await el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  }
}

/** 全屏按钮:各页面右上角常驻。进入全屏后尝试锁竖屏。 */
export function FullscreenToggle() {
  return (
    <button className="icon-btn" title="全屏" aria-label="全屏" onClick={toggleFullscreen}>
      <IconFullscreen />
    </button>
  );
}
