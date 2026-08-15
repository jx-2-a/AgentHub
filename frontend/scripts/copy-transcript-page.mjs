// 构建后把 SPA 的 index.html 复制为 hub/static/transcript_view.html。
// 后端 /transcripts/{sid} 路由返回 legacy transcript_view.html；
// 我们用同一份 SPA 顶替它，React Router 匹配 /transcripts/:sid 渲染回看页。
// 纯前端侧 shim，不改后端。
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(root, 'hub', 'static', 'index.html');
const dst = resolve(root, 'hub', 'static', 'transcript_view.html');
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`copy-transcript-page: ${src} -> ${dst}`);
