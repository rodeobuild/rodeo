// The user guide's pages on the site (rodeo.build/guide). Each page of docs/guide is rendered once, when
// first asked for, into the guide's template (web/guide.html) with its title, description, canonical
// address, navigation, table of contents, previous and next links and structured data filled in. The
// sitemap lists them all. The pages are plain HTML, so search engines read them without running the editor.

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { env } from "./env.ts";
import { escapeHtml, type Heading, renderMarkdown } from "./markdown.ts";

/** The guide's index page: README.md, under this key (its lower-case name without .md). */
const INDEX = "readme";
const GUIDE_NAME = "Rodeo user guide";
const INDEX_TITLE = "Rodeo user guide: draw, model and render in your browser";
const EDIT_BASE = "https://github.com/rodeobuild/rodeo/blob/main/docs/guide/";
/** the longest meta description, in characters; longer ones are cut at a word */
const DESCRIPTION_MAX = 155;

/** One page of the guide, rendered. */
export interface GuideDoc {
  /** the lower-case name without .md (the index is "readme") */
  readonly slug: string;
  /** the file's name in the repository, as the edit link names it */
  readonly file: string;
  /** the address on the site: /guide, or /guide/<slug> */
  readonly path: string;
  /** the page's h1, as plain text */
  readonly h1: string;
  /** the <title>: the h1 and the guide's name, or the index's own title */
  readonly title: string;
  readonly description: string;
  /** the rendered article */
  readonly html: string;
  readonly headings: readonly Heading[];
}

/** One group of the sidebar: its title and the pages in it, as slugs. */
export interface NavSection {
  readonly title: string;
  readonly items: readonly { readonly slug: string; readonly label: string }[];
}

/** The whole guide: every page by slug, the sidebar's groups, and the pages in reading order. */
export interface Guide {
  readonly docs: ReadonlyMap<string, GuideDoc>;
  readonly sections: readonly NavSection[];
  /** the slugs of the pages in the sidebar's order (the index is not one of them) */
  readonly order: readonly string[];
}

/**
 * Builds the guide from its markdown files (name to source). The index is README.md; the sidebar's groups
 * and their pages come from README.md's "## " headings and the links under them. Throws if there is no README.md.
 */
