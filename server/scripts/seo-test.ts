// Tests for search and link previews (src/seo.ts): node scripts/seo-test.ts
// The unit part checks the head markup, the JSON-LD, the sitemaps, robots.txt, llms.txt and the
// IndexNow pass against a stub endpoint. With --server, a real server on port 8873 with its own data
// folder and a copy of the editor's index.html checks the routes and the head the server sends.
// Nothing is sent to api.indexnow.org: the endpoint is a local stub.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8873;
const BASE = `http://localhost:${PORT}`;
const root = mkdtempSync(join(tmpdir(), "rodeo-seo-"));
const webDist = join(root, "web");
const ROOT = join(import.meta.dirname, "../..");
const withServer = process.argv.includes("--server");

// config.ts reads the environment when it is imported, so the src modules load after these lines.
process.env.DATA_DIR = root;
process.env.PUBLIC_URL = BASE;
process.env.NODE_ENV = "development";

const seo = await import("../src/seo.ts");

let failures = 0;
/** Runs one check, printing its result; a failure is counted and the run goes on. */
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The JSON-LD blocks in an HTML document, parsed. */
function jsonLdIn(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

/** The text of the page's <title>, and how many there are. */
function titlesIn(html: string): { count: number; text: string | null } {
  const all = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)];
  return { count: all.length, text: all[0]?.[1] ?? null };
}

/** Every <meta> and <link> in the head, as tag text, to count duplicates. */
function headTagsIn(html: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  return [...head.matchAll(/<(meta|link)\b[^>]*>/g)].map((m) => m[0]);
}

