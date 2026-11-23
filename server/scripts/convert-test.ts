// Tests for the converter's and the viewer's pages (src/convertPage.ts and src/convert.ts): node scripts/convert-test.ts
// The unit part renders the page template (web/convert.html) for every page and checks the HTML, the
// JSON-LD, the words and the sitemap. With --server, a real server on a loopback port checks the routes;
// its web/dist holds a copy of the page.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatById, formatOfName, outputFormat } from "../../web/src/convert/formats.ts";
import {
  convertPage,
  type ConvertPage,
  PAGE_FORMATS,
  PAIRS,
  pageFormat,
  pairSlug,
  VIEWER_PAGES,
  viewerPage,
} from "../../web/src/convert/pages.ts";
import { escapeHtml, renderConvertPage, sitemapXml } from "../src/convertPage.ts";

const PAGE_PATH = join(import.meta.dirname, "../../web/convert.html");
const template = readFileSync(PAGE_PATH, "utf8");
const BASE_URL = "http://x.test";
const MIN_WORDS = 250;

let failures = 0;

/** Runs one check, printing ok or FAIL with the reason. */
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The text between a page's `<!-- name -->` and `<!-- /name -->` markers. */
function blockOf(html: string, name: string): string {
  const open = `<!-- ${name} -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(`<!-- /${name} -->`, start);
  assert.ok(start >= 0 && end > start, `the ${name} markers`);
  return html.slice(start + open.length, end);
}

/** A page that must exist: the test fails with the address when it doesn't. */
function must(page: ConvertPage | null, what: string): ConvertPage {
  assert.ok(page, `${what} exists`);
  return page;
}

/** Every page the site has: the converter's index, each pair, the viewer's index, each viewer. */
function allPages(): ConvertPage[] {
  const out: ConvertPage[] = [must(convertPage(null), "the converter index"), must(viewerPage(null), "the viewer index")];
  for (const [a, b] of PAIRS) out.push(must(convertPage(pairSlug(a, b)), `${a}-to-${b}`));
  for (const v of VIEWER_PAGES) out.push(must(viewerPage(v.id), `viewer ${v.id}`));
  return out;
}

/** Whether a link's address is one of the site's pages. */
function pageExists(path: string): boolean {
  const pair = /^\/convert\/([a-z0-9]+)-to-([a-z0-9]+)$/.exec(path);
  if (pair) return convertPage(pairSlug(pair[1], pair[2])) !== null;
  if (path === "/convert" || path === "/viewer") return true;
  const viewer = /^\/viewer\/([a-z0-9]+)$/.exec(path);
  return viewer ? viewerPage(viewer[1]) !== null : false;
}

/** The part of a page between `<main` and `</main>`. */
function mainPart(html: string): string {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>");
  assert.ok(start >= 0 && end > start, "a main element");
  return html.slice(start, end);
}

/** Reverses the entities escapeHtml writes. */
function decode(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** The visible text of an HTML fragment: scripts and tags removed, entities decoded, spaces kept between tags. */
function visibleText(fragment: string): string {
  const blocks = fragment
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(code|a|em|strong|span|b|i)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return decode(blocks).replace(/\s+/g, " ").trim();
}

/** The number of words a page shows in main. */
function wordCount(html: string): number {
  return visibleText(mainPart(html)).split(" ").filter(Boolean).length;
}

/** The questions and answers the page shows, in order, as their visible text. */
function visibleFaq(html: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const re = /<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ q: visibleText(m[1]), a: visibleText(m[2]) });
  return out;
}

/** The JSON-LD graph of a page, as its parsed items. */
function graphOf(html: string): Record<string, unknown>[] {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "a JSON-LD block");
  assert.equal(html.split('type="application/ld+json"').length - 1, 1, "one JSON-LD block");
  const data = JSON.parse(m[1]) as { "@context": string; "@graph": Record<string, unknown>[] };
  assert.equal(data["@context"], "https://schema.org");
  return data["@graph"];
}

/** Checks one rendered page: its head, its JSON-LD, its FAQ against the visible questions, and its words. */
function checkRendered(page: ConvertPage, html: string): void {
  const url = `${BASE_URL}${page.path}`;
  assert.equal(html.split("<title>").length - 1, 1, "one title");
  assert.ok(html.includes(`<title>${escapeHtml(page.title)}</title>`), "the page's title");
  assert.ok(html.includes(`<h1>${escapeHtml(page.h1)}</h1>`), "the page's h1");
  assert.ok(html.includes(`<link rel="canonical" href="${escapeHtml(url)}" />`), "the canonical address");

  // no meta tag is repeated: each name or property appears once in the page
  const metas = [...html.matchAll(/<meta ([^>]*)>/g)].map((m) => /(?:name|property)="([^"]+)"/.exec(m[1])?.[1]).filter(Boolean);
  const seen = new Set<string>();
  for (const key of metas) {
    assert.ok(!seen.has(key!), `meta ${key} is not repeated`);
    seen.add(key!);
  }

  const graph = graphOf(html);
  const web = graph.find((g) => g["@type"] === "WebApplication") as { url: string; description: string } | undefined;
  assert.ok(web, "a WebApplication");
  assert.equal(web.url, url);
  assert.equal(web.description, page.description);

  const crumbs = graph.find((g) => g["@type"] === "BreadcrumbList") as
    | { itemListElement: { position: number; name: string; item: string }[] }
    | undefined;
  assert.ok(crumbs, "a BreadcrumbList");
  assert.ok(crumbs.itemListElement.length >= 2, "at least two crumbs");
  assert.equal(crumbs.itemListElement.at(-1)?.item, url, "the last crumb is this page");
  crumbs.itemListElement.forEach((c, i) => assert.equal(c.position, i + 1, "crumbs are numbered from 1"));

  const faq = graph.find((g) => g["@type"] === "FAQPage") as
    | { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    | undefined;
  const shown = visibleFaq(html);
  assert.equal(shown.length, page.faq.length, "the FAQ shows every question");
  if (page.faq.length) {
    assert.ok(faq, "a FAQPage");
    assert.deepEqual(
      faq.mainEntity.map((q) => q.name),
      shown.map((q) => q.q),
      "the FAQPage questions are the visible summaries",
    );
    assert.deepEqual(
      faq.mainEntity.map((q) => visibleText(q.acceptedAnswer.text)),
      shown.map((q) => q.a),
      "the FAQPage answers are the visible answers",
    );
  } else {
    assert.equal(faq, undefined, "no FAQPage without questions");
  }

  assert.ok(html.includes(`<meta property="og:image" content="${BASE_URL}/og/convert.png" />`), "the share picture");
  assert.ok(html.includes('<meta property="og:image:width" content="1200" />'), "the picture width");
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'), "the large Twitter card");

  const words = wordCount(html);
  assert.ok(words >= MIN_WORDS, `at least ${MIN_WORDS} visible words (it has ${words})`);
}

async function unitPart(): Promise<void> {
  const index = must(convertPage(null), "the index");
  const rvt = must(convertPage("rvt-to-ifc"), "rvt-to-ifc");
  const vwx = must(viewerPage("vwx"), "the vwx viewer");

  await check("the index page has its title and canonical address, and one title", () => {
    const html = renderConvertPage(template, index, BASE_URL);
    assert.ok(html.includes("<title>Convert CAD files online, free and private | Rodeo</title>"));
    assert.ok(html.includes('<link rel="canonical" href="http://x.test/convert" />'));
    assert.equal(html.split("<title>").length - 1, 1, "one title");
  });

  await check("rvt-to-ifc has its headline, eight links to other pairs, and none to itself", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    assert.ok(html.includes("<h1>Convert RVT to IFC</h1>"));
    const links = blockOf(html, "convert:links");
    assert.ok(links.includes('href="/convert/rvt-to-pdf"'), "a link to rvt-to-pdf");
    assert.ok(!links.includes('href="/convert/rvt-to-ifc"'), "no link to itself");
    assert.equal(links.split("<li>").length - 1, 8, "eight links");
    assert.ok(html.includes('href="/viewer/rvt"'), "a link to the Revit viewer");
  });

  await check("the formats table has a row per format", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    const rows = blockOf(html, "convert:formats").split('<tr><th scope="row">').length - 1;
    assert.equal(rows, PAGE_FORMATS.length);
  });

  await check("the index links to every pair", () => {
    const html = renderConvertPage(template, index, BASE_URL);
    assert.equal(blockOf(html, "convert:links").split("<li>").length - 1, PAIRS.length);
  });

  await check("the viewer's pages are in the rendered page with their own headline", () => {
    const html = renderConvertPage(template, vwx, BASE_URL);
    assert.ok(html.includes("<h1>Open Vectorworks (.vwx) files online</h1>"));
    assert.ok(html.includes('<link rel="canonical" href="http://x.test/viewer/vwx" />'));
    assert.ok(html.includes("<h2>What you see</h2>"), "the What you see section");
    assert.ok(html.includes("<h2>What you can do with it</h2>"), "the What you can do section");
    assert.ok(html.includes("Do I need Vectorworks to open it?"), "the vwx app question");
  });

  await check("every page renders with its own head, one FAQ matching its questions, and at least 250 words", () => {
    for (const page of allPages()) {
      const html = renderConvertPage(template, page, BASE_URL);
      try {
        checkRendered(page, html);
      } catch (err) {
        throw new Error(`${page.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  await check("every page has a unique title and a unique description", () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const page of allPages()) {
      assert.ok(!titles.has(page.title), `${page.path} repeats the title of ${titles.get(page.title)}`);
      assert.ok(!descriptions.has(page.description), `${page.path} repeats a description`);
      titles.set(page.title, page.path);
      descriptions.set(page.description, page.path);
    }
  });

  await check("titles are at most 65 characters, and descriptions are 120 to 185", () => {
    for (const page of allPages()) {
      assert.ok(page.title.length <= 65, `${page.path} title is ${page.title.length} characters`);
      assert.ok(page.description.length >= 120 && page.description.length <= 185, `${page.path} description is ${page.description.length} characters`);
    }
  });

  await check("every link on every page goes to a page that exists", () => {
    for (const page of allPages()) {
      for (const link of [...page.links, ...page.see]) assert.ok(pageExists(link.path), `${page.path} links to ${link.path}`);
      for (const crumb of page.crumbs) assert.ok(pageExists(crumb.path) || crumb.path === "/", `${page.path} crumb ${crumb.path}`);
    }
  });

  await check("every pair is readable into a writable format, and has a page", () => {
    for (const [from, to] of PAIRS) {
      assert.ok(pageFormat(from)?.read, `${from} is read`);
      assert.ok(pageFormat(to)?.write, `${to} is written`);
      assert.ok(convertPage(pairSlug(from, to)), `${from}-to-${to} has a page`);
    }
  });

  await check("viewer pages exist for formats that are read, and skip the generic PDF and EMF", () => {
    for (const v of VIEWER_PAGES) {
      assert.ok(pageFormat(v.id)?.read, `${v.id} is read`);
    }
    const ids = VIEWER_PAGES.map((v) => v.id);
    assert.ok(!ids.includes("pdf") && !ids.includes("emf"), "no PDF or EMF viewer");
    for (const f of PAGE_FORMATS.filter((p) => p.read && !["pdf", "emf"].includes(p.id))) {
      assert.ok(ids.includes(f.id), `${f.id} has a viewer page`);
    }
  });

  await check("the formats in PAGE_FORMATS agree with formats.ts on reading, writing and kind", () => {
    for (const f of PAGE_FORMATS) {
      if (f.id === "png") continue; // the page makes PNG itself, so formats.ts has no entry for it
      const readAs = formatOfName(`x.${f.extensions[0]}`);
      assert.equal(readAs !== null, f.read, `${f.id} read flag`);
      const writeAs = outputFormat(f.extensions[0]);
      assert.equal(writeAs !== null, f.write, `${f.id} write flag`);
      if (readAs) assert.equal(formatById(readAs)?.kind, f.kind, `${f.id} kind`);
    }
  });

  await check("the index and the viewer index have every page in the sitemap, with no duplicate addresses", () => {
    const xml = sitemapXml(BASE_URL);
    for (const page of allPages()) {
      assert.ok(xml.includes(`<loc>${BASE_URL}${page.path}</loc>`), `sitemap has ${page.path}`);
    }
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, "no repeated address");
    assert.equal(locs.length, allPages().length, "the sitemap has only the pages");
  });

  await check("text is escaped and cannot break out of the head's script", () => {
    const html = renderConvertPage(template, { ...rvt, h1: "A <b>&", description: "x</script><b>" }, BASE_URL);
    assert.ok(html.includes("<h1>A &lt;b&gt;&amp;</h1>") || html.includes("A &lt;b&gt;&amp;"), "the headline is escaped");
    assert.ok(!html.includes("</script><b>"), "no script break-out");
    assert.equal(escapeHtml(`"'`), "&quot;&#39;");
  });

  await check("a fake template gets the escaped text, and a missing marker pair leaves the template alone", () => {
    const fake = "<p><!-- convert:intro --><!-- /convert:intro --></p>";
    const out = renderConvertPage(fake, { ...rvt, h1: "<i>" }, BASE_URL);
    assert.ok(out.includes("<h1>&lt;i&gt;</h1>"));
    assert.ok(out.startsWith("<p><!-- convert:intro -->") && out.endsWith("<!-- /convert:intro --></p>"), "markers kept");
    assert.equal(renderConvertPage("<b>no markers</b>", rvt, BASE_URL), "<b>no markers</b>");
  });

  await check("the JSON-LD graph parses, names the page, and its breadcrumbs match the trail", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    const web = graphOf(html).find((g) => g["@type"] === "WebApplication") as { url: string; offers: { price: string } };
    assert.equal(web.url, "http://x.test/convert/rvt-to-ifc");
    assert.equal(web.offers.price, "0");
    assert.ok(html.includes('<li aria-current="page">RVT to IFC</li>'), "the visible trail ends with the page");
  });

  await check("slugs: upper case, unknown and index are handled", () => {
    assert.equal(convertPage("RVT-to-IFC"), null);
    assert.equal(convertPage("nope"), null);
    assert.equal(convertPage("nope-to-x"), null);
    assert.equal(viewerPage("VWX"), null);
    assert.equal(viewerPage("nope"), null);
    assert.equal(convertPage(null)?.path, "/convert");
    assert.equal(viewerPage(null)?.path, "/viewer");
  });

  await check("the sitemap lists the index and every pair", () => {
    const xml = sitemapXml(BASE_URL);
    assert.ok(xml.includes("<loc>http://x.test/convert/rvt-to-ifc</loc>"));
    assert.ok(xml.includes("<loc>http://x.test/convert</loc>"));
    assert.equal(xml.split("<loc>").length - 1, PAIRS.length + 1 + 1 + VIEWER_PAGES.length);
  });
}

