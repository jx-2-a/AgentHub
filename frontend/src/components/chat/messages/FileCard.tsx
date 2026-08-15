import { fileUrl } from '../../../api';
import type { ChatItem } from '../../../events/types';
import { useUiStore } from '../../../stores/uiStore';

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

/** 文件卡片:图片内联(点击缩放),文档链接 → 页内预览。 */
export function FileCard({
  item,
  sid,
}: {
  item: Extract<ChatItem, { kind: 'file' }>;
  sid?: string | null;
}) {
  const url = fileUrl(sid ?? '', item.path);
  const ext = (item.path || '').split('.').pop()?.toLowerCase() ?? '';
  const isImg = IMG_EXT.includes(ext);
  const open = () => useUiStore.getState().openFile({ url, name: item.path, kind: isImg ? 'image' : 'doc' });

  return (
    <div className="file-card">
      {isImg ? (
        <img src={url} alt={item.path} onClick={open} />
      ) : (
        <a
          className="f-link"
          href={url}
          onClick={(e) => {
            e.preventDefault();
            open();
          }}
        >
          📄 {item.path.split(/[\\/]/).pop() || item.path}
        </a>
      )}
      {item.caption && <div className="f-cap">{item.caption}</div>}
    </div>
  );
}
