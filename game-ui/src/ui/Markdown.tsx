/** Minimal renderer for the scenario's public documents: headings, lists and paragraphs, as text. */
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const ordered = /^\d+\.\s+(.*)/.exec(line)
    const bullet = /^[-*]\s+(.*)/.exec(line)
    if (!line) {
      flushParagraph()
      flushList()
    } else if (line.startsWith('#')) {
      flushParagraph()
      flushList()
      const level = line.match(/^#+/)![0].length
      const content = line.replace(/^#+\s*/, '')
      blocks.push(level === 1 ? <h3 key={blocks.length}>{content}</h3> : <h4 key={blocks.length}>{content}</h4>)
    } else if (ordered || bullet) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      if (list && list.ordered !== isOrdered) flushList()
      list ??= { ordered: isOrdered, items: [] }
      list.items.push((ordered ?? bullet)![1])
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return <div className="markdown">{blocks}</div>
}

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  )
}
