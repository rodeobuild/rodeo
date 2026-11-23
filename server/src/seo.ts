// Search engines and link previews for the whole site: the editor's head (title, description,
// canonical address, Open Graph, Twitter card and JSON-LD) for the pages no other feature answers,
// the sitemap index and the pages sitemap (the gallery's and the converter's and guide's sitemaps
// are served by their own files), robots.txt, llms.txt for language models, and IndexNow: the key
// file that proves the site is ours, and the pass that tells Bing, Yandex and Seznam about new or
// changed pages after a deploy. Every value written here is fixed text or the site's own address.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { env } from "./env.ts";
import { config } from "./config.ts";
import { escapeHtml, type PageExtras, registerPageHook } from "./page.ts";
import { robotsTxt } from "../../web/src/features/gallery/rules.ts";
import { VIEWER_PAGES, PAIRS } from "../../web/src/convert/pages.ts";
import { loadGuide } from "./guide.ts";

/** The title and description the editor's home page gets from the server. */
const TITLE = "Rodeo: free browser CAD that opens Vectorworks (VWX) files";
const DESCRIPTION =
  "Free CAD and 3D modelling in your browser. Open and edit Vectorworks (VWX) drawings, import DWG, Revit and IFC, and export to many formats. No install.";
const GITHUB = "https://github.com/rodeobuild/rodeo";
const NPM = "https://www.npmjs.com/package/@rodeo.build/cli";
const LICENCE = "https://www.gnu.org/licenses/agpl-3.0.html";
const FEATURES = [
  "Open and edit Vectorworks (VWX) drawings",
  "2D drawing and 3D modelling in the browser",
  "Import DWG, DXF and PDF drawings",
  "Import Revit, Archicad and IFC models",
  "Import SketchUp, Rhino, STEP and SolidWorks files",
  "Export to many CAD and mesh formats",
  "Render 3D views, including path tracing",
  "Cloud saving, share links and embeds",
  "A public gallery of published drawings",
  "AI agents that work on a drawing",
  "Command line tool and MCP server",
  "Free and open source under AGPL-3.0",
];
/** Pages that have their own head or sitemap: the editor's head is not added to them. */
const OWN_PATHS = /^\/(gallery|guide|convert|viewer|admin|api)(\/|$)/;
/** Address parameters that name a drawing, a file or a sign-in; those pages are not the home page. */
const OTHER_PARAMS = ["share", "embed", "invite", "url", "file", "convert"];

/** Text as JSON inside a script tag: < > & are written as escapes, so the script cannot end early. */
function jsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** The JSON-LD graph: the site, its organisation and the app. No ratings or reviews: there are none to show. */
function structuredData(publicUrl: string): Record<string, unknown> {
  const home = `${publicUrl}/`;
  const org = `${publicUrl}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${publicUrl}/#website`, name: "Rodeo", url: home, publisher: { "@id": org } },
      {
        "@type": "Organization",
        "@id": org,
        name: "Rodeo",
        url: home,
        logo: `${publicUrl}/icon-512.png`,
        sameAs: [GITHUB, NPM],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${publicUrl}/#app`,
        name: "Rodeo",
        url: home,
        description: DESCRIPTION,
        applicationCategory: "DesignApplication",
        operatingSystem: "Web browser, Windows, macOS, Linux",
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
        isAccessibleForFree: true,
        license: LICENCE,
        featureList: FEATURES,
        publisher: { "@id": org },
      },
    ],
  };
}

