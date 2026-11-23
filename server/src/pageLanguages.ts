// The languages the converter's and viewer's pages are served in: English, and each other language
// in PAGE_LANGUAGES (web/src/convert/pages.ts) whose words file the server finds in
// web/src/convert/i18n/<code>.json. A file maps each English sentence or pattern to the language's:
// "Convert {0} to {1}": "{0} in {1} umwandeln". A translation that drops or adds a {n}, or changes a
// `code` span, is not used (the English shows) and the server says so when it starts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGLISH, languagePrefix, PAGE_LANGUAGES, type PageLanguage } from "../../web/src/convert/pages.ts";

/** Where the words files are: CONVERT_WORDS_DIR, else web/src/convert/i18n beside the server (the Docker image copies it there). */
export function wordsDir(): string {
  return process.env.CONVERT_WORDS_DIR ?? fileURLToPath(new URL("../../web/src/convert/i18n/", import.meta.url));
}

/** The English part of a key: what follows the last " › " (a key may name its sense first, "Pair › {0} to {1}"). */
export function englishOf(key: string): string {
  const cut = key.lastIndexOf(" › ");
  return cut < 0 ? key : key.slice(cut + 3);
}

/** The {n}s in a text, sorted, as one string ("{0}{1}"). */
function placeholders(text: string): string {
  return (text.match(/\{\d+\}/g) ?? []).sort().join("");
}

/** The `code` spans in a text, in order. */
function codeSpans(text: string): string[] {
  return text.split("`").filter((_, i) => i % 2 === 1);
}

/** Why a translation can't stand for its English, or null when it can. */
export function translationProblem(key: string, to: unknown): string | null {
  if (typeof to !== "string" || to.trim() === "") return "it is empty";
  const en = englishOf(key);
  if (placeholders(en) !== placeholders(to)) return `its {n}s are ${placeholders(to) || "none"}, not ${placeholders(en) || "none"}`;
  if (en.split("`").length !== to.split("`").length) return "its backticks don't match the English";
  if (codeSpans(en).join("\n") !== codeSpans(to).join("\n")) return "its `code` differs from the English";
  return null;
}

/** A language's words from its file's JSON, without the translations that can't stand for their English. */
export function checkedWords(raw: Record<string, unknown>): { words: Map<string, string>; refused: string[] } {
  const words = new Map<string, string>();
  const refused: string[] = [];
  for (const [key, to] of Object.entries(raw)) {
    const problem = translationProblem(key, to);
    if (problem) refused.push(`${JSON.stringify(key.slice(0, 60))}: ${problem}`);
    else words.set(key, to as string);
  }
  return { words, refused };
}

/** Reads the languages from `dir`: English first, then each language with a file, in PAGE_LANGUAGES' order. */
export function loadPageLanguages(dir: string = wordsDir()): PageLanguage[] {
  let files: Set<string>;
  try {
    files = new Set(readdirSync(dir));
  } catch {
    console.warn(`[convert] no page languages in ${dir}: the pages are in English only`);
    return [ENGLISH];
  }
  const out: PageLanguage[] = [ENGLISH];
  for (const { code, name } of PAGE_LANGUAGES) {
    if (code === "en" || !files.has(`${code}.json`)) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as Record<string, unknown>;
      const { words, refused } = checkedWords(raw);
      if (refused.length) console.warn(`[convert] ${code}: ${refused.length} translations not used, e.g. ${refused[0]}`);
      out.push({ code, prefix: languagePrefix(code), name, words: (english) => words.get(english) });
    } catch (err) {
      console.warn(`[convert] ${code}.json not read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

let loaded: PageLanguage[] | null = null;

/** The languages served, read once. */
export function pageLanguages(): readonly PageLanguage[] {
  loaded ??= loadPageLanguages();
  return loaded;
}
