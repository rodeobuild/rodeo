// The user guide's markdown renderer (docs/guide, served on the site at /guide). It turns one page into
// HTML with no dependencies, and covers what the guide uses: ATX headings with GitHub's anchor ids,
// paragraphs, bold, italic, inline code, fenced code blocks, ordered and unordered lists (nested too),
// GFM tables, block quotes, rules, links and the <kbd> tag. Every other piece of HTML is escaped and
// shown as text, so a page can't add markup or script. Links to the guide's own .md files become the
// site's /guide addresses.

/** A heading of a page: its level, its text as plain words, and the id its anchor link uses. */
export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

/** A rendered page: its HTML, its headings in order, and its first paragraph as plain text. */
export interface RenderedMarkdown {
  readonly html: string;
  readonly headings: readonly Heading[];
  readonly firstParagraph: string;
}

/** Where a page is rendered: its own address, which its #anchor links point to. */
export interface RenderOptions {
  readonly pagePath: string;
}

/** Inline content: text, code, an HTML entity kept as it is, a span with children, or a line break. */
type Inline =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "entity"; readonly html: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "em" | "strong" | "kbd"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly Inline[] }
  | { readonly kind: "break" };

/** What the block and inline renderers share: the page's address, its anchor ids and its headings. */
interface Ctx {
  readonly pagePath: string;
  readonly ids: Set<string>;
  readonly headings: Heading[];
  /** how deep in lists and quotes the block being rendered is; the first paragraph is at depth 0 */
  depth: number;
  firstParagraph: string | null;
}

/** A list item's opening line: its indent, its kind, its number, and the column its content starts at. */
interface ListMarker {
  readonly indent: number;
  readonly ordered: boolean;
  readonly delim: string;
  readonly start: number;
  readonly contentCol: number;
  readonly first: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML: & < > " ' become entities, so the text is shown as written. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** GitHub's anchor for a heading's text: lower case, punctuation dropped (hyphens and underscores kept), spaces as hyphens. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, "").replace(/ /g, "-");
}

/**
 * Where a link goes on the site. The guide's .md pages become /guide addresses (README.md is /guide),
 * a bare #anchor stays on the page, other relative links are kept, and only http, https and mailto
 * addresses are let through: any other scheme (javascript: and the like) becomes "#".
 */
export function linkTarget(href: string, pagePath: string): string {
  const h = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return /^(https?|mailto):/i.test(h) ? h : "#";
  if (h.startsWith("#")) return `${pagePath}${h}`;
  const hash = h.indexOf("#");
  const file = hash < 0 ? h : h.slice(0, hash);
  const frag = hash < 0 ? "" : h.slice(hash);
  const m = /^(?:\.\/)?([^/]+)\.md$/i.exec(file);
  if (!m) return h;
  const stem = m[1].toLowerCase();
  return (stem === "readme" ? "/guide" : `/guide/${stem}`) + frag;
}