export function buildGuide(sources: ReadonlyMap<string, string>): Guide {
  const docs = new Map<string, GuideDoc>();
  for (const [file, source] of sources) {
    if (!/\.md$/i.test(file)) continue;
    const stem = file.replace(/\.md$/i, "").toLowerCase();
    const slug = stem === "readme" ? INDEX : stem;
    const path = slug === INDEX ? "/guide" : `/guide/${slug}`;
    const r = renderMarkdown(source, { pagePath: path });
    const h1 = r.headings.find((h) => h.level === 1)?.text ?? stem;
    const title = slug === INDEX ? INDEX_TITLE : `${h1} | ${GUIDE_NAME}`;
    docs.set(slug, {
      slug,
      file,
      path,
      h1,
      title,
      description: describe(r.firstParagraph || h1),
      html: r.html,
      headings: r.headings,
    });
  }
  const readme = sources.get(findKey(sources, "README.md"));
  if (!docs.has(INDEX) || readme === undefined) throw new Error("the guide has no README.md");

  const sections: NavSection[] = [];
  let current: { title: string; items: { slug: string; label: string }[] } | null = null;
  for (const line of readme.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const link = /^- \[([^\]]+)\]\(([^)#\s]+)\.md(?:#[^)]*)?\)/.exec(line);
    if (link && current) {
      const slug = link[2].toLowerCase();
      if (docs.has(slug)) current.items.push({ slug, label: link[1] });
    }
  }
  const kept = sections.filter((s) => s.items.length > 0);
  const order = kept.flatMap((s) => s.items.map((i) => i.slug));
  return { docs, sections: kept, order };
}

/** The key of a file in a map of file names, matched without regard to case. */
function findKey(sources: ReadonlyMap<string, string>, name: string): string {
  for (const key of sources.keys()) if (key.toLowerCase() === name.toLowerCase()) return key;
  return name;
}

/** A meta description: the text with its spaces made single, cut at a word to DESCRIPTION_MAX characters. */
export function describe(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= DESCRIPTION_MAX) return t;
  const cut = t.slice(0, DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  const at = space > 100 ? space : DESCRIPTION_MAX;
  return `${cut.slice(0, at).replace(/[\s,;:–-]+$/, "")}…`;
}

/** Fills what lies between a template's `<!-- name -->` and `<!-- /name -->` markers, keeping the markers. */
function fillBlock(html: string, name: string, inner: string): string {
  const open = `<!-- ${name} -->`;
  const close = `<!-- /${name} -->`;
  const start = html.indexOf(open);
  const end = start < 0 ? -1 : html.indexOf(close, start + open.length);
  if (end < 0) return html;
  return html.slice(0, start + open.length) + inner + html.slice(end);
}

/** JSON for a script block: < > and & become escapes, so the text can't end the script early. */
function scriptJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** The page's head: title, description, canonical address, Open Graph, Twitter card and JSON-LD. */
function headBlock(doc: GuideDoc, publicUrl: string): string {
  const url = `${publicUrl}${doc.path}`;
  const guideUrl = `${publicUrl}/guide`;
  const isIndex = doc.slug === INDEX;
  const trail: [string, string][] = [
    ["Rodeo", `${publicUrl}/`],
    [GUIDE_NAME, guideUrl],
  ];
  if (!isIndex) trail.push([doc.h1, url]);
  const crumbs = trail.map(([name, item], k) => ({ "@type": "ListItem", position: k + 1, name, item }));
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: doc.h1,
        description: doc.description,
        url,
        inLanguage: "en",
        isPartOf: { "@type": "CreativeWork", name: GUIDE_NAME, url: guideUrl },
        publisher: { "@type": "Organization", name: "Rodeo", url: publicUrl },
      },
      { "@type": "BreadcrumbList", itemListElement: crumbs },
    ],
  };
  return [
    `<title>${escapeHtml(doc.title)}</title>`,
    `<meta name="description" content="${escapeHtml(doc.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${isIndex ? "website" : "article"}" />`,
    `<meta property="og:site_name" content="Rodeo" />`,
    `<meta property="og:title" content="${escapeHtml(doc.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(doc.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(`${publicUrl}/og/rodeo.png`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${scriptJson(graph)}</script>`,
  ].join("\n    ");
}

/** The sidebar's list of every page, with the current page marked. Shown as a menu on a phone and as a column on a wide screen. */
function navBlock(guide: Guide, current: GuideDoc | null): string {
  const link = (slug: string, label: string): string => {
    const here = current?.slug === slug;
    const href = slug === INDEX ? "/guide" : `/guide/${slug}`;
    return `<li><a href="${escapeHtml(href)}"${here ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a></li>`;
  };
  const home = link(INDEX, "Guide home");
  const groups = guide.sections
    .map(
      (s) =>
        `<p class="g-nav-title">${escapeHtml(s.title)}</p><ul>${s.items
          .map((i) => link(i.slug, i.label))
          .join("")}</ul>`,
    )
    .join("");
  const list = `<ul class="g-nav-home">${home}</ul>${groups}`;
  return (
    `<details class="g-menu"><summary>All guide pages</summary><nav aria-label="Guide pages">${list}</nav></details>` +
    `<nav class="g-side" aria-label="Guide pages">${list}</nav>`
  );
}

