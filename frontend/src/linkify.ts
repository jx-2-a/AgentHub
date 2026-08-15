/** 把文本里的文件路径变成 /file?sid=&path= 链接（在 markdown HTML 渲染后对文本节点后处理）。 */

const FILE_EXT_RE =
  /(?:[\w\-./\\一-鿿]+\.(?:png|jpe?g|gif|bmp|webp|json|ya?ml|log|txt|md|csv|py|sh|ipynb|html?|pdf|npy|nc|xml))(?=[\s<),，。]|$)/g;

/**
 * 对已渲染的 DOM 树做文本节点遍历，把匹配文件扩展名的路径替换成 <a>。
 * 只动文本节点，不改标签/属性，安全。
 */
export function linkifyElement(el: HTMLElement, sid: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    // 跳过已在链接(markdown-it linkify 生成的 URL <a>)内的文本,避免 <a> 嵌套 <a>
    if (node.parentElement?.closest('a')) continue;
    const text = node.nodeValue;
    if (!text || !FILE_EXT_RE.test(text)) continue;
    FILE_EXT_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = FILE_EXT_RE.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const p = m[0].trim();
      if (!/[:/\\]/.test(p)) {
        frag.appendChild(document.createTextNode(m[0]));
      } else {
        const a = document.createElement('a');
        a.className = 'filelink';
        a.href = `/file?sid=${encodeURIComponent(sid)}&path=${encodeURIComponent(p)}`;
        a.textContent = p;
        a.target = '_blank';
        a.rel = 'noopener';
        frag.appendChild(a);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}
