// Tests for the user guide's pages (src/guide.ts over docs/guide): node scripts/guide-test.ts
// The unit part renders every page and checks each one's h1, title, description, canonical address,
// JSON-LD, sidebar, sitemap, and that every internal link reaches a page and an anchor that exists.
// With --server, a real server on a loopback port checks the routes, redirects, the 404 and headers.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGuide, guideDir, guideSitemapXml, type Guide, type GuideDoc, renderGuidePage } from "../src/guide.ts";

const TEMPLATE_PATH = join(import.meta.dirname, "../../web/guide.html");
const template = readFileSync(TEMPLATE_PATH, "utf8");
const BASE_URL = "http://x.test";

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

/** The guide as the server builds it, from the folder it reads. */
function loadGuide(): Guide {
  const dir = guideDir();
  const sources = new Map<string, string>();
  for (const name of readdirSync(dir)) if (/\.md$/i.test(name)) sources.set(name, readFileSync(join(dir, name), "utf8"));
  return buildGuide(sources);
}

/** The page as the server sends it, with the template filled in. */
function pageHtml(guide: Guide, doc: GuideDoc): string {
  return renderGuidePage(template, guide, doc, BASE_URL);
}

/** The JSON-LD block of a page, parsed. */
function jsonLd(html: string): { "@graph": { "@type": string; [k: string]: unknown }[] } {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "a JSON-LD block");
  return JSON.parse(m[1]);
}

