// Unit checks for the guide's markdown renderer (src/markdown.ts): node scripts/markdown-test.ts
// Each check renders a small piece of markdown and looks at the HTML it gives, the anchor ids and the
// plain first paragraph. The whole guide is checked by scripts/guide-test.ts.

import assert from "node:assert/strict";
import { escapeHtml, linkTarget, renderMarkdown, slugify } from "../src/markdown.ts";

const PAGE = "/guide/files";
let failures = 0;

/** Runs one check, printing ok or FAIL with the reason. */
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Renders markdown on the files page. */
function html(source: string): string {
  return renderMarkdown(source, { pagePath: PAGE }).html;
}

check("text is escaped: a script tag and an event attribute are shown, not run", () => {
  const out = html("A <script>alert(1)</script> and <img src=x onerror=alert(1)>.");
  assert.ok(!out.includes("<script"), out);
  assert.ok(!out.includes("<img"), out);
  assert.ok(out.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), out);
  assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"), out);
});

check("escapeHtml turns & < > \" ' into entities", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

check("a link's javascript: target becomes #, and an http link gets rel=noopener", () => {
  const out = html("[bad](javascript:alert(1)) and [good](https://rodeo.build/gallery)");
  assert.ok(out.includes('<a href="#">bad</a>'), out);
  assert.ok(out.includes('<a href="https://rodeo.build/gallery" rel="noopener">good</a>'), out);
});

check("kbd is kept, and its text is escaped", () => {
  const out = html("Press <kbd>⇧⌘J</kbd> or <kbd>\\`</kbd>, not <b>this</b>.");
  assert.ok(out.includes("Press <kbd>⇧⌘J</kbd>"), out);
  assert.ok(out.includes("<kbd>`</kbd>"), out);
  assert.ok(out.includes("not &lt;b&gt;this&lt;/b&gt;"), out);
});

check("inline code and fenced code are escaped, with a language class", () => {
  const out = html("Use `<kbd>` here.\n\n```ts\nconst a = \"<x>\";\n```");
  assert.ok(out.includes("<code>&lt;kbd&gt;</code>"), out);
  assert.ok(out.includes('<pre><code class="language-ts">const a = &quot;&lt;x&gt;&quot;;\n</code></pre>'), out);
});

check("headings get GitHub's anchor ids, and repeats get -1, -2", () => {
  const r = renderMarkdown(
    "# Files: opening, saving and tabs\n\n## Sharing and embedding\n\n## Editing a class's attributes\n\n## Notes\n\n## Notes\n\n## Notes",
    { pagePath: PAGE },
  );
  assert.deepEqual(
    r.headings.map((h) => [h.level, h.id]),
    [
      [1, "files-opening-saving-and-tabs"],
      [2, "sharing-and-embedding"],
      [2, "editing-a-classs-attributes"],
      [2, "notes"],
      [2, "notes-1"],
      [2, "notes-2"],
    ],
  );
  assert.ok(r.html.includes('<h2 id="sharing-and-embedding">Sharing and embedding</h2>'));
});

check("slugify matches GitHub for punctuation, symbols and bold text", () => {
  assert.equal(slugify("Save a Copy As… and Save All"), "save-a-copy-as-and-save-all");
  assert.equal(slugify("GD&T and welding symbols"), "gdt-and-welding-symbols");
  assert.equal(slugify("Open, Save and Open Recent"), "open-save-and-open-recent");
  assert.equal(slugify("Import_data-now"), "import_data-now");
  assert.equal(renderMarkdown("## **Bold** `code`", { pagePath: PAGE }).headings[0].id, "bold-code");
});

check("links rewrite .md files to /guide addresses, keeping anchors", () => {
  assert.equal(linkTarget("files.md", PAGE), "/guide/files");
  assert.equal(linkTarget("files.md#sharing-and-embedding", PAGE), "/guide/files#sharing-and-embedding");
  assert.equal(linkTarget("./workspace.md#the-agents-panel", PAGE), "/guide/workspace#the-agents-panel");
  assert.equal(linkTarget("README.md", PAGE), "/guide");
  assert.equal(linkTarget("README.md#x", PAGE), "/guide#x");
  assert.equal(linkTarget("#editing", PAGE), "/guide/files#editing");
  assert.equal(linkTarget("mailto:cal@rodeo.build", PAGE), "mailto:cal@rodeo.build");
  const out = html("See [the files page](files.md#open-save-and-open-recent) and [the top](#top).");
  assert.ok(out.includes('<a href="/guide/files#open-save-and-open-recent">the files page</a>'), out);
  assert.ok(out.includes('<a href="/guide/files#top">the top</a>'), out);
});

check("tables: header, alignment, bold and kbd in cells, and an escaped pipe", () => {
  const out = html(
    "| Docks | Drawing area |\n| :--- | ---: |\n| As it starts | **1108** × 844 px |\n| <kbd>⌘</kbd> | a \\| b |",
  );
  assert.ok(out.includes('<div class="table-wrap" tabindex="0"><table>'), out);
  assert.ok(out.includes('<th scope="col" style="text-align: left">Docks</th>'), out);
  assert.ok(out.includes('<th scope="col" style="text-align: right">Drawing area</th>'), out);
  assert.ok(out.includes('<td style="text-align: right"><strong>1108</strong> × 844 px</td>'), out);
  assert.ok(out.includes("<kbd>⌘</kbd>"), out);
  assert.ok(out.includes("a | b"), out);
});

check("nested lists: ordered items with bullets inside them, two levels", () => {
  const out = html("1. First step:\n   - one\n   - two\n2. Second step\n\n- top\n  - child\n    - grandchild");
  assert.ok(out.includes("<ol>\n<li>First step:\n<ul>\n<li>one</li>\n<li>two</li>\n</ul></li>\n<li>Second step</li>\n</ol>"), out);
  assert.ok(out.includes("<li>top\n<ul>\n<li>child\n<ul>\n<li>grandchild</li>"), out);
});

check("a list with blank lines between items is loose (paragraphs), a tight one is not", () => {
  const tight = html("- a\n- b");
  assert.ok(tight.includes("<li>a</li>") && !tight.includes("<p>"), tight);
  const loose = html("- a\n\n- b");
  assert.ok(loose.includes("<li><p>a</p></li>"), loose);
});

check("a lazy line continues the item's paragraph", () => {
  const out = html("- a long item\ncontinued here\n- next");
  assert.ok(out.includes("<li>a long item\ncontinued here</li>"), out);
});

check("blockquotes and rules", () => {
  const out = html("> Note: **careful**.\n\n---\n\ntext");
  assert.ok(out.includes("<blockquote>\n<p>Note: <strong>careful</strong>.</p>\n</blockquote>"), out);
  assert.ok(out.includes("<hr />"), out);
});

check("emphasis: bold, italic, and an underscore inside a word is left alone", () => {
  const out = html("**File › Import › Import DXF…** and *italic* and _under_ and snake_case_name and 2 * 3.");
  assert.ok(out.includes("<strong>File › Import › Import DXF…</strong>"), out);
  assert.ok(out.includes("<em>italic</em>"), out);
  assert.ok(out.includes("<em>under</em>"), out);
  assert.ok(out.includes("snake_case_name"), out);
  assert.ok(out.includes("2 * 3"), out);
});

check("backslash escapes give the character, not markup", () => {
  assert.equal(html("\\*not italic\\*"), "<p>*not italic*</p>");
});

check("entities pass through, and a bare & is escaped", () => {
  assert.equal(html("a &amp; b and GD&T"), "<p>a &amp; b and GD&amp;T</p>");
});

check("the first paragraph is plain text, and not one inside a list", () => {
  const r = renderMarkdown("# Title\n\nSee [the **files** page](files.md) and `x`.\n\n- a list item\n\nLater.", { pagePath: PAGE });
  assert.equal(r.firstParagraph, "See the files page and x.");
});

check("a page with no first paragraph has an empty one", () => {
  assert.equal(renderMarkdown("# Only a heading", { pagePath: PAGE }).firstParagraph, "");
});

check("a hard line break from two trailing spaces", () => {
  assert.equal(html("first  \nsecond"), "<p>first<br />\nsecond</p>");
});

console.log(failures === 0 ? "markdown tests passed" : `${failures} markdown test(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