try {
  await check("the home head: one title of 65 characters or fewer, a description of about 150", () => {
    const head = seo.editorHead(BASE);
    assert.ok(head.title && head.title.length <= 65, `title is ${head.title?.length} characters`);
    const desc = /<meta name="description" content="([^"]*)">/.exec(head.head ?? "")?.[1] ?? "";
    assert.ok(desc.length >= 120 && desc.length <= 170, `description is ${desc.length} characters`);
  });

  await check("the home head: canonical is the root, with Open Graph, Twitter and the image size", () => {
    const head = seo.editorHead(BASE).head ?? "";
    assert.ok(head.includes(`<link rel="canonical" href="${BASE}/">`));
    assert.ok(head.includes('<meta property="og:type" content="website">'));
    assert.ok(head.includes(`<meta property="og:url" content="${BASE}/">`));
    assert.ok(head.includes(`<meta property="og:image" content="${BASE}/og/rodeo.png">`));
    assert.ok(head.includes('<meta property="og:image:width" content="1200">'));
    assert.ok(head.includes('<meta property="og:image:height" content="630">'));
    assert.ok(head.includes('<meta name="twitter:card" content="summary_large_image">'));
  });

  await check("the JSON-LD parses and has the site, organisation and app, with no ratings or reviews", () => {
    const blocks = jsonLdIn(`<head>${seo.editorHead(BASE).head}</head>`);
    assert.equal(blocks.length, 1, "one JSON-LD block");
    const graph = (blocks[0] as { "@graph": Record<string, unknown>[] })["@graph"];
    const types = graph.map((g) => g["@type"]);
    assert.deepEqual(types, ["WebSite", "Organization", "SoftwareApplication"]);
    const app = graph[2] as Record<string, unknown>;
    assert.equal(app.license, "https://www.gnu.org/licenses/agpl-3.0.html");
    assert.equal((app.offers as { price: string }).price, "0");
    assert.equal(app.isAccessibleForFree, true);
    assert.ok(Array.isArray(app.featureList) && (app.featureList as unknown[]).length >= 10);
    assert.deepEqual((graph[1] as { sameAs: string[] }).sameAs, ["https://github.com/rodeobuild/rodeo", "https://www.npmjs.com/package/@rodeo.build/cli"]);
    const text = JSON.stringify(graph);
    assert.ok(!text.includes("aggregateRating") && !text.includes("review"), "no ratings or reviews");
  });

  await check("the JSON-LD has no raw < > or & characters", () => {
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(seo.editorHead(BASE).head ?? "")?.[1] ?? "";
  assert.ok(script.length > 0);
  assert.ok(!/[<>&]/.test(script), "the script text is escaped");
});

  await check("the home page hook answers the editor's paths and not share, embed, file or gallery", () => {
    assert.ok(seo.homepageExtras(new URL(`${BASE}/`)), "the home page");
    assert.ok(seo.homepageExtras(new URL(`${BASE}/drawing`)), "another editor path");
    assert.equal(seo.homepageExtras(new URL(`${BASE}/?share=abcdefghijklmnop`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/?embed=abcdefghijklmnop`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/?url=https%3A%2F%2Fx.test%2Fa.vwx`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/?invite=abcdefghijklmnop`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/gallery/abc`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/guide/files`)), null);
    assert.equal(seo.homepageExtras(new URL(`${BASE}/convert/vwx-to-dwg`)), null);
  });

  await check("the sitemap index lists the four sitemaps", () => {
    const xml = seo.sitemapIndexXml(BASE);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    for (const name of ["sitemap-pages.xml", "sitemap-convert.xml", "sitemap-guide.xml", "sitemap-gallery.xml"]) {
      assert.ok(xml.includes(`<loc>${BASE}/${name}</loc>`), name);
    }
  });

  await check("the pages sitemap lists the root and the gallery", () => {
    const xml = seo.pagesSitemapXml(BASE);
    assert.ok(xml.includes(`<loc>${BASE}/</loc>`));
    assert.ok(xml.includes(`<loc>${BASE}/gallery</loc>`));
    assert.equal((xml.match(/<url>/g) ?? []).length, 2);
  });

  await check("robots.txt keeps its rules and names the sitemap index", async () => {
    const { robotsTxt } = await import("../../web/src/features/gallery/rules.ts");
    const text = robotsTxt(BASE);
    for (const rule of ["Allow: /api/gallery/", "Disallow: /api/", "Disallow: /admin", "Disallow: /*?share=", "Disallow: /*?embed=", "Disallow: /*?invite=", "Disallow: /*?file="]) {
      assert.ok(text.includes(rule), rule);
    }
    assert.ok(text.includes(`Sitemap: ${BASE}/sitemap.xml`));
  });

  await check("llms.txt has the title, the summary and linked sections", () => {
    const text = seo.llmsTxt(BASE);
    assert.ok(text.startsWith("# Rodeo\n"));
    assert.ok(/^> .+/m.test(text), "a summary line");
    for (const section of ["## Docs", "## Tools", "## Developers", "## Licence"]) assert.ok(text.includes(section), section);
    assert.ok(text.includes(`[User guide](${BASE}/guide)`));
    assert.ok(text.includes(`[File converter](${BASE}/convert)`));
    assert.ok(text.includes(`${BASE}/mcp`));
    assert.ok(text.includes("https://github.com/rodeobuild/rodeo"));
  });

  await check("IndexNow runs only in production on a public https address", () => {
    assert.equal(seo.indexNowOn("https://rodeo.build", false), false, "not production");
    assert.equal(seo.indexNowOn("http://rodeo.build", true), false, "not https");
    assert.equal(seo.indexNowOn("https://localhost:8080", true), false, "localhost");
    assert.equal(seo.indexNowOn("https://app.localhost", true), false, "a .localhost name");
    assert.equal(seo.indexNowOn("https://rodeo.build", true), true);
  });

  if (withServer) {
    // ---- the server: a real process on port 8873 with a copy of the editor's index.html
    mkdirSync(webDist, { recursive: true });
    copyFileSync(join(ROOT, "web/index.html"), join(webDist, "index.html"));
    mkdirSync(join(webDist, "og"), { recursive: true });
    copyFileSync(join(ROOT, "web/public/og/rodeo.png"), join(webDist, "og/rodeo.png"));

    let log = "";
    const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, NODE_ENV: "development", PORT: String(PORT), DATA_DIR: root, PUBLIC_URL: BASE, WEB_DIST: webDist },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
    server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

    /** A GET that does not follow redirects. */
    async function get(path: string): Promise<{ status: number; type: string; body: string; cache: string }> {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text(), cache: res.headers.get("cache-control") ?? "" };
    }

    try {
      for (let i = 0; i < 100 && !log.includes("listening"); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(log.includes("listening"), `the server did not start:\n${log}`);

      const home = await get("/");
      await check("GET / has one title, one canonical and one og:title, and valid JSON-LD", () => {
        assert.equal(home.status, 200);
        const title = titlesIn(home.body);
        assert.equal(title.count, 1);
        assert.equal(title.text, "Rodeo: free browser CAD that opens Vectorworks (VWX) files");
        assert.equal(home.body.match(/rel="canonical"/g)?.length ?? 0, 1);
        assert.equal(home.body.match(/property="og:title"/g)?.length ?? 0, 1);
        assert.equal(jsonLdIn(home.body).length, 1);
        assert.equal(home.body.match(/name="description"/g)?.length ?? 0, 1);
        assert.match(home.body, /<link rel="canonical" href="http:\/\/localhost:8873\/">/);
        // the editor's own tags are still there, once each
        assert.equal(home.body.match(/rel="manifest"/g)?.length ?? 0, 1);
        assert.equal(home.body.match(/name="theme-color"/g)?.length ?? 0, 1);
        const tags = headTagsIn(home.body);
        assert.equal(new Set(tags).size, tags.length, "no tag appears twice in the head");
      });

      await check("GET /some/editor/path gets the same head, canonical still the root", async () => {
        const r = await get("/drawing/abc");
        assert.equal(titlesIn(r.body).count, 1);
        assert.match(r.body, /<link rel="canonical" href="http:\/\/localhost:8873\/">/);
      });

      await check("GET /?share= and /?embed= with no live link get no homepage canonical", async () => {
        for (const path of ["/?share=abcdefghijklmnop", "/?embed=abcdefghijklmnop"]) {
          const r = await get(path);
          assert.equal(r.status, 200, path);
          assert.equal(r.body.match(/rel="canonical"/g)?.length ?? 0, 0, path);
          assert.equal(titlesIn(r.body).text, "Rodeo", path);
        }
      });

      await check("the sitemap index and the pages sitemap are served as XML", async () => {
        const index = await get("/sitemap.xml");
        assert.equal(index.status, 200);
        assert.match(index.type, /^application\/xml/);
        assert.ok(index.body.includes(`${BASE}/sitemap-gallery.xml`));
        assert.equal(index.cache, "public, max-age=3600");
        const pages = await get("/sitemap-pages.xml");
        assert.equal(pages.status, 200);
        assert.ok(pages.body.includes(`<loc>${BASE}/gallery</loc>`));
      });

      await check("the gallery sitemap is served at its new path", async () => {
        const gallery = await get("/sitemap-gallery.xml");
        assert.equal(gallery.status, 200);
        assert.match(gallery.type, /^application\/xml/);
        assert.ok(gallery.body.includes("<urlset"));
      });

      await check("robots.txt names the sitemap index; llms.txt is plain text", async () => {
        const robots = await get("/robots.txt");
        assert.match(robots.type, /^text\/plain/);
        assert.ok(robots.body.includes(`Sitemap: ${BASE}/sitemap.xml`));
        const llms = await get("/llms.txt");
        assert.equal(llms.status, 200);
        assert.equal(llms.type, "text/plain; charset=utf-8");
        assert.ok(llms.body.startsWith("# Rodeo\n"));
      });

      await check("the social card is served as a 1200 by 630 PNG", async () => {
        const res = await fetch(`${BASE}/og/rodeo.png`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/png");
        const bytes = Buffer.from(await res.arrayBuffer());
        assert.equal(bytes.readUInt32BE(16), 1200);
        assert.equal(bytes.readUInt32BE(20), 630);
      });

      await check("the IndexNow key file is written to DATA_DIR and served at /<key>.txt", async () => {
        const keyPath = join(root, "indexnow-key.txt");
        assert.ok(existsSync(keyPath), "the key was kept in DATA_DIR");
        const key = readFileSync(keyPath, "utf8").trim();
        assert.match(key, /^[A-Za-z0-9-]{8,128}$/);
        const r = await get(`/${key}.txt`);
        assert.equal(r.status, 200);
        assert.equal(r.body.trim(), key);
      });

      await check("the IndexNow pass sends new pages to the stub, then nothing until they change, and keeps the list on failure", async () => {
        const key = readFileSync(join(root, "indexnow-key.txt"), "utf8").trim();
        const bodies: { host: string; key: string; keyLocation: string; urlList: string[] }[] = [];
        let answer = 200;
        const stub: Server = createServer((req, res) => {
          let data = "";
          req.on("data", (d: Buffer) => (data += d.toString()));
          req.on("end", () => {
            if (answer === 200) bodies.push(JSON.parse(data));
            res.writeHead(answer, { "Content-Type": "text/plain" }).end(answer === 200 ? "" : "no");
          });
        });
        await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
        const endpoint = `http://127.0.0.1:${(stub.address() as { port: number }).port}/indexnow`;
        const sentPath = join(root, "indexnow-sent.json");
        const opts = { origin: `http://127.0.0.1:${PORT}`, publicUrl: BASE, key, endpoint, sentPath };
        try {
          const first = await seo.indexNowPass(opts);
          assert.ok(first > 2, `sent ${first}`);
          assert.equal(bodies.length, 1);
          assert.equal(bodies[0].host, "localhost:8873");
          assert.equal(bodies[0].key, key);
          assert.equal(bodies[0].keyLocation, `${BASE}/${key}.txt`);
          assert.ok(bodies[0].urlList.includes(`${BASE}/`) && bodies[0].urlList.includes(`${BASE}/gallery`));
          assert.ok(bodies[0].urlList.every((u) => u.startsWith(BASE)), "every URL is on the site");

          assert.equal(await seo.indexNowPass(opts), 0, "a second pass sends nothing new");
          assert.equal(bodies.length, 1);

          // a failing endpoint: nothing is saved, so the next pass sends the same URLs again
          rmSync(sentPath, { force: true }); // everything is new again
          answer = 500;
          await assert.rejects(seo.indexNowPass(opts), /500/);
          assert.equal(existsSync(sentPath), false, "nothing is saved after a failed send");
          answer = 200;
          assert.ok((await seo.indexNowPass(opts)) > 0, "retried once the endpoint answers again");
          assert.equal(bodies.length, 2);
        } finally {
          stub.close();
        }
      });
    } finally {
      server.kill();
    }
  }

  if (failures > 0) throw new Error(`${failures} check(s) failed`);
  console.log(withServer ? "seo checks passed, with the server" : "seo unit checks passed (add --server for the server checks)");
} finally {
  rmSync(root, { recursive: true, force: true });
}
