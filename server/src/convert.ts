// The converter's routes (rodeo.build/convert and rodeo.build/viewer): the index and each pair's page,
// the file viewers' index and each viewer page, the sitemap, and the redirects that keep one address
// per page. The converter itself runs in the visitor's browser (web/src/convert), so these routes read
// no file and fetch nothing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { convertPage, viewerPage, type ConvertPage } from "../../web/src/convert/pages.ts";
import { config } from "./config.ts";
import { renderConvertPage, sitemapXml } from "./convertPage.ts";

/** The converter page's template, kept after the first read; a build that lacks it is asked again next time. */
let template: string | null = null;

async function loadTemplate(): Promise<string | null> {
  if (template === null) {
    template = await readFile(join(config.webDist, "convert.html"), "utf8").catch(() => null);
  }
  return template;
}

/** Sends a page as HTML that browsers may not frame from other sites; `fallback` is where a missing page goes. */
async function servePage(c: Context, page: ConvertPage | null, fallback: string): Promise<Response> {
  if (!page) return c.redirect(fallback, 301);
  const html = await loadTemplate();
  if (html === null) {
    c.header("Cache-Control", "no-store");
    return c.text("The converter page is not built on this server (web/dist/convert.html is missing).", 404);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Content-Security-Policy", "frame-ancestors 'self'");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  return c.body(renderConvertPage(html, page, config.publicUrl));
}

/**
 * The routes of one section of the site: its index at `base`, and each page under it. A lower-case
 * address is the page's own; an upper-case one, or one with a trailing slash, is redirected to it, and
 * an address no page has is redirected to the index.
 */
function addPageRoutes(app: Hono, base: "/convert" | "/viewer", lookup: (slug: string | null) => ConvertPage | null): void {
  const canonical = (slug: string): string => (lookup(slug.toLowerCase()) ? `${base}/${slug.toLowerCase()}` : base);
  app.get(base, (c) => servePage(c, lookup(null), base));
  app.get(`${base}/`, (c) => c.redirect(base, 301));
  app.get(`${base}/:slug/`, (c) => c.redirect(canonical(c.req.param("slug")), 301));
  app.get(`${base}/:slug`, (c) => {
    const slug = c.req.param("slug");
    const target = canonical(slug);
    if (target !== `${base}/${slug}`) return c.redirect(target, 301);
    return servePage(c, lookup(slug), base);
  });
}

/** Adds the converter's and the viewer's routes. They go before the editor's catch-all (registerStatic), so they answer first. */
export function registerConvert(app: Hono): void {
  app.get("/sitemap-convert.xml", (c) => {
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(sitemapXml(config.publicUrl));
  });
  app.get("/convert.html", (c) => c.redirect("/convert", 301));
  addPageRoutes(app, "/convert", convertPage);
  addPageRoutes(app, "/viewer", viewerPage);
}
