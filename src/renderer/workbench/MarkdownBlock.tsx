import React from 'react'
import { renderMarkdown } from './markdown-renderer'

export function MarkdownBlock({ content, emptyText }: { content: string; emptyText?: string }) {
  const source = content.trim()
  const html = renderMarkdown(source || (emptyText ?? ''))
  return <div className="wb-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
