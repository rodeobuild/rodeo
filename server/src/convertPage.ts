// The converter's pages as the server sends them (rodeo.build/convert and /viewer, and the same pages
// in the other languages at /de/convert and so on): the page template (web/convert.html) with each
// page's language, title, description, canonical address, the addresses of its other languages,
// breadcrumbs, text, links, questions and formats filled in, and the sitemap. Only fixed text from
// web/src/convert/pages.ts and its languages' words goes in, and every value is HTML-escaped, so the
// server never reads or fetches a user's file here.

import {
  ENGLISH,
  PAGE_FORMATS,
  PAIRS,
  VIEWER_PAGES,
  pairSlug,
  sayIn,
  type ConvertPage,
  type PageLanguage,
  type PageSection,
  type Say,
} from "../../web/src/convert/pages.ts";

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

/** Open Graph's name for a language's locale (language_TERRITORY). */
const OG_LOCALES: Record<string, string> = {
  en: "en_GB",
  id: "id_ID",
  de: "de_DE",
  es: "es_ES",
  fr: "fr_FR",
  it: "it_IT",
  nl: "nl_NL",
  pl: "pl_PL",
  "pt-BR": "pt_BR",
  vi: "vi_VN",
  tr: "tr_TR",
  ru: "ru_RU",
  uk: "uk_UA",
  ja: "ja_JP",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
  ko: "ko_KR",
};

/**
 * The hreflang values each language's page is offered for: its own tag, and for the only Portuguese and
 * the two Chinese the language at large (Portuguese outside Brazil; Simplified and Traditional script).
 */
const HREFLANGS: Record<string, readonly string[]> = {
  "pt-BR": ["pt-BR", "pt"],
  "zh-CN": ["zh-CN", "zh-Hans"],
  "zh-TW": ["zh-TW", "zh-Hant"],
};

/** The hreflang values of a language's page. */
export function hreflangsOf(code: string): readonly string[] {
  return HREFLANGS[code] ?? [code];
}

/** The page's links to itself in every language served, English also as the x-default: the same list on each. */
function alternatesBlock(page: ConvertPage, publicUrl: string, languages: readonly PageLanguage[]): string[] {
  const links = languages.flatMap((lang) =>
    hreflangsOf(lang.code).map(
      (tag) => `<link rel="alternate" hreflang="${escapeHtml(tag)}" href="${escapeHtml(`${publicUrl}${lang.prefix}${page.basePath}`)}" />`,
    ),
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${publicUrl}${page.basePath}`)}" />`);
  return links;
}

/** The page's head: its title, description, canonical address, its other languages, Open Graph, Twitter card and one JSON-LD graph. */
function headBlock(page: ConvertPage, publicUrl: string, languages: readonly PageLanguage[]): string {
  const url = `${publicUrl}${page.path}`;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebApplication",
      name: "Rodeo converter",
      url,
      inLanguage: page.lang,
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
    ...(languages.length > 1 ? alternatesBlock(page, publicUrl, languages) : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="${escapeHtml(OG_LOCALES[page.lang] ?? "en_GB")}" />`,
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

/**
 * The attribute that tells the editor's translator (web/src/app/i18n.ts) to leave a block alone: the
 * server writes each page's text in its language, so an English page stays English for a visitor in
 * another language (the converter and the header follow theirs, and the header links to their page),
 * rather than being patched word by word.
 */
const KEEP = "data-i18n-keep";

/** The breadcrumb trail (visible, as the JSON-LD says), the headline and the lede. */
function introBlock(page: ConvertPage, say: Say): string {
  const last = page.crumbs.length - 1;
  const items = page.crumbs
    .map((crumb, i) =>
      i === last
        ? `<li aria-current="page">${escapeHtml(crumb.name)}</li>`
        : `<li><a href="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</a></li>`,
    )
    .join("");
  const trail = `<nav class="cv-crumbs" aria-label="${escapeHtml(say("Breadcrumb"))}"><ol>${items}</ol></nav>`;
  return `<div class="cv-intro" ${KEEP}>${trail}<h1>${escapeHtml(page.h1)}</h1><p class="cv-lede">${escapeHtml(page.intro)}</p></div>`;
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
  return `<section class="cv-section cv-about" ${KEEP}><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${steps}${items}</section>`;
}

/** The text under the intro: the page's sections, then the related pages, when it has any. */
function aboutBlock(page: ConvertPage, say: Say): string {
  const parts = page.sections.map(sectionHtml);
  if (page.see.length) {
    const items = page.see.map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a></li>`).join("");
    parts.push(`<section class="cv-section cv-about" ${KEEP}><h2>${escapeHtml(say("Related"))}</h2><ul class="cv-list">${items}</ul></section>`);
  }
  return parts.join("");
}

/** The links to other pages, under their heading. A page with none says where to find conversions. */
function linksBlock(page: ConvertPage, say: Say, lang: PageLanguage): string {
  const heading = `<h2 id="cv-links-h">${escapeHtml(page.linksTitle)}</h2>`;
  if (page.links.length === 0) {
    const all = `<a href="${escapeHtml(`${lang.prefix}/convert`)}">${escapeHtml(say("every conversion"))}</a>`;
    return `<div ${KEEP}>${heading}<p class="cv-note">${escapeHtml(say("Pick a format in Convert to above, or see {0}.")).replace("{0}", all)}</p></div>`;
  }
  const items = page.links.map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a></li>`);
  return `<div ${KEEP}>${heading}<ul class="cv-links">${items.join("")}</ul></div>`;
}