/** The text of every href in a page, as the page writes it. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

async function unitPart(): Promise<void> {
  const guide = loadGuide();
  const files = readdirSync(guideDir()).filter((f) => /\.md$/i.test(f));
  const docs = [...guide.docs.values()];
  const index = guide.docs.get("readme");
  assert.ok(index, "the index page exists");

  await check("every markdown file in docs/guide is a page", () => {
    assert.equal(docs.length, files.length, `${files.length} files, ${docs.length} pages`);
  });

  await check("every page has exactly one h1, in the article", () => {
    for (const doc of docs) {
      const h1s = doc.headings.filter((h) => h.level === 1).length;
      assert.equal(h1s, 1, `${doc.file} has ${h1s} h1s`);
      const html = pageHtml(guide, doc);
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${doc.file}: h1 count in the page`);
    }
  });

  await check("every title is unique and names the guide, and every description is set and short", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const doc of docs) {
      assert.ok(!titles.has(doc.title), `${doc.file}: duplicate title "${doc.title}"`);
      titles.add(doc.title);
      assert.ok(doc.description.length > 0, `${doc.file}: no description`);
      assert.ok(doc.description.length <= 160, `${doc.file}: description is ${doc.description.length} characters`);
      assert.ok(!descriptions.has(doc.description), `${doc.file}: duplicate description`);
      descriptions.add(doc.description);
      if (doc.slug !== "readme") assert.equal(doc.title, `${doc.h1} | Rodeo user guide`, doc.file);
    }
  });

  await check("every page has its canonical address and a title that matches", () => {
    for (const doc of docs) {
      const html = pageHtml(guide, doc);
      assert.ok(html.includes(`<link rel="canonical" href="${BASE_URL}${doc.path}" />`), `${doc.file}: canonical`);
      assert.equal(html.split("<title>").length - 1, 1, `${doc.file}: one title`);
      assert.ok(html.includes(`<title>${doc.title.replace(/&/g, "&amp;")}</title>`), `${doc.file}: title`);
    }
  });

  await check("every page's JSON-LD parses and names a TechArticle and a breadcrumb trail", () => {
    for (const doc of docs) {
      const graph = jsonLd(pageHtml(guide, doc))["@graph"];
      const article = graph.find((g) => g["@type"] === "TechArticle");
      const crumbs = graph.find((g) => g["@type"] === "BreadcrumbList") as { itemListElement?: unknown[] } | undefined;
      assert.ok(article, `${doc.file}: TechArticle`);
      assert.equal(article.headline, doc.h1, `${doc.file}: headline`);
      assert.equal(article.url, `${BASE_URL}${doc.path}`, `${doc.file}: url`);
      assert.ok(crumbs?.itemListElement, `${doc.file}: BreadcrumbList`);
      assert.equal(crumbs.itemListElement.length, doc.slug === "readme" ? 2 : 3, `${doc.file}: breadcrumb length`);
    }
  });

  await check("the sidebar lists every page once, in the README's order, and the index is not in it", () => {
    const linked = guide.order;
    assert.equal(new Set(linked).size, linked.length, "no page twice");
    assert.ok(!linked.includes("readme"), "the index is not in its own order");
    const missing = docs.filter((d) => d.slug !== "readme" && !linked.includes(d.slug)).map((d) => d.file);
    assert.deepEqual(missing, [], "pages missing from README.md's list");
  });

  await check("every internal link reaches a page that exists, and an anchor that exists on it", () => {
    const broken: string[] = [];
    for (const doc of docs) {
      for (const href of hrefsOf(pageHtml(guide, doc))) {
        if (!href.startsWith("/guide")) continue;
        const [path, frag = ""] = href.split("#");
        if (path.endsWith(".md")) {
          broken.push(`${doc.file}: ${href} (a .md address)`);
          continue;
        }
        const slug = path === "/guide" ? "readme" : path.slice("/guide/".length);
        const target = guide.docs.get(slug);
        if (!target) {
          broken.push(`${doc.file}: ${href} (no such page)`);
          continue;
        }
        if (frag && !target.headings.some((h) => h.id === frag)) broken.push(`${doc.file}: ${href} (no anchor "${frag}" on ${target.file})`);
      }
    }
    assert.deepEqual(broken, [], `broken links:\n       ${broken.join("\n       ")}`);
  });

  await check("the sitemap lists the index and every page, and nothing else", () => {
    const xml = guideSitemapXml(guide, BASE_URL);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]).sort();
    const expected = docs.map((d) => `${BASE_URL}${d.path}`).sort();
    assert.deepEqual(locs, expected);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "an XML declaration");
  });

  await check("the index links to every page, and the phone menu has the same list as the sidebar", () => {
    const html = pageHtml(guide, index);
    for (const doc of docs) if (doc.slug !== "readme") assert.ok(html.includes(`href="${doc.path}"`), `${doc.file} in the sidebar`);
    const menu = /<nav aria-label="Guide pages">([\s\S]*?)<\/nav><\/details>/.exec(html);
    const side = /<nav class="g-side" aria-label="Guide pages">([\s\S]*?)<\/nav>/.exec(html);
    assert.ok(menu && side, "the menu and the sidebar");
    assert.equal(menu[1], side[1], "the same list");
  });

  await check("the pager goes from the index to the first page, and back, with none past the ends", () => {
    const first = guide.docs.get(guide.order[0]);
    const last = guide.docs.get(guide.order[guide.order.length - 1]);
    assert.ok(first && last);
    assert.ok(pageHtml(guide, index).includes(`class="g-pager-next" href="${first.path}"`), "index to first");
    assert.ok(pageHtml(guide, first).includes('class="g-pager-prev" href="/guide"'), "first back to the index");
    assert.ok(!pageHtml(guide, last).includes("g-pager-next"), "no next past the last page");
    assert.ok(!pageHtml(guide, index).includes("g-pager-prev"), "no previous before the index");
  });

  await check("the edit link names the page's own file on GitHub", () => {
    for (const doc of docs) {
      assert.ok(pageHtml(guide, doc).includes(`https://github.com/rodeobuild/rodeo/blob/main/docs/guide/${doc.file}"`), doc.file);
    }
  });

  await check("a page's text is escaped in the head, and the JSON-LD cannot end its script", () => {
    const doc = { ...guide.docs.get("files")!, description: "a </script><b>&", h1: "A <b>x" };
    const html = renderGuidePage(template, guide, doc, BASE_URL);
    assert.ok(!html.includes("</script><b>"), "no script break-out");
    assert.ok(html.includes('content="a &lt;/script&gt;&lt;b&gt;&amp;"'), "escaped description");
  });
}

/** One response from the server: its status, redirect target, type and cache policy, and its body. */
interface Reply {
  status: number;
  location: string | null;
  type: string;
  cache: string;
  csp: string;
  marker: string;
  body: string;
}

