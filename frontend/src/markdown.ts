/** markdown 渲染：markdown-it + highlight.js + 文件路径 linkify 后处理。 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import { linkifyElement } from './linkify';

const md: MarkdownIt = new MarkdownIt({
  html: false, // 现状 renderMd 先 escape 全部 HTML；markdown-it 对未转义 HTML 原样输出，必须关
  linkify: true,
  breaks: true, // 与现状 \n → <br> 一致
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      } catch {
        /* fallthrough */
      }
    }
    try {
      return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
    } catch {
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    }
  },
});

/** 渲染 markdown → HTML 字符串，并把文本里的文件路径替换成 /file 链接。 */
export function renderMarkdownHtml(content: string, sid: string): string {
  const div = document.createElement('div');
  div.innerHTML = md.render(content || '');
  linkifyElement(div, sid);
  return div.innerHTML;
}
