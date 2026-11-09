// What an edit changed in a drawing's records, so the model can keep what it read from the rest.
// Records are immutable once in the list, and the same bytes give back the same Rec in a drawing
// (Model.recByData), so the changed records are the window between the common prefix and suffix of the lists before and
// after the edit. A move on a drawing of a few hundred thousand objects changes a handful.

import type { Rec } from "./records.ts";

/** Past this share of the records changed, everything counts as changed. */
const MOST = 0.25;

export class RecChange {
  /** the changed records, as they were and as they are; null when everything changed */
  private changed: readonly Rec[] | null = null;
  /** the changed records and what holds them, found so far */
  private readonly held = new Set<Rec>();
  /** the top-level records among them (a layer, the name table, a resource or its folder ...) */
  private readonly tops = new Set<Rec>();
  /** the changed records as they are, whose holders are found once the tree is built */
  private fresh: readonly Rec[] = [];
  private readonly after: readonly Rec[];

  /** Made before the tree of `after` is built: what held the old records is read from the old tree. */
  constructor(before: readonly Rec[], after: readonly Rec[]) {
    this.after = after;
    const n = Math.min(before.length, after.length);
    let s = 0;
    while (s < n && before[s] === after[s]) s++;
    let eb = before.length;
    let ea = after.length;
    while (eb > s && ea > s && before[eb - 1] === after[ea - 1]) {
      eb--;
      ea--;
    }
    if (before.length === 0 || eb - s + (ea - s) > MOST * Math.max(before.length, after.length)) return;
    const was = before.slice(s, eb);
    // each drawing hangs its own Recs, so an old record is where `before` has it; should one not
    // be, what held it can't be read from it: then all changed
    if (!this.hold(was, before)) return;
    this.fresh = after.slice(s, ea);
    this.changed = [...was, ...this.fresh];
  }

  /** Adds `recs` and what holds them in the tree of `list` as it is now; false when one is not where `list` has it. */
  private hold(recs: readonly Rec[], list: readonly Rec[]): boolean {
    // each tree is walked on its own: a record kept across the edit can have another parent after it
    const seen = new Set<Rec>();
    for (const r of recs) {
      for (let p: Rec | null = r; p && !seen.has(p); p = p.parent) {
        if (list[p.index] !== p) return false;
        seen.add(p);
        this.held.add(p);
        if (!p.parent) this.tops.add(p);
      }
    }
    return true;
  }

  /**
   * The changed records and every record that holds one, before or after the edit; null when
   * everything changed. Asked for once the tree of the records after is built.
   */
  reached(): ReadonlySet<Rec> | null {
    if (!this.changed) return null;
    if (!this.hold(this.fresh, this.after)) this.changed = null;
    this.fresh = [];
    return this.changed && this.held;
  }

  /** Whether the edit stayed inside top-level records `is` picks (inside the layers, say), before and after. */
  within(is: (r: Rec) => boolean): boolean {
    if (!this.reached()) return false;
    for (const r of this.tops) if (!is(r)) return false;
    return true;
  }

  /** Whether a record `is` picks changed. */
  changes(is: (r: Rec) => boolean): boolean {
    return !this.changed || this.changed.some(is);
  }

  /** Whether a record `is` picks changed or holds one that did: what was read from it is out of date. */
  reaches(is: (r: Rec) => boolean): boolean {
    const held = this.reached();
    if (!held) return true;
    for (const r of held) if (is(r)) return true;
    return false;
  }
}