/** Renders one page's markdown. `options.pagePath` is the page's own address, such as /guide/files. */
export function renderMarkdown(source: string, options: RenderOptions): RenderedMarkdown {
  const ctx: Ctx = { pagePath: options.pagePath, ids: new Set(), headings: [], depth: 0, firstParagraph: null };
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const html = renderBlocks(lines, ctx, false);
  return { html, headings: ctx.headings, firstParagraph: ctx.firstParagraph ?? "" };
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const BULLET = /^( {0,3})([-*+])(?=[ \t]|$)([ \t]*)/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)([ \t]*)/;
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
/** ASCII punctuation, which a backslash makes literal */
const PUNCTUATION = /[!-\/:-@\[-`{-~]/;

/** How many of `ch` run on from `at`. */
function runLength(src: string, at: number, ch: string): number {
  let n = 0;
  while (src[at + n] === ch) n++;
  return n;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (line[n] === " ") n++;
  return n;
}

/** The list marker a line opens, if it opens one. */
function listMarker(line: string): ListMarker | null {
  const b = BULLET.exec(line);
  const o = b ? null : ORDERED.exec(line);
  const m = b ?? o;
  if (!m) return null;
  const indent = m[1].length;
  const markerText = o ? m[2] + m[3] : m[2];
  const spaces = (o ? m[4] : m[3]).length;
  // one space after the marker, or up to four; five or more start an indented block, so only one counts
  const pad = spaces === 0 || spaces >= 5 ? 1 : spaces;
  const contentCol = indent + markerText.length + pad;
  return {
    indent,
    ordered: o !== null,
    delim: o ? m[3] : m[2],
    start: o ? Number(m[2]) : 1,
    contentCol,
    first: line.slice(contentCol),
  };
}

/** Whether a line starts a block that ends a paragraph (a list item only when it has content, an ordered one only at 1). */
function interrupts(line: string): boolean {
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const m = listMarker(line);
  return m !== null && m.first.trim() !== "" && (!m.ordered || m.start === 1);
}

/** The anchor id for a heading: GitHub's slug, with -1, -2 and so on for repeats on the page. */
function uniqueId(ctx: Ctx, label: string): string {
  const base = slugify(label);
  let id = base;
  for (let n = 1; ctx.ids.has(id); n++) id = `${base}-${n}`;
  ctx.ids.add(id);
  return id;
}

/** Renders a run of block lines to HTML. `tight` (a tight list's items) leaves out the paragraph tags. */
function renderBlocks(lines: readonly string[], ctx: Ctx, tight: boolean): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
      const marker = fence[2];
      const indent = fence[1].length;
      const lang = fence[3].trim().split(/\s+/)[0];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const row = lines[i];
        i++;
        const close = CLOSE_FENCE.exec(row);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
        body.push(row.slice(Math.min(indent, leadingSpaces(row))) + "\n");
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join(""))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = (heading[2] ?? "").replace(/(^|[ \t]+)#+[ \t]*$/, "").trim();
      const nodes = parseInline(text);
      const label = plain(nodes).trim();
      const level = heading[1].length;
      const id = uniqueId(ctx, label);
      ctx.headings.push({ level, text: label, id });
      out.push(`<h${level} id="${escapeHtml(id)}">${inlineHtml(nodes, ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i++;
      }
      ctx.depth++;
      const inner = renderBlocks(body, ctx, false);
      ctx.depth--;
      out.push(`<blockquote>\n${inner}\n</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && DELIM.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const table = parseTable(lines, i, ctx);
      if (table) {
        out.push(table.html);
        i = table.end;
        continue;
      }
    }

    if (listMarker(line)) {
      const list = renderList(lines, i, ctx);
      out.push(list.html);
      i = list.end;
      continue;
    }

    // a paragraph runs to the next blank line or a block that interrupts it
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !interrupts(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    // two spaces or a backslash at a line's end make a line break inside the paragraph
    const text = para
      .map((raw, k) => {
        const t = raw.replace(/^ +/, "");
        if (k < para.length - 1 && / {2,}$/.test(t)) return t.replace(/ +$/, "") + "\\";
        return t.trimEnd();
      })
      .join("\n");
    const nodes = parseInline(text);
    if (ctx.depth === 0 && ctx.firstParagraph === null) ctx.firstParagraph = plain(nodes);
    const html = inlineHtml(nodes, ctx);
    out.push(tight ? html : `<p>${html}</p>`);
  }
  return out.join("\n");
}

/** A list from its first item to the last item of the same kind; `end` is the first line after it. */
function renderList(lines: readonly string[], start: number, ctx: Ctx): { html: string; end: number } {
  const first = listMarker(lines[start]) as ListMarker;
  const items: string[][] = [];
  let loose = false;
  let i = start;
  for (;;) {
    const mk = i < lines.length ? listMarker(lines[i]) : null;
    if (!mk || mk.ordered !== first.ordered || mk.delim !== first.delim) break;
    const body: string[] = [mk.first];
    const col = mk.contentCol;
    i++;
    let blank = false;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        blank = true;
        i++;
        continue;
      }
      if (leadingSpaces(l) >= col) {
        // indented to the item's content: it belongs to the item, and a blank line before it makes the list loose
        if (blank) {
          loose = true;
          body.push("");
        }
        body.push(l.slice(col));
        blank = false;
        i++;
        continue;
      }
      // a line that goes on a paragraph of the item without indent is part of the item (a lazy continuation)
      if (!blank && !interrupts(l) && listMarker(l) === null && body[body.length - 1].trim() !== "") {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push(body);
    if (blank) {
      const next = i < lines.length ? listMarker(lines[i]) : null;
      if (next && next.ordered === first.ordered && next.delim === first.delim) loose = true;
    }
  }
  const open = first.ordered ? (first.start === 1 ? "<ol>" : `<ol start="${first.start}">`) : "<ul>";
  const close = first.ordered ? "</ol>" : "</ul>";
  ctx.depth++;
  const lis = items.map((body) => `<li>${renderBlocks(body, ctx, !loose)}</li>`);
  ctx.depth--;
  return { html: `${open}\n${lis.join("\n")}\n${close}`, end: i };
}

/** Splits a table row into its cells; a \| inside a cell stays for the inline renderer. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && s[k + 1] === "|") {
      cur += "\\|";
      k++;
    } else if (s[k] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[k];
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** A GFM table starting at `start` (its header row, then its delimiter row), or null when the lines are not one. */
function parseTable(lines: readonly string[], start: number, ctx: Ctx): { html: string; end: number } | null {
  const head = splitRow(lines[start]);
  const delim = splitRow(lines[start + 1]);
  if (head.length !== delim.length) return null;
  const aligns = delim.map((d) => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  const rows: string[][] = [];
  let j = start + 2;
  while (j < lines.length && lines[j].trim() !== "" && !interrupts(lines[j])) {
    rows.push(splitRow(lines[j]));
    j++;
  }
  const cell = (tag: "th" | "td", text: string, k: number): string => {
    const align = aligns[k] ? ` style="text-align: ${aligns[k]}"` : "";
    const scope = tag === "th" ? ' scope="col"' : "";
    return `<${tag}${scope}${align}>${inlineHtml(parseInline(text), ctx)}</${tag}>`;
  };
  const thead = `<thead><tr>${head.map((t, k) => cell("th", t, k)).join("")}</tr></thead>`;
  const tbody =
    rows.length > 0
      ? `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k] ?? "", k)).join("")}</tr>`).join("")}</tbody>`
      : "";
  return { html: `<div class="table-wrap" tabindex="0"><table>${thead}${tbody}</table></div>`, end: j };
}