/** The editor's head for its home page: the canonical address is always the root, whatever path asked. */
export function editorHead(publicUrl: string): PageExtras {
  const home = `${publicUrl}/`;
  const image = `${publicUrl}/og/rodeo.png`;
  const lines = [
    `<meta name="description" content="${escapeHtml(DESCRIPTION)}">`,
    `<link rel="canonical" href="${escapeHtml(home)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Rodeo">`,
    `<meta property="og:title" content="${escapeHtml(TITLE)}">`,
    `<meta property="og:description" content="${escapeHtml(DESCRIPTION)}">`,
    `<meta property="og:url" content="${escapeHtml(home)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeHtml("Rodeo: CAD and 3D modelling in your browser, with the Vectorworks, DWG and Revit formats")}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(TITLE)}">`,
    `<meta name="twitter:description" content="${escapeHtml(DESCRIPTION)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    `<script type="application/ld+json">${jsonForScript(structuredData(publicUrl))}</script>`,
  ];
  return { title: TITLE, head: lines.join("\n"), shell: true };
}

/** The page hook: the editor's home head for the editor's own pages (not a share, embed, file, sign-in or the other sites' pages). */
export function homepageExtras(url: URL): PageExtras | null {
  if (OWN_PATHS.test(url.pathname)) return null;
  if (OTHER_PARAMS.some((name) => url.searchParams.has(name))) return null;
  return editorHead(config.publicUrl);
}

const XML_TYPE = "application/xml; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";
const HOUR_CACHE = "public, max-age=3600";

/** The sitemap index: the sitemaps the site lists. The guide's sitemap is served by the guide's own routes. */
export function sitemapIndexXml(publicUrl: string): string {
  const maps = ["/sitemap-pages.xml", "/sitemap-convert.xml", "/sitemap-guide.xml", "/sitemap-gallery.xml"];
  const items = maps.map((path) => `  <sitemap><loc>${escapeHtml(`${publicUrl}${path}`)}</loc></sitemap>`);
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...items, `</sitemapindex>`, ""].join("\n");
}

/** The sitemap of the site's own static pages. */
export function pagesSitemapXml(publicUrl: string): string {
  const urls = ["/", "/gallery"].map((path) => `  <url><loc>${escapeHtml(`${publicUrl}${path}`)}</loc></url>`);
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...urls, `</urlset>`, ""].join("\n");
}

/** A page llms.txt links to: its address on the site, its name and what it holds. */
export interface LlmsPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

/** The file viewers' pages, named without the site's suffix. */
function viewerLinks(): LlmsPage[] {
  return VIEWER_PAGES.map((v) => ({ path: `/viewer/${v.id}`, title: v.title.replace(/\s*\|\s*Rodeo$/, ""), description: v.description }));
}

/**
 * llms.txt (llmstxt.org): what Rodeo is and where its parts live, for language models that read the
 * site. `guide` lists the user guide's pages (the server reads them from docs/guide); the viewers come
 * from the converter's page data.
 */
export function llmsTxt(publicUrl: string, guide: readonly LlmsPage[] = []): string {
  const line = (p: LlmsPage): string => `- [${p.title}](${publicUrl}${p.path}): ${p.description}`;
  return [
    "# Rodeo",
    "",
    "> Rodeo is a free, open-source CAD and 3D modelling app that runs in the browser. It opens and edits Vectorworks (VWX) drawings natively, imports DWG, DXF, PDF, Revit, Archicad, IFC, SketchUp, Rhino, STEP and SolidWorks files, exports many formats, renders 3D views, and saves to the cloud. It is also a desktop app and works offline once loaded. Licensed under AGPL-3.0.",
    "",
    "## Docs",
    "",
    `- [User guide](${publicUrl}/guide): how to draw, model, import, export, share and embed drawings in Rodeo.`,
    ...guide.map(line),
    "",
    "## Tools",
    "",
    `- [File converter](${publicUrl}/convert): converts CAD and 3D files between formats in the browser, free. Each of its ${PAIRS.length} pairs has a page at ${publicUrl}/convert/<from>-to-<to>, for example ${publicUrl}/convert/dwg-to-pdf.`,
    `- [File viewers](${publicUrl}/viewer): open CAD and 3D files in the browser without the app that made them.`,
    ...viewerLinks().map(line),
    `- [Gallery](${publicUrl}/gallery): drawings that people have published for others to look at and open a copy of.`,
    "",
    "## Developers",
    "",
    `- [Command line tool](${NPM}): \`npx @rodeo.build/cli\`, for working with Rodeo drawings from a terminal.`,
    `- [MCP server](${publicUrl}/mcp): POST to ${publicUrl}/mcp to let an AI assistant read and edit drawings over the Model Context Protocol.`,
    `- [Source code](${GITHUB}): the whole app, under AGPL-3.0.`,
    "",
    "## Licence",
    "",
    `- [GNU Affero General Public Licence v3](${LICENCE}): the licence of the source code.`,
    "",
  ].join("\n");
}

// ---- IndexNow ---------------------------------------------------------------------------------

const KEY_FORMAT = /^[A-Za-z0-9-]{8,128}$/;
const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;
const START_DELAY_MS = 60_000;
const keyFile = (): string => join(config.dataDir, "indexnow-key.txt");
const sentFile = (): string => join(config.dataDir, "indexnow-sent.json");
let keyValue: string | null | undefined;

/**
 * The IndexNow key: INDEXNOW_KEY when set, else the one kept in DATA_DIR (made the first time).
 * Null when INDEXNOW_KEY is malformed, so no key file is served.
 */
export function indexNowKey(): string | null {
  if (keyValue !== undefined) return keyValue;
  const fromEnv = env("INDEXNOW_KEY");
  if (fromEnv !== undefined) {
    keyValue = KEY_FORMAT.test(fromEnv) ? fromEnv : null;
    if (keyValue === null) console.error("[indexnow] INDEXNOW_KEY must be 8 to 128 letters, digits or hyphens; no key file is served");
    return keyValue;
  }
  try {
    const saved = readFileSync(keyFile(), "utf8").trim();
    if (KEY_FORMAT.test(saved)) return (keyValue = saved);
  } catch {
    // no key kept yet: made below
  }
  const key = randomBytes(16).toString("hex");
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(keyFile(), `${key}\n`);
  return (keyValue = key);
}

