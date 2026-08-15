import { useMemo } from 'react';
import { renderMarkdownHtml } from '../../markdown';

/** markdown 渲染组件:markdown-it + 文件路径 linkify。 */
export function Markdown({ content, sid }: { content: string; sid?: string | null }) {
  const html = useMemo(() => renderMarkdownHtml(content, sid ?? ''), [content, sid]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
