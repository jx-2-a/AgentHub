import { useEffect, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { Markdown } from '../chat/Markdown';

/** 文件页内预览:图片可缩放(适应/1:1/±)、文档文本/markdown 渲染、可浏览器新窗口打开。 */
export function FileModal() {
  const file = useUiStore((s) => s.fileModal);
  const close = useUiStore((s) => s.closeFile);
  const [docText, setDocText] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0); // 0=适应窗口;>0 缩放倍数(相对容器宽)
  const [imgError, setImgError] = useState(false);

  const isMd = file ? /\.(md|markdown)$/i.test(file.name) : false;

  useEffect(() => {
    if (file && file.kind === 'doc') {
      setDocText(null);
      fetch(file.url)
        .then((r) => r.text())
        .then((t) => setDocText(t))
        .catch(() => setDocText('无法加载文件'));
    }
    setZoom(0); // 切文件重置缩放
    setImgError(false);
  }, [file]);

  if (!file) return null;

  const openInBrowser = () => window.open(file.url, '_blank');

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-box file-modal-box">
        <div id="file-modal-head">
          <span id="file-modal-title">{file.name}</span>
          <div id="file-modal-actions">
            {file.kind === 'image' && (
              <>
                <button onClick={() => setZoom((z) => Math.max(0.25, +(z * 0.75).toFixed(2)))} title="缩小">
                  −
                </button>
                <span className="fm-zoom">{zoom > 0 ? `${Math.round(zoom * 100)}%` : '适应'}</span>
                <button
                  onClick={() => setZoom((z) => (z ? Math.min(8, +(z * 1.35).toFixed(2)) : 1))}
                  title="放大"
                >
                  ＋
                </button>
                <button onClick={() => setZoom(1)} title="100% 实际大小">
                  1:1
                </button>
                <button onClick={() => setZoom(0)} title="适应窗口">
                  ⤢
                </button>
              </>
            )}
            <button onClick={openInBrowser} title="浏览器新窗口打开(图片走原生查看器)">
              ↗
            </button>
            <button onClick={close}>✕</button>
          </div>
        </div>
        <div id="file-modal-body">
          {file.kind === 'image' ? (
            imgError ? (
              <div className="fm-error">
                无法打开:文件不存在或路径有误
                <br />
                若路径含隐藏目录(如 .agentspace),检查它前面是否有反斜杠分隔符。
              </div>
            ) : (
              <img
                src={file.url}
                alt={file.name}
                className="fm-img"
                onClick={() => setZoom((z) => (z ? 0 : 1))} // 点击图片:适应 ↔ 100%
                onError={() => setImgError(true)}
                title="点击切换 适应/实际大小"
                style={zoom > 0 ? { width: `${zoom * 100}%`, maxWidth: 'none' } : undefined}
              />
            )
          ) : isMd ? (
            <div className="fm-md">
              <Markdown content={docText ?? ''} />
            </div>
          ) : (
            <pre>{docText ?? '加载中…'}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