/** Reads inline markdown: emphasis, code, links, <kbd>, escapes and entities. */
function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = (): void => {
    if (text !== "") out.push({ kind: "text", value: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        flush();
        out.push({ kind: "break" });
        i += 2;
      } else if (next !== undefined && PUNCTUATION.test(next)) {
        text += next;
        i += 2;
      } else {
        text += c;
        i += 1;
      }
      continue;
    }

    if (c === "`") {
      const run = runLength(src, i, "`");
      const close = findRun(src, i + run, "`", run);
      if (close >= 0) {
        flush();
        out.push({ kind: "code", value: codeText(src.slice(i + run, close)) });
        i = close + run;
      } else {
        text += "`".repeat(run);
        i += run;
      }
      continue;
    }

    if (c === "<" && src.startsWith("<kbd>", i)) {
      const end = src.indexOf("</kbd>", i + 5);
      if (end >= 0) {
        flush();
        out.push({ kind: "kbd", children: parseInline(src.slice(i + 5, end)) });
        i = end + 6;
        continue;
      }
    }

    if (c === "&") {
      const m = ENTITY.exec(src.slice(i, i + 40));
      if (m) {
        flush();
        out.push({ kind: "entity", html: m[0] });
        i += m[0].length;
        continue;
      }
    }

    if (c === "[") {
      const link = parseLink(src, i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.end;
        continue;
      }
    }

    if (c === "*" || c === "_") {
      const span = emphasis(src, i);
      if (span) {
        flush();
        out.push(span.node);
        i = span.end;
        continue;
      }
      const run = runLength(src, i, c);
      text += c.repeat(run);
      i += run;
      continue;
    }

    text += c;
    i++;
  }
  flush();
  return out;
}