/** One response from the server: its status, redirect target, type, frame policy and body. */
interface Reply {
  status: number;
  location: string | null;
  type: string;
  csp: string;
  body: string;
}

async function serverPart(): Promise<void> {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const base = `http://localhost:${port}`;
  const root = mkdtempSync(join(tmpdir(), "rodeo-convert-"));
  const webDist = join(root, "dist");
  mkdirSync(webDist);
  copyFileSync(PAGE_PATH, join(webDist, "convert.html"));
  let log = "";

  const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), DATA_DIR: root, PUBLIC_URL: base, WEB_DIST: webDist },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

  /** A GET that does not follow redirects, so the test sees each one. */
  async function ask(path: string): Promise<Reply> {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    return {
      status: res.status,
      location: res.headers.get("location"),
      type: res.headers.get("content-type") ?? "",
      csp: res.headers.get("content-security-policy") ?? "",
      body: await res.text(),
    };
  }

  try {
    // any answer at all means the server is listening
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        await fetch(`${base}/`);
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!up) throw new Error(`the server did not start\n${log}`);

    await check("GET /convert serves the index page, framed only by this site", async () => {
      const r = await ask("/convert");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<title>Convert CAD files online, free and private | Rodeo</title>"));
      assert.match(r.csp, /frame-ancestors 'self'/);
    });

    await check("GET /convert/rvt-to-ifc serves that pair's page with its own canonical address", async () => {
      const r = await ask("/convert/rvt-to-ifc");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<h1>Convert RVT to IFC</h1>"));
      assert.ok(r.body.includes(`<link rel="canonical" href="${base}/convert/rvt-to-ifc" />`));
    });

    await check("GET /convert/RVT-to-IFC redirects to the lower-case address", async () => {
      const r = await ask("/convert/RVT-to-IFC");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert/rvt-to-ifc");
    });

    await check("GET /convert/nope-to-x redirects to the index", async () => {
      const r = await ask("/convert/nope-to-x");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert");
    });

    await check("GET /convert/rvt-to-ifc/ redirects without the slash", async () => {
      const r = await ask("/convert/rvt-to-ifc/");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert/rvt-to-ifc");
    });

    await check("GET /convert/ and GET /convert.html redirect to /convert", async () => {
      for (const path of ["/convert/", "/convert.html"]) {
        const r = await ask(path);
        assert.equal(r.status, 301, path);
        assert.equal(r.location, "/convert", path);
      }
    });

    await check("GET /viewer serves the viewer index", async () => {
      const r = await ask("/viewer");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<title>Open CAD and 3D files online, free | Rodeo</title>"));
      assert.match(r.csp, /frame-ancestors 'self'/);
    });

    await check("GET /viewer/vwx serves that viewer with its own canonical address", async () => {
      const r = await ask("/viewer/vwx");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<h1>Open Vectorworks (.vwx) files online</h1>"));
      assert.ok(r.body.includes(`<link rel="canonical" href="${base}/viewer/vwx" />`));
    });

    await check("GET /viewer/VWX redirects to the lower-case address, and a trailing slash redirects too", async () => {
      const upper = await ask("/viewer/VWX");
      assert.equal(upper.status, 301);
      assert.equal(upper.location, "/viewer/vwx");
      const slash = await ask("/viewer/vwx/");
      assert.equal(slash.status, 301);
      assert.equal(slash.location, "/viewer/vwx");
      const bare = await ask("/viewer/");
      assert.equal(bare.status, 301);
      assert.equal(bare.location, "/viewer");
    });

    await check("GET /viewer/nope redirects to the viewer index", async () => {
      const r = await ask("/viewer/nope");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/viewer");
    });

    await check("GET /sitemap-convert.xml serves the sitemap with the viewer pages", async () => {
      const r = await ask("/sitemap-convert.xml");
      assert.equal(r.status, 200);
      assert.match(r.type, /^application\/xml/);
      assert.ok(r.body.includes(`<loc>${base}/convert/rvt-to-ifc</loc>`));
      assert.ok(r.body.includes(`<loc>${base}/viewer</loc>`));
      assert.ok(r.body.includes(`<loc>${base}/viewer/sldprt</loc>`));
    });
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

await unitPart();
if (process.argv.includes("--server")) await serverPart();
console.log(failures === 0 ? "convert tests passed" : `${failures} convert test(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