/** The questions and answers under their heading, each in a closed disclosure. */
function faqBlock(page: ConvertPage, say: Say): string {
  const items = page.faq.map((qa) => `<details><summary>${escapeHtml(qa.q)}</summary><p>${answerHtml(qa.a)}</p></details>`);
  return [`<div ${KEEP}>`, `<h2>${escapeHtml(say("Questions"))}</h2>`, ...items, "</div>"].join("\n        ");
}

/** The table of every format the pages name, with whether Rodeo reads and writes it, under its heading. */
function formatsBlock(say: Say): string {
  const yes = escapeHtml(say("Table › Yes"));
  const rows = PAGE_FORMATS.map((f) => {
    const files = f.extensions.map((ext) => `.${escapeHtml(ext)}`).join(" ");
    return `<tr><th scope="row">${escapeHtml(say(f.long))}</th><td>${files}</td><td>${f.read ? yes : "—"}</td><td>${f.write ? yes : "—"}</td></tr>`;
  });
  const head = ["Table › Format", "Table › Files", "Table › Reads", "Table › Writes"].map((key) => `<th scope="col">${escapeHtml(say(key))}</th>`);
  return (
    `<div ${KEEP}><h2>${escapeHtml(say("What Rodeo reads and writes"))}</h2>` +
    `<div class="cv-table-wrap"><table class="cv-table"><thead><tr>${head.join("")}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div></div>`
  );
}

/** The header's links: the brand and the editor. */
function topBlock(say: Say): string {
  return (
    `<a class="cv-brand" href="/"><img src="/icon.svg" alt="" width="24" height="24" />Rodeo</a>` +
    `<a class="cv-top-link" href="/">${escapeHtml(say("Open the editor"))}</a>`
  );
}

/** What shows without JavaScript. */
function noscriptBlock(say: Say): string {
  return `<p class="cv-note">${escapeHtml(say("The converter needs JavaScript: it runs in your browser so your files stay on your computer."))}</p>`;
}

/** The footer: the command line, the source, the trademarks, and the page in each language served. */
function footBlock(page: ConvertPage, say: Say, languages: readonly PageLanguage[]): string {
  const cli = `<code class="cv-cli">npx @rodeo.build/cli convert model.rvt model.ifc</code>`;
  const source = `<a href="https://github.com/rodeobuild/rodeo">github.com/rodeobuild/rodeo</a>`;
  const parts = [
    `<p>${escapeHtml(say("On the command line: {0}")).replace("{0}", cli)}</p>`,
    `<p>${escapeHtml(say("Rodeo is free and open source (AGPL-3.0): {0}.")).replace("{0}", source)}</p>`,
    `<p class="cv-note">${escapeHtml(
      say(
        "Revit and AutoCAD are trademarks of Autodesk, Inc.; SketchUp of Trimble Inc.; Rhino of Robert McNeel & Associates; Archicad of Graphisoft SE; Vectorworks of Vectorworks, Inc. Rodeo is not affiliated with any of them.",
      ),
    )}</p>`,
  ];
  if (languages.length > 1) {
    const items = languages.map((lang) => {
      const name = escapeHtml(lang.name);
      const tag = escapeHtml(lang.code);
      if (lang.code === page.lang) return `<li><span aria-current="page" lang="${tag}">${name}</span></li>`;
      return `<li><a href="${escapeHtml(`${lang.prefix}${page.basePath}`)}" hreflang="${tag}" lang="${tag}">${name}</a></li>`;
    });
    parts.push(`<nav class="cv-langs" aria-label="${escapeHtml(say("This page in other languages"))}"><ul>${items.join("")}</ul></nav>`);
  }
  return [`<div ${KEEP}>`, ...parts, "</div>"].join("\n        ");
}

/**
 * The converter page for `page`: `template` (web/convert.html) with its language, head, intro, text,
 * links, questions, formats and footer filled in. `publicUrl` is the server's public address without a
 * trailing slash; `lang` is the page's language and `languages` every language the pages are served in
 * (English first), for the links between them.
 */
export function renderConvertPage(
  template: string,
  page: ConvertPage,
  publicUrl: string,
  lang: PageLanguage = ENGLISH,
  languages: readonly PageLanguage[] = [ENGLISH],
): string {
  const say = sayIn(lang);
  // English pages leave the converter in the visitor's language; another language's page keeps its own
  let html = lang.code === "en" ? template : template.replace(/<html lang="en">/, `<html lang="${escapeHtml(lang.code)}" data-page-lang="${escapeHtml(lang.code)}">`);
  html = fillBlock(html, "convert:head", headBlock(page, publicUrl, languages));
  html = fillBlock(html, "convert:top", topBlock(say));
  html = fillBlock(html, "convert:intro", introBlock(page, say));
  html = fillBlock(html, "convert:noscript", noscriptBlock(say));
  html = fillBlock(html, "convert:about", aboutBlock(page, say));
  html = fillBlock(html, "convert:links", linksBlock(page, say, lang));
  html = fillBlock(html, "convert:faq", faqBlock(page, say));
  html = fillBlock(html, "convert:formats", formatsBlock(say));
  html = fillBlock(html, "convert:foot", footBlock(page, say, languages));
  return html;
}

/** Every page's address in English: the converter's index and every pair, then the viewer's index and every viewer. */
export function basePaths(): string[] {
  return ["/convert", ...PAIRS.map(([from, to]) => `/convert/${pairSlug(from, to)}`), "/viewer", ...VIEWER_PAGES.map((v) => `/viewer/${v.id}`)];
}

/** The sitemap: every page in English, then in each other language served, in the same order. */
export function sitemapXml(publicUrl: string, languages: readonly PageLanguage[] = [ENGLISH]): string {
  const paths = languages.flatMap((lang) => basePaths().map((path) => `${lang.prefix}${path}`));
  const urls = paths.map((path) => `  <url><loc>${escapeHtml(`${publicUrl}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
