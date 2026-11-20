// Checks the retry and resume of a drawing's download (api.ts files.content) with a fake fetch, under Node.
// Run from web/: npx tsx src/platform/api.check.ts
import { ApiError, DOWNLOAD_STOPPED, files } from "./api.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// the retry pauses are short here
(globalThis as unknown as { window: { setTimeout: (fn: () => void, ms: number) => number } }).window = {
  setTimeout: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
};

const DRAWING = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 0xff);
type Answer = { status: number; version: string; from?: number; cut?: number; ended?: "error" | "early"; reject?: string; error?: { status: number }; states?: number; encoding?: string };
let seen: { range: string | undefined }[] = [];

/** Serves the drawing: each call takes the next answer in `script`. */
function fakeFetch(script: Answer[]): void {
  seen = [];
  let call = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ range: headers["Range"] });
    const a = script[Math.min(call++, script.length - 1)];
    if (a.reject) throw new TypeError(a.reject);
    if (a.error) return new Response(JSON.stringify({ error: "nope" }), { status: a.error.status, headers: { "Content-Type": "application/json" } });
    const from = a.from ?? 0;
    const total = DRAWING.length;
    const body = DRAWING.subarray(from);
    const sent = a.cut !== undefined ? body.subarray(0, a.cut) : body;
    // the bytes go out first; the failure comes after them (an errored stream would drop what it queued)
    let given = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!given && sent.length) {
          given = true;
          c.enqueue(sent.slice());
          return;
        }
        if (a.ended === "error") c.error(new TypeError("network error"));
        else c.close();
      },
    });
    const h: Record<string, string> = { "X-Version-Id": a.version, "X-Collab-Seq": "0" };
    if (a.status === 206) {
      h["Content-Range"] = `bytes ${from}-${total - 1}/${total}`;
      h["Content-Length"] = String(total - from);
    } else h["Content-Length"] = String(a.states ?? total);
    if (a.encoding) h["Content-Encoding"] = a.encoding;
    return new Response(stream, { status: a.status, headers: h });
  }) as typeof fetch;
}

const same = (b: Uint8Array): boolean => b.length === DRAWING.length && b.every((x, i) => x === DRAWING[i]);

async function main(): Promise<void> {
  // 1. a download that arrives whole
  fakeFetch([{ status: 200, version: "v1" }]);
  let got = await files.content("F");
  check(same(got.bytes) && got.versionId === "v1" && seen.length === 1, "a whole download is one request");

  // 2. the body fails after 100 bytes: the second try asks for the rest and gets it
  fakeFetch([{ status: 200, version: "v1", cut: 100, ended: "error" }, { status: 206, version: "v1", from: 100 }]);
  got = await files.content("F");
  check(same(got.bytes), "a body cut off part way is completed from the bytes held");
  check(seen.length === 2 && seen[1].range === "bytes=100-", `the retry resumes with Range: bytes=100- (requests ${seen.length}, range ${seen[1]?.range})`);

  // 3. the body ends early with no error: the same resume
  fakeFetch([{ status: 200, version: "v1", cut: 50 }, { status: 206, version: "v1", from: 50 }]);
  got = await files.content("F");
  check(same(got.bytes) && seen[1]?.range === "bytes=50-", "a body that ends before its declared length is resumed");

  // 4. the request itself fails twice (Chrome's "Failed to fetch"), then succeeds: three tries in all
  fakeFetch([{ status: 200, version: "v1", reject: "Failed to fetch" }, { status: 200, version: "v1", reject: "Failed to fetch" }, { status: 200, version: "v1" }]);
  got = await files.content("F");
  check(same(got.bytes) && seen.length === 3, `two failed requests then a whole one: 3 tries (${seen.length})`);

  // 5. every try is cut off: DOWNLOAD_STOPPED after exactly 3 tries
  fakeFetch([{ status: 200, version: "v1", reject: "Load failed" }]);
  let thrown: unknown = null;
  try {
    await files.content("F");
  } catch (err) {
    thrown = err;
  }
  check(thrown instanceof ApiError && thrown.code === DOWNLOAD_STOPPED && seen.length === 3, `all three tries fail: stopped (tries ${seen.length}, code ${(thrown as ApiError)?.code})`);

  // 6. a 404 is not retried
  fakeFetch([{ status: 200, version: "v1", error: { status: 404 } }]);
  thrown = null;
  try {
    await files.content("F");
  } catch (err) {
    thrown = err;
  }
  check(thrown instanceof ApiError && thrown.status === 404 && seen.length === 1, "a 404 is not retried");

  // 7. the version changes between tries: the drawing comes again from its first byte
  fakeFetch([{ status: 200, version: "v1", cut: 100, ended: "error" }, { status: 206, version: "v2", from: 100 }, { status: 200, version: "v2" }]);
  got = await files.content("F");
  check(same(got.bytes) && got.versionId === "v2" && seen.length === 3 && seen[2].range === undefined, "a version that changed mid-download is fetched again whole");

  // 8. the server ignores the Range and sends the whole drawing: nothing is doubled
  fakeFetch([{ status: 200, version: "v1", cut: 100, ended: "error" }, { status: 200, version: "v1" }]);
  got = await files.content("F");
  check(same(got.bytes), "a server that ignores Range gets its whole drawing, not a repeat of the held part");

  // 9. a body compressed on the way states its compressed length: the drawing is read to its end all the same
  fakeFetch([{ status: 200, version: "v1", states: 120, encoding: "gzip" }]);
  got = await files.content("F");
  check(same(got.bytes) && seen.length === 1, "a compressed body's stated length is not gone by");

  // 10. more bytes than the answer stated: all of them are kept
  fakeFetch([{ status: 200, version: "v1", states: 120 }]);
  got = await files.content("F");
  check(same(got.bytes) && seen.length === 1, "a body longer than its stated length is kept whole");

  if (failures) {
    console.log(`${failures} FAILED`);
    process.exitCode = 1;
  } else console.log("all ok");
}

void main();