async function serverPart(): Promise<void> {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const base = `http://localhost:${port}`;
  const root = mkdtempSync(join(tmpdir(), "rodeo-guide-"));
  const webDist = join(root, "dist");
  mkdirSync(webDist);
  copyFileSync(TEMPLATE_PATH, join(webDist, "guide.html"));
  let log = "";

  // the default GUIDE_DIR: the server reads docs/guide in this repository
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
      cache: res.headers.get("cache-control") ?? "",
      csp: res.headers.get("content-security-policy") ?? "",
      marker: res.headers.get("x-openvwx-page") ?? "",
      body: await res.text(),
    };
  }

  try {
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

    const guide = loadGuide();
    const files = readdirSync(guideDir()).filter((f) => /\.md$/i.test(f));

    await check("GET /guide serves the index: its canonical, headers and cache policy", async () => {
      const r = await ask("/guide");
      assert.equal(r.status, 200);
      assert.match(r.type, /^text\/html/);
      assert.equal(r.cache, "public, max-age=300");
      assert.match(r.csp, /frame-ancestors 'self'/);
      assert.equal(r.marker, "guide", "the service worker's marker");
      assert.ok(r.body.includes(`<link rel="canonical" href="${base}/guide" />`));
      assert.ok(r.body.includes("<title>Rodeo user guide: draw, model and render in your browser</title>"));
    });

    await check("GET /guide/files serves that page with its own canonical address", async () => {
      const r = await ask("/guide/files");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<h1 id=\"files-opening-saving-and-tabs\">"), "the h1");
      assert.ok(r.body.includes(`<link rel="canonical" href="${base}/guide/files" />`));
      jsonLd(r.body);
    });

    await check("GET /guide/files/ redirects without the slash", async () => {
      const r = await ask("/guide/files/");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/guide/files");
    });

    await check("GET /guide/Files and GET /guide/files.md redirect to /guide/files", async () => {
      for (const path of ["/guide/Files", "/guide/files.md", "/guide/Files.MD"]) {
        const r = await ask(path);
        assert.equal(r.status, 301, path);
        assert.equal(r.location, "/guide/files", path);
      }
    });

    await check("GET /guide/readme and GET /guide/README.md redirect to /guide", async () => {
      for (const path of ["/guide/readme", "/guide/README.md"]) {
        const r = await ask(path);
        assert.equal(r.status, 301, path);
        assert.equal(r.location, "/guide", path);
      }
    });

    await check("GET /guide.html and GET /guide/ redirect to /guide", async () => {
      for (const path of ["/guide.html", "/guide/"]) {
        const r = await ask(path);
        assert.equal(r.status, 301, path);
        assert.equal(r.location, "/guide", path);
      }
    });

    await check("GET /guide/nope is a 404 page that links to the guide's pages, not cached", async () => {
      const r = await ask("/guide/nope");
      assert.equal(r.status, 404);
      assert.match(r.type, /^text\/html/);
      assert.equal(r.cache, "no-store");
      assert.ok(r.body.includes("This page is not in the guide"));
      assert.ok(r.body.includes('href="/guide/files"'), "a link to a page");
      assert.ok(r.body.includes('name="robots" content="noindex"'));
    });

    await check("every page of the guide is served, and no page's href is missing", async () => {
      assert.equal(files.length, guide.docs.size, "every file is a page");
      for (const doc of guide.docs.values()) {
        const r = await ask(doc.path);
        assert.equal(r.status, 200, doc.path);
      }
    });

    await check("GET /sitemap-guide.xml lists every page", async () => {
      const r = await ask("/sitemap-guide.xml");
      assert.equal(r.status, 200);
      assert.match(r.type, /^application\/xml/);
      assert.equal(r.body.split("<loc>").length - 1, guide.docs.size);
      assert.ok(r.body.includes(`<loc>${base}/guide/files</loc>`));
    });
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

await unitPart();
if (process.argv.includes("--server")) await serverPart();
console.log(failures === 0 ? "guide tests passed" : `${failures} guide test(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
