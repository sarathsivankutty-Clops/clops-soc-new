/**
 * Safe pure-React Markdown renderer for LLM incident reports.
 *
 * Security invariants:
 * - Zero `dangerouslySetInnerHTML`: all text is rendered as React text children.
 * - Zero raw HTML parsing: `<script>` or inline HTML renders literally escaped.
 * - Links allow only `http:`, `https:`, or relative `/` paths; external links
 *   open in a new tab with `rel="noopener noreferrer"`.
 */

import { Fragment, type ReactNode } from 'react';

const INLINE_RE =
  /(\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

function isSafeHref(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE_RE)
    .filter((s) => s !== '')
    .map((seg, idx) => {
      const key = `${keyPrefix}-${idx}`;
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
        return (
          <strong key={key} className="font-semibold text-fg-primary">
            {seg.slice(2, -2)}
          </strong>
        );
      }
      if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
        return (
          <em key={key} className="italic text-fg-primary">
            {seg.slice(1, -1)}
          </em>
        );
      }
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
        return (
          <code
            key={key}
            className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[0.9em] text-fg-primary border border-surface-border"
          >
            {seg.slice(1, -1)}
          </code>
        );
      }
      const linkMatch = seg.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        if (isSafeHref(href)) {
          const isExternal = href.startsWith('http://') || href.startsWith('https://');
          return (
            <a
              key={key}
              href={href}
              {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-accent underline underline-offset-2 hover:opacity-80"
            >
              {label}
            </a>
          );
        }
        return <Fragment key={key}>{label}</Fragment>;
      }
      return <Fragment key={key}>{seg}</Fragment>;
    });
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function SafeMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-control border border-surface-border bg-surface-elevated p-3 font-mono text-xs text-fg-primary"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Headings (# .. ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2], `h-${i}`);
      const cls =
        level === 1
          ? 'text-lg font-bold text-fg-primary border-b border-surface-border pb-1.5 mt-2'
          : level === 2
            ? 'text-base font-semibold text-fg-primary mt-4'
            : 'text-sm font-semibold text-fg-primary mt-3';
      if (level === 1) blocks.push(<h1 key={`h-${i}`} className={cls}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${i}`} className={cls}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`h-${i}`} className={cls}>{content}</h3>);
      else blocks.push(<h4 key={`h-${i}`} className={cls}>{content}</h4>);
      i++;
      continue;
    }

    // GFM pipe table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`tbl-${i}`} className="overflow-x-auto rounded-control border border-surface-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-surface-elevated border-b border-surface-border">
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3 py-2 font-semibold text-fg-primary">
                    {renderInline(h, `th-${i}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row, ri) => (
                <tr key={ri} className="bg-surface-card">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-fg-secondary align-top">
                      {renderInline(row[ci] ?? '', `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-5 text-sm text-fg-secondary">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-5 text-sm text-fg-secondary">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-accent pl-3 text-sm italic text-fg-muted"
        >
          {renderInline(quoteLines.join(' '), `bq-${i}`)}
        </blockquote>,
      );
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>') &&
      !(lines[i].trim().includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed text-fg-secondary">
        {renderInline(paraLines.join(' '), `p-${i}`)}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