/** Whether the pass runs: a production server on a public https address. Never in tests or development. */
export function indexNowOn(publicUrl: string, production: boolean): boolean {
  if (!production || !publicUrl.startsWith("https://")) return false;
  const host = new URL(publicUrl).hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && !host.endsWith(".localhost");
}

/** The <loc> values in a sitemap or sitemap index, with the XML's own escapes undone. */
function locsIn(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}

/** Each page in a sitemap with its lastmod ("" when it has none). */
function pagesIn(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = locsIn(block[1])[0];
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block[1])?.[1] ?? "";
    if (loc) out.set(loc, lastmod);
  }
  return out;
}

/**
 * One pass: reads the site's sitemaps over loopback (origin), finds the pages that are new or whose
 * lastmod changed since the last pass (sentFile), and posts them to the IndexNow endpoint. Returns
 * how many URLs were sent. Nothing is saved unless the endpoint accepts them, so a failed pass is
 * tried again next time.
 */
export async function indexNowPass(opts: {
  origin: string;
  publicUrl: string;
  key: string;
  endpoint: string;
  sentPath: string;
}): Promise<number> {
  const index = await fetch(`${opts.origin}/sitemap.xml`);
  if (!index.ok) throw new Error(`the sitemap index answered ${index.status}`);
  const current = new Map<string, string>();
  for (const loc of locsIn(await index.text())) {
    const path = new URL(loc).pathname;
    const res = await fetch(`${opts.origin}${path}`);
    if (!res.ok) continue; // a sitemap not served yet is skipped, not an error
    for (const [url, lastmod] of pagesIn(await res.text())) current.set(url, lastmod);
  }

  let sent: Record<string, string> = {};
  try {
    sent = JSON.parse(readFileSync(opts.sentPath, "utf8")) as Record<string, string>;
  } catch {
    // nothing sent yet
  }
  const fresh = [...current].filter(([url, lastmod]) => sent[url] !== lastmod).slice(0, MAX_URLS);
  if (fresh.length === 0) return 0;

  const body = {
    host: new URL(opts.publicUrl).host,
    key: opts.key,
    keyLocation: `${opts.publicUrl}/${opts.key}.txt`,
    urlList: fresh.map(([url]) => url),
  };
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`the IndexNow endpoint answered ${res.status}`);
  for (const [url, lastmod] of fresh) sent[url] = lastmod;
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(opts.sentPath, JSON.stringify(sent));
  return fresh.length;
}

/**
 * Starts the pass a minute after a production start, over loopback to this server's own sitemaps.
 * Off unless indexNowOn: the server never calls the endpoint from tests or development.
 */
export function startIndexNow(port: number): void {
  const key = indexNowKey();
  if (!key || !indexNowOn(config.publicUrl, config.production)) return;
  const endpoint = env("INDEXNOW_ENDPOINT") ?? DEFAULT_ENDPOINT;
  const timer = setTimeout(() => {
    indexNowPass({ origin: `http://127.0.0.1:${port}`, publicUrl: config.publicUrl, key, endpoint, sentPath: sentFile() })
      .then((n) => {
        if (n > 0) console.log(`[indexnow] sent ${n} urls`);
      })
      .catch((e: unknown) => console.error(`[indexnow] could not send: ${e instanceof Error ? e.message : String(e)}`));
  }, START_DELAY_MS);
  timer.unref();
}

/** Adds the site's head hook and its routes. Register after the share and embed routes, so their previews answer first. */
export function registerSeo(app: Hono): void {
  registerPageHook(homepageExtras);

  app.get("/sitemap.xml", (c) => {
    c.header("Content-Type", XML_TYPE);
    c.header("Cache-Control", HOUR_CACHE);
    return c.body(sitemapIndexXml(config.publicUrl));
  });
  app.get("/sitemap-pages.xml", (c) => {
    c.header("Content-Type", XML_TYPE);
    c.header("Cache-Control", HOUR_CACHE);
    return c.body(pagesSitemapXml(config.publicUrl));
  });
  app.get("/robots.txt", (c) => {
    c.header("Content-Type", TEXT_TYPE);
    c.header("Cache-Control", HOUR_CACHE);
    return c.body(robotsTxt(config.publicUrl));
  });
  app.get("/llms.txt", async (c) => {
    c.header("Content-Type", TEXT_TYPE);
    c.header("Cache-Control", HOUR_CACHE);
    const guide = await loadGuide();
    const pages = guide ? [...guide.docs.values()].filter((d) => d.slug !== "readme").map((d) => ({ path: d.path, title: d.h1, description: d.description })) : [];
    return c.body(llmsTxt(config.publicUrl, pages));
  });

  const key = indexNowKey();
  if (key) {
    // the key file: the search engine reads it to check the site is the one that sent the list
    app.get(`/${key}.txt`, (c) => {
      c.header("Cache-Control", HOUR_CACHE);
      return c.text(key);
    });
  }
}
