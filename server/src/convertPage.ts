// The converter's pages as the server sends them (rodeo.build/convert and /viewer): the page template
// (web/convert.html) with each page's title, description, canonical address, breadcrumbs, text, links,
// questions and formats filled in, and the sitemap. Only fixed text from web/src/convert/pages.ts goes
// in, and every value is HTML-escaped, so the server never reads or fetches a user's file here.

import { PAGE_FORMATS, PAIRS, VIEWER_PAGES, pairSlug, type ConvertPage, type PageSection } from "../../web/src/convert/pages.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** The public address of the Open Graph picture for the converter pages (made by the design work, 1200 by 630). */
const SHARE_IMAGE = "/og/convert.png";

/** Escapes text for HTML, attribute values and XML: & < > " ' become entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * Replaces what lies between a template's `<!-- name -->` and `<!-- /name -->` markers, keeping the
 * markers. A pair that is missing leaves the template as it is.
 */
function fillBlock(html: string, name: string, inner: string): string {
  const open = `<!-- ${name} -->`;
  const close = `<!-- /${name} -->`;
  const start = html.indexOf(open);
  const end = start < 0 ? -1 : html.indexOf(close, start + open.length);
  if (end < 0) return html;
  return html.slice(0, start + open.length) + inner + html.slice(end);
}

/** An answer as HTML: text, with `code` spans as code. */
function answerHtml(text: string): string {
  return text
    .split("`")
    .map((part, i) => (i % 2 ? `<code class="cv-cli">${escapeHtml(part)}</code>` : escapeHtml(part)))
    .join("");
}

/** The page's head: its title, description, canonical address, Open Graph, Twitter card and one JSON-LD graph. */
function headBlock(page: ConvertPage, publicUrl: string): string {
  const url = `${publicUrl}${page.path}`;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebApplication",
      name: "Rodeo converter",
      url,
      description: page.description,
      applicationCategory: "DesignApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: page.crumbs.map((crumb, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: crumb.name,
        item: `${publicUrl}${crumb.path}`,
      })),
    },
  ];
  if (page.faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: page.faq.map((qa) => ({
        "@type": "Question",
        name: qa.q,
        acceptedAnswer: { "@type": "Answer", text: qa.a.replace(/`/g, "") },
      })),
    });
  }
  // a script block ends at its first "</script" text, so the JSON writes <, > and & as escapes
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const image = `${publicUrl}${SHARE_IMAGE}`;
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Rodeo" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join("\n    ");
}

/** The breadcrumb trail (visible, as the JSON-LD says), the headline and the lede. */
function introBlock(page: ConvertPage): string {
  const last = page.crumbs.length - 1;
  const items = page.crumbs
    .map((crumb, i) =>
      i === last
        ? `<li aria-current="page">${escapeHtml(crumb.name)}</li>`
        : `<li><a href="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</a></li>`,
    )
    .join("");
  const trail = `<nav class="cv-crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
  return `${trail}<h1>${escapeHtml(page.h1)}</h1><p class="cv-lede">${escapeHtml(page.intro)}</p>`;
}

/** One titled part of the text: its paragraphs, its numbered steps or its bullets. */
function sectionHtml(section: PageSection): string {
  const paragraphs = (section.paragraphs ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const steps = section.steps?.length
    ? `<ol class="cv-steps">${section.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
    : "";
  const items = section.items?.length
    ? `<ul class="cv-list">${section.items.map((s) => `<li>${answerHtml(s)}</li>`).join("")}</ul>`
    : "";
  return `<section class="cv-section cv-about"><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${steps}${items}</section>`;
}

/** The text under the intro: the page's sections, then the related pages, when it has any. */
function aboutBlock(page: ConvertPage): string {
  const parts = page.sections.map(sectionHtml);
  if (page.see.length) {
    const items = page.see.map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a></li>`).join("");
    parts.push(`<section class="cv-section cv-about"><h2>Related</h2><ul class="cv-list">${items}</ul></section>`);
  }
  return parts.join("");
}

/** The links to other pages, under their heading. A page with none says where to find conversions. */
function linksBlock(page: ConvertPage): string {
  const heading = `<h2 id="cv-links-h">${escapeHtml(page.linksTitle)}</h2>`;
  if (page.links.length === 0) {
    return `${heading}<p class="cv-note">Pick a format in Convert to above, or see <a href="/convert">every conversion</a>.</p>`;
  }
  const items = page.links.map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a></li>`);
  return `${heading}<ul class="cv-links">${items.join("")}</ul>`;
}

/** The questions and answers, each in a closed disclosure. */
function faqBlock(page: ConvertPage): string {
  return page.faq
    .map((qa) => `<details><summary>${escapeHtml(qa.q)}</summary><p>${answerHtml(qa.a)}</p></details>`)
    .join("\n        ");
}

/** The table of every format the pages name, with whether Rodeo reads and writes it. */
function formatsBlock(): string {
  const rows = PAGE_FORMATS.map((f) => {
    const files = f.extensions.map((ext) => `.${escapeHtml(ext)}`).join(" ");
    return `<tr><th scope="row">${escapeHtml(f.long)}</th><td>${files}</td><td>${f.read ? "Yes" : "—"}</td><td>${f.write ? "Yes" : "—"}</td></tr>`;
  });
  return (
    `<div class="cv-table-wrap"><table class="cv-table"><thead><tr><th scope="col">Format</th><th scope="col">Files</th><th scope="col">Reads</th><th scope="col">Writes</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

/**
 * The converter page for `page`: `template` (web/convert.html) with its head, intro, text, links,
 * questions and formats filled in. `publicUrl` is the server's public address without a trailing slash.
 */
export function renderConvertPage(template: string, page: ConvertPage, publicUrl: string): string {
  let html = fillBlock(template, "convert:head", headBlock(page, publicUrl));
  html = fillBlock(html, "convert:intro", introBlock(page));
  html = fillBlock(html, "convert:about", aboutBlock(page));
  html = fillBlock(html, "convert:links", linksBlock(page));
  html = fillBlock(html, "convert:faq", faqBlock(page));
  html = fillBlock(html, "convert:formats", formatsBlock());
  return html;
}

/** The sitemap: the converter's index and every pair's page, then the viewer's index and every viewer page. */
export function sitemapXml(publicUrl: string): string {
  const paths = [
    "/convert",
    ...PAIRS.map(([from, to]) => `/convert/${pairSlug(from, to)}`),
    "/viewer",
    ...VIEWER_PAGES.map((v) => `/viewer/${v.id}`),
  ];
  const urls = paths.map((path) => `  <url><loc>${escapeHtml(`${publicUrl}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