/** The index of a backtick run of exactly `len` at or after `from`, or -1. */
function findRun(src: string, from: number, ch: string, len: number): number {
  let j = from;
  while (j < src.length) {
    const k = src.indexOf(ch, j);
    if (k < 0) return -1;
    const run = runLength(src, k, ch);
    if (run === len) return k;
    j = k + run;
  }
  return -1;
}

/** A code span's text: line ends become spaces, and one space is taken off each end when both are there. */
function codeText(raw: string): string {
  const s = raw.replace(/\n/g, " ");
  return /^ .*[^ ].* $/.test(s) ? s.slice(1, -1) : s;
}

/** A link at `start` ([text](target)), or null when the brackets are not one. */
function parseLink(src: string, start: number): { node: Inline; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "[") depth++;
    else if (src[j] === "]") {
      depth--;
      if (depth === 0) {
        close = j;
        break;
      }
    }
  }
  if (close < 0 || src[close + 1] !== "(") return null;
  let k = close + 2;
  let open = 1;
  for (; k < src.length; k++) {
    if (src[k] === "\\") {
      k++;
      continue;
    }
    if (src[k] === "(") open++;
    else if (src[k] === ")") {
      open--;
      if (open === 0) break;
    }
  }
  if (k >= src.length) return null;
  const inner = src.slice(close + 2, k).trim();
  const m = /^(<[^>]*>|\S+)(?:\s+"[^"]*")?$/.exec(inner);
  if (!m) return null;
  const href = m[1].replace(/^<|>$/g, "");
  return { node: { kind: "link", href, children: parseInline(src.slice(start + 1, close)) }, end: k + 1 };
}

/** Emphasis at `i`: **strong** or *em* (or the underscore forms), or null when no closer follows. */
function emphasis(src: string, i: number): { node: Inline; end: number } | null {
  const ch = src[i];
  const run = runLength(src, i, ch);
  const before = src[i - 1] ?? " ";
  const after = src[i + run] ?? " ";
  if (/\s/.test(after)) return null;
  // an underscore inside a word is not emphasis (snake_case)
  if (ch === "_" && /[\p{L}\p{N}]/u.test(before)) return null;
  if (run >= 2) {
    const close = findCloser(src, i + 2, ch, 2);
    if (close > i + 2) return { node: { kind: "strong", children: parseInline(src.slice(i + 2, close)) }, end: close + 2 };
    return null;
  }
  const close = findCloser(src, i + 1, ch, 1);
  if (close > i + 1) return { node: { kind: "em", children: parseInline(src.slice(i + 1, close)) }, end: close + 1 };
  return null;
}

/** The index of a closing run of exactly `len` `ch` at or after `from` that can close (no space before it), or -1. */
function findCloser(src: string, from: number, ch: string, len: number): number {
  let j = from;
  while (j < src.length) {
    const k = src.indexOf(ch, j);
    if (k < 0) return -1;
    const run = runLength(src, k, ch);
    const prev = src[k - 1] ?? " ";
    const next = src[k + run] ?? " ";
    if (run === len && !/\s/.test(prev) && (ch !== "_" || !/[\p{L}\p{N}]/u.test(next))) return k;
    j = k + run;
  }
  return -1;
}

/** Inline nodes as HTML. */
function inlineHtml(nodes: readonly Inline[], ctx: Ctx): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return escapeHtml(n.value);
        case "entity":
          return n.html;
        case "code":
          return `<code>${escapeHtml(n.value)}</code>`;
        case "em":
        case "strong":
        case "kbd":
          return `<${n.kind}>${inlineHtml(n.children, ctx)}</${n.kind}>`;
        case "link": {
          const target = linkTarget(n.href, ctx.pagePath);
          const rel = /^https?:\/\//i.test(target) ? ' rel="noopener"' : "";
          return `<a href="${escapeHtml(target)}"${rel}>${inlineHtml(n.children, ctx)}</a>`;
        }
        case "break":
          return "<br />\n";
      }
    })
    .join("");
}

/** Inline nodes as plain text: the words a reader sees, without markup. */
function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
        case "code":
          return n.value;
        case "entity":
          return n.html;
        case "break":
          return " ";
        default:
          return plain(n.children);
      }
    })
    .join("");
}
