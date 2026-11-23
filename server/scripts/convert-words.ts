// The words of the converter's and viewer's pages: node scripts/convert-words.ts <command>
//   list              every English sentence and pattern the pages say, as JSON ({key: note}), in the order they first show
//   missing <code>    the ones web/src/convert/i18n/<code>.json doesn't have yet, as JSON
//   unused <code>     the ones that file has and no page says any more
//   check             every language's file: complete, nothing unused, every translation usable
// It renders every page once in a language that answers nothing and notes each lookup, so it finds
// what the pages say, not what the source happens to spell out.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertPage, PAGE_LANGUAGES, PAIRS, pairSlug, VIEWER_PAGES, viewerPage, type PageLanguage } from "../../web/src/convert/pages.ts";
import { renderConvertPage } from "../src/convertPage.ts";
import { checkedWords, englishOf, wordsDir } from "../src/pageLanguages.ts";

const template = readFileSync(join(import.meta.dirname, "../../web/convert.html"), "utf8");

/** Every key the pages look up, with a note for the translator: what its {n}s stand for, from the first page that used it. */
export function pageWords(): Map<string, string> {
  const notes = new Map<string, string>();
  const listening: PageLanguage = {
    code: "xx",
    prefix: "/xx",
    name: "xx",
    words: (key, parts) => {
      if (!notes.has(key)) notes.set(key, noteFor(key, parts));
      return undefined;
    },
  };
  const languages = [listening, { ...listening, code: "yy", prefix: "/yy" }];
  const pages = [
    convertPage(null, listening),
    ...PAIRS.map(([a, b]) => convertPage(pairSlug(a, b), listening)),
    viewerPage(null, listening),
    ...VIEWER_PAGES.map((v) => viewerPage(v.id, listening)),
  ];
  for (const page of pages) if (page) renderConvertPage(template, page, "https://rodeo.build", listening, languages);
  return notes;
}

/** What a key's {n}s stood for, and what its sense prefix means. */
function noteFor(key: string, parts: readonly string[]): string {
  const sense = key.includes(" › ") ? key.slice(0, key.lastIndexOf(" › ")) : "";
  const senses: Record<string, string> = {
    Sentences: "Joins two sentences into one text. Most languages: a space between. Japanese and Chinese: no space.",
    List: "Builds a list of names: 'A, B' and 'A and B'. Use the language's list comma and its word for 'and'.",
    Pair: "A conversion's name, as a link: 'DWG to PDF' means converting DWG files into PDF files (not a range).",
    Table: "A word in the formats table's header row, or 'Yes' in its cells.",
    Crumb: "A step of the breadcrumb trail: the converter's or the viewer's index page.",
  };
  const bits: string[] = [];
  if (sense) bits.push(senses[sense] ?? sense);
  if (parts.length) bits.push(parts.map((p, i) => `{${i}} = ${JSON.stringify(p.length > 80 ? `${p.slice(0, 77)}…` : p)}`).join("; "));
  return bits.join(" ");
}

/** A language's file as it is on disk, or an empty one. */
function fileOf(code: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(wordsDir(), `${code}.json`), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function main(): void {
  const [command, code] = process.argv.slice(2);
  const words = pageWords();
  if (command === "list") {
    console.log(JSON.stringify(Object.fromEntries(words), null, 2));
    return;
  }
  if ((command === "missing" || command === "unused") && code) {
    const file = fileOf(code);
    const out =
      command === "missing"
        ? Object.fromEntries([...words].filter(([key]) => !(key in file)))
        : Object.keys(file).filter((key) => !words.has(key));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (command === "check") {
    let bad = 0;
    console.log(`${words.size} keys (${[...words.keys()].reduce((n, k) => n + englishOf(k).split(/\s+/).length, 0)} English words)`);
    for (const { code: lang } of PAGE_LANGUAGES) {
      if (lang === "en") continue;
      const file = fileOf(lang);
      const { refused } = checkedWords(file);
      const missing = [...words.keys()].filter((key) => !(key in file));
      const unused = Object.keys(file).filter((key) => !words.has(key));
      const ok = refused.length === 0 && missing.length === 0 && unused.length === 0;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${lang}: ${missing.length} missing, ${unused.length} unused, ${refused.length} not usable${refused[0] ? ` (${refused[0]})` : ""}`);
    }
    process.exit(bad ? 1 : 0);
  }
  console.error("usage: node scripts/convert-words.ts list | missing <code> | unused <code> | check");
  process.exit(2);
}

if (process.argv[1]?.endsWith("convert-words.ts")) main();
