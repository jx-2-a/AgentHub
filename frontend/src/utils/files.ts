/** 文件相关小工具:收藏显示名、预览/下载 URL(带 root 边界)。 */

/** 收藏/路径显示名:空路径 → 文件库(整根),否则取最后一段。 */
export function favName(path: string): string {
  if (!path) return '文件库';
  const seg = path.split('/').filter(Boolean);
  return seg[seg.length - 1];
}

/** 预览/下载 URL。root 为浏览边界(收藏根),download=1 强制附件下载。 */
export function fileUrl(path: string, root?: string, download = false): string {
  const u = new URL('/api/file', window.location.origin);
  u.searchParams.set('path', path);
  if (root) u.searchParams.set('root', root);
  if (download) u.searchParams.set('download', '1');
  return u.toString();
}
