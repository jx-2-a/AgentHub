import { useEffect, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';

/** 文件页内预览:图片全尺寸 / 文档文本。 */
export function FileModal() {
  const file = useUiStore((s) => s.fileModal);
  const close = useUiStore((s) => s.closeFile);
  const [docText, setDocText] = useState<string | null>(null);

  useEffect(() => {
    if (file && file.kind === 'doc') {
      setDocText(null);
      fetch(file.url)
        .then((r) => r.text())
        .then((t) => setDocText(t))
        .catch(() => setDocText('无法加载文件'));
    }
  }, [file]);

  if (!file) return null;

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
          <button onClick={close}>✕</button>
        </div>
        <div id="file-modal-body">
          {file.kind === 'image' ? (
            <img src={file.url} alt={file.name} />
          ) : (
            <pre>{docText ?? '加载中…'}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