/** The "On this page" list of a page's sections (its h2s); empty when it has none. */
function tocBlock(doc: GuideDoc): string {
  const sections = doc.headings.filter((h) => h.level === 2);
  if (sections.length === 0) return "";
  const items = sections
    .map((h) => `<li><a href="${escapeHtml(`${doc.path}#${h.id}`)}">${escapeHtml(h.text)}</a></li>`)
    .join("");
  return `<aside class="g-toc" aria-labelledby="g-toc-title"><p class="g-toc-title" id="g-toc-title">On this page</p><ul>${items}</ul></aside>`;
}

/** The previous and next pages in the sidebar's order. The index comes before the first page. */
function pagerBlock(guide: Guide, doc: GuideDoc): string {
  const labelOf = (slug: string): string => guide.sections.flatMap((s) => s.items).find((i) => i.slug === slug)?.label ?? slug;
  const pathOf = (slug: string): string => (slug === INDEX ? "/guide" : `/guide/${slug}`);
  let prev: { href: string; label: string } | null = null;
  let next: { href: string; label: string } | null = null;
  if (doc.slug === INDEX) {
    if (guide.order.length > 0) next = { href: pathOf(guide.order[0]), label: labelOf(guide.order[0]) };
  } else {
    const at = guide.order.indexOf(doc.slug);
    if (at === 0) prev = { href: "/guide", label: "Guide home" };
    else if (at > 0) prev = { href: pathOf(guide.order[at - 1]), label: labelOf(guide.order[at - 1]) };
    if (at >= 0 && at < guide.order.length - 1) next = { href: pathOf(guide.order[at + 1]), label: labelOf(guide.order[at + 1]) };
  }
  if (!prev && !next) return "";
  const a = (cls: string, label: string, to: { href: string; label: string }): string =>
    `<a class="${cls}" href="${escapeHtml(to.href)}"><span>${label}</span>${escapeHtml(to.label)}</a>`;
  return (
    `<nav class="g-pager" aria-label="Previous and next pages">` +
    (prev ? a("g-pager-prev", "Previous", prev) : "") +
    (next ? a("g-pager-next", "Next", next) : "") +
    `</nav>`
  );
}

/** The foot: the edit link for the page, and the licence and trademark line. */
function footBlock(doc: GuideDoc | null): string {
  const edit = doc
    ? `<p>Found a mistake or something missing? <a href="${escapeHtml(EDIT_BASE + doc.file)}">Edit this page on GitHub</a>.</p>`
    : "";
  return (
    edit +
    `<p>Rodeo is free and open source under the AGPL-3.0 licence. Vectorworks is a trademark of Vectorworks, Inc., ` +
    `and the other products named in this guide are trademarks of their owners. Rodeo is not affiliated with any of them.</p>`
  );
}

/** A guide page as HTML: the template (web/guide.html) with the page's blocks filled in. */
export function renderGuidePage(template: string, guide: Guide, doc: GuideDoc, publicUrl: string): string {
  let html = fillBlock(template, "guide:head", headBlock(doc, publicUrl));
  html = fillBlock(html, "guide:nav", navBlock(guide, doc));
  html = fillBlock(html, "guide:body", `<article class="g-article">${doc.html}</article>`);
  html = fillBlock(html, "guide:pager", pagerBlock(guide, doc));
  html = fillBlock(html, "guide:toc", tocBlock(doc));
  html = fillBlock(html, "guide:foot", footBlock(doc));
  return html;
}

/** The page for an address the guide has no page at: the same frame, the sidebar, and a note. */
function renderMissingPage(template: string, guide: Guide): string {
  const head = [
    `<title>Page not found | ${GUIDE_NAME}</title>`,
    `<meta name="description" content="The guide has no page at this address. Pick one from the list." />`,
    `<meta name="robots" content="noindex" />`,
  ].join("\n    ");
  const body = `<article class="g-article"><h1>This page is not in the guide</h1><p>Pick a page from the list, or start at the <a href="/guide">guide home</a>.</p></article>`;
  let html = fillBlock(template, "guide:head", head);
  html = fillBlock(html, "guide:nav", navBlock(guide, null));
  html = fillBlock(html, "guide:body", body);
  html = fillBlock(html, "guide:pager", "");
  html = fillBlock(html, "guide:toc", "");
  html = fillBlock(html, "guide:foot", footBlock(null));
  return html;
}

/** The sitemap: the index and every page, in the sidebar's order. Lastmod is left out, since a git checkout's file times say nothing about when a page changed. */
export function guideSitemapXml(guide: Guide, publicUrl: string): string {
  const slugs = [INDEX, ...guide.order, ...[...guide.docs.keys()].filter((s) => s !== INDEX && !guide.order.includes(s))];
  const urls = slugs.map((s) => `  <url><loc>${escapeHtml(`${publicUrl}${guide.docs.get(s)?.path ?? "/guide"}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The folder of the guide's markdown: GUIDE_DIR, or docs/guide in the repository (the Docker image copies it there). */
export function guideDir(): string {
  return resolve(env("GUIDE_DIR") ?? join(import.meta.dirname, "../../docs/guide"));
}

/** The guide, read and rendered on first use, then kept in memory; null when the folder has no guide. */
let loaded: Guide | null = null;

export async function loadGuide(): Promise<Guide | null> {
  if (loaded) return loaded;
  const dir = guideDir();
  try {
    const sources = new Map<string, string>();
    for (const name of await readdir(dir)) {
      if (/\.md$/i.test(name)) sources.set(name, await readFile(join(dir, name), "utf8"));
    }
    loaded = buildGuide(sources);
    return loaded;
  } catch (err) {
    console.error(`[guide] could not read the guide in ${dir}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** The guide's template, kept after the first read; a build that lacks it is asked again next time. */
let template: string | null = null;

async function loadTemplate(): Promise<string | null> {
  if (template === null) {
    template = await readFile(join(config.webDist, "guide.html"), "utf8").catch(() => null);
  }
  return template;
}

/** Sends a guide page as HTML that browsers may not frame from other sites. */
async function servePage(c: Context, guide: Guide, doc: GuideDoc | null): Promise<Response> {
  const html = await loadTemplate();
  if (html === null) {
    c.header("Cache-Control", "no-store");
    return c.text("The guide page is not built on this server (web/dist/guide.html is missing).", 404);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", doc ? "public, max-age=300" : "no-store");
  c.header("Content-Security-Policy", "frame-ancestors 'self'");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  // the service worker keeps the editor's shell from a navigation's answer; a guide page is not the shell
  c.header("X-Openvwx-Page", "guide");
  if (doc) return c.body(renderGuidePage(html, guide, doc, config.publicUrl));
  c.status(404);
  return c.body(renderMissingPage(html, guide));
}

/** Adds the guide's routes. They go before the editor's catch-all (registerStatic), so they answer first. */
export function registerGuide(app: Hono): void {
  app.get("/sitemap-guide.xml", async (c) => {
    const guide = await loadGuide();
    if (!guide) return c.text("The guide is not in this build (docs/guide is missing).", 404);
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(guideSitemapXml(guide, config.publicUrl));
  });
  app.get("/guide.html", (c) => c.redirect("/guide", 301));
  app.get("/guide/", (c) => c.redirect("/guide", 301));
  app.get("/guide", async (c) => {
    const guide = await loadGuide();
    if (!guide) return c.text("The guide is not in this build (docs/guide is missing).", 404);
    return servePage(c, guide, guide.docs.get(INDEX) ?? null);
  });
  app.get("/guide/:slug/", (c) => c.redirect(`/guide/${c.req.param("slug")}`, 301));
  app.get("/guide/:slug", async (c) => {
    const guide = await loadGuide();
    if (!guide) return c.text("The guide is not in this build (docs/guide is missing).", 404);
    const raw = c.req.param("slug");
    const stem = raw.replace(/\.md$/i, "").toLowerCase();
    const doc = guide.docs.get(stem === "readme" ? INDEX : stem) ?? null;
    if (!doc) return servePage(c, guide, null);
    // one address per page: .md names, upper-case names and the index's own name go to the canonical one
    if (doc.slug === INDEX) return c.redirect("/guide", 301);
    if (`/guide/${raw}` !== doc.path) return c.redirect(doc.path, 301);
    return servePage(c, guide, doc);
  });
}
