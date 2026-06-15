import { Fragment } from "react";

import { cn } from "@agentscope/ui";

/**
 * Minimal, XSS-safe Markdown renderer for agent outputs and
 * investigation summaries. We escape the input first, then apply
 * markdown transformations to the escaped string. The output is a
 * small set of known elements — no raw HTML from the source is ever
 * rendered.
 *
 * Supported syntax:
 *  - Headings (# … ######)
 *  - Bold (**text**, __text__)
 *  - Italic (*text*, _text_)
 *  - Inline code (`code`)
 *  - Fenced code blocks (```lang … ```)
 *  - Unordered lists (- … or * …)
 *  - Ordered lists (1. … 2. …)
 *  - Block quotes (> …)
 *  - Pipe tables (| col | col |)
 *  - Horizontal rules (---)
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "table"; headers: string[]; rows: string[][] };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape for an HTML *attribute* (double-quoted) context. The escaped
 * string is safe to interpolate into `href="..."`. The character set
 * in the link regex below already excludes `"`/`'`/`<`/`>` so this is
 * defense-in-depth, not the primary defense.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function applyInline(value: string): string {
  // Pull links out of the raw input FIRST (before escapeHtml) and replace
  // each with a NUL-delimited placeholder. This is the only correct way
  // to capture the original URL — once escapeHtml runs, a literal `"`
  // in the source becomes `&quot;`, which the link regex would happily
  // match as part of the URL and then re-decode as `"` on render,
  // breaking out of the `href="..."` attribute. By extracting on the
  // raw input we keep the URL in its original form, validate it against
  // a strict character class, and re-escape it for attribute context.
  const linkHtml: string[] = [];
  const stripped = value.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s"'<>`)]+|\/[^\s"'<>`]*)\)/g,
    (_, text: string, url: string) => {
      const idx = linkHtml.length;
      linkHtml.push(
        `<a href="${escapeAttr(url)}" class="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`,
      );
      return `\x00LINK${idx}\x00`;
    },
  );

  // Now escape the rest of the input. The placeholders contain no
  // HTML-special characters (NUL + ASCII letters/digits + "LINK"), so
  // they pass through unchanged.
  let out = escapeHtml(stripped);

  // Inline code first (so other replacements don't touch its contents).
  out = out.replace(
    /`([^`\n]+)`/g,
    (_, code: string) =>
      `<code class="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">${code}</code>`,
  );

  // Bold (** or __). Must run before italic so __x__ doesn't break.
  out = out.replace(
    /\*\*([^*\n]+)\*\*/g,
    '<strong class="font-semibold text-foreground">$1</strong>',
  );
  out = out.replace(
    /__([^_\n]+)__/g,
    '<strong class="font-semibold text-foreground">$1</strong>',
  );

  // Italic (* or _) — single underscore, not part of a word.
  out = out.replace(
    /(^|[^*\w])\*([^*\n]+)\*/g,
    '$1<em class="italic">$2</em>',
  );
  out = out.replace(
    /(^|[^_\w])_([^_\n]+)_/g,
    '$1<em class="italic">$2</em>',
  );

  // Restore the link placeholders with the pre-built, attribute-safe HTML.
  for (let i = 0; i < linkHtml.length; i += 1) {
    out = out.replace(`\x00LINK${i}\x00`, linkHtml[i] ?? "");
  }

  return out;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  // Trim leading/trailing pipes then split.
  const trimmed = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isBlockStart = (line: string): boolean =>
    /^\s*#{1,6}\s+/.test(line) ||
    line.startsWith("```") ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    line.startsWith("> ") ||
    /^[-*_]{3,}\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block.
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buffer.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ kind: "code", lang, text: buffer.join("\n") });
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    // Block quote (collect consecutive `> ` lines, blank line ends it).
    if (line.startsWith("> ")) {
      const buffer: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        buffer.push((lines[i] ?? "").slice(2));
        i += 1;
      }
      blocks.push({ kind: "quote", text: buffer.join("\n") });
      continue;
    }

    // Pipe table.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) {
      const headers = splitRow(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: collect until a blank line or known block start.
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (current.trim() === "" || isBlockStart(current)) break;
      para.push(current);
      i += 1;
    }
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", text: para.join(" ") });
    }
  }

  return blocks;
}

function renderHeading(level: 1 | 2 | 3 | 4 | 5 | 6, html: string) {
  const className = cn(
    "mt-5 mb-2 font-semibold tracking-tight",
    level === 1 && "text-2xl",
    level === 2 && "text-xl",
    level === 3 && "text-lg",
    level >= 4 && "text-base",
  );
  switch (level) {
    case 1:
      return <h1 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    case 2:
      return <h2 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    case 3:
      return <h3 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    case 4:
      return <h4 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    case 5:
      return <h5 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    default:
      return <h6 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
}

function renderTable(headers: string[], rows: string[][]) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {headers.map((cell, idx) => (
              <th
                key={idx}
                className="border-border border-b px-3 py-2 text-left font-medium"
                dangerouslySetInnerHTML={{ __html: applyInline(cell) }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-border/60 border-t">
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="px-3 py-2 align-top"
                  dangerouslySetInnerHTML={{ __html: applyInline(cell) }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  if (!source || source.trim() === "") {
    return null;
  }

  const blocks = parseBlocks(source);

  return (
    <div
      className={cn(
        "text-foreground/90 text-sm leading-relaxed [&_a]:break-words",
        className,
      )}
    >
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "heading":
            return (
              <Fragment key={idx}>
                {renderHeading(block.level, applyInline(block.text))}
              </Fragment>
            );
          case "paragraph":
            return (
              <p
                key={idx}
                className="my-2.5 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: applyInline(block.text) }}
              />
            );
          case "ul":
            return (
              <ul key={idx} className="my-2.5 space-y-1.5 pl-6">
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className="list-disc pl-1 marker:text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: applyInline(item) }}
                  />
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="my-2.5 space-y-1.5 pl-6">
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className="list-decimal pl-1 marker:text-muted-foreground marker:font-medium"
                    dangerouslySetInnerHTML={{ __html: applyInline(item) }}
                  />
                ))}
              </ol>
            );
          case "code":
            return (
              <div
                key={idx}
                className="my-3 overflow-x-auto rounded-lg border border-border bg-zinc-950/[0.03] dark:bg-zinc-50/[0.03]"
              >
                {block.lang && (
                  <div className="text-muted-foreground border-border border-b px-3 py-1 text-[10px] font-medium tracking-wider uppercase">
                    {block.lang}
                  </div>
                )}
                <pre className="m-0 p-3 font-mono text-xs leading-relaxed">
                  <code>{block.text}</code>
                </pre>
              </div>
            );
          case "quote":
            return (
              <blockquote
                key={idx}
                className="text-muted-foreground my-3 border-l-2 border-primary/40 pl-3 italic"
                dangerouslySetInnerHTML={{ __html: applyInline(block.text) }}
              />
            );
          case "hr":
            return <hr key={idx} className="border-border my-4" />;
          case "table":
            return <Fragment key={idx}>{renderTable(block.headers, block.rows)}</Fragment>;
        }
      })}
    </div>
  );
}
