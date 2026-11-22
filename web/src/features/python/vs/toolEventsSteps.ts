// What toolEvents.ts reports from a tool's run (its toolSession key): the result code the script set,
// the point behaviour, help string, the mode bar it declared, what it drew for the rubber band and
// the data it saved. The run's steps are applied by runner.ts as usual; this file only keeps the
// report for the tool session (features/vwplugins/toolRun.ts), which takes it after each run.

import { registerResult } from "../steps.ts";

/** One mode of a tool's mode bar, numbered from 1 in the order the script added it. */
export interface ToolMode {
  readonly kind: "button" | "radio" | "pulldown" | "check";
  /** the image specifiers of a button or a radio group (a pull-down has none) */
  readonly icons: readonly string[];
  /** a pull-down's items */
  readonly items: readonly string[];
  /** a pull-down's title */
  readonly label: string;
  /** a radio group's button (from 1), a pull-down's item (from 0), a check box 0 or 1, a button 0 */
  value: number;
  enabled: boolean;
}

/** One thing a run drew for the rubber band, in millimetres. */
export type ToolDrawItem = readonly [kind: string, ...nums: number[]];

/** What a tool's run reported. */
export interface ToolReport {
  /** what the script set with vstSetEventResult (0 when it set none) */
  readonly result: number;
  readonly behavior: number;
  readonly help: string;
  readonly modes: readonly ToolMode[];
  readonly draw: readonly ToolDrawItem[];
  /** the data the script saved with vstSetData..., by data id: [kind, value] */
  readonly data: Readonly<Record<string, readonly [string, number | string]>>;
}

let last: ToolReport | null = null;

registerResult((result) => {
  last = readReport(result.toolSession);
});

/** The last report a tool's run made, cleared: null when the run made none (a plain run, or one that failed). */
export function takeToolReport(): ToolReport | null {
  const r = last;
  last = null;
  return r;
}

/** Forgets a report not yet taken, before a run. */
export function clearToolReport(): void {
  last = null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function mode(v: unknown): ToolMode | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const kind = m.kind === "radio" || m.kind === "pulldown" || m.kind === "check" ? m.kind : "button";
  return { kind, icons: strings(m.icons), items: strings(m.items), label: typeof m.label === "string" ? m.label : "", value: num(m.value, 0), enabled: m.enabled !== false };
}

function drawItem(v: unknown): ToolDrawItem | null {
  if (!Array.isArray(v) || typeof v[0] !== "string") return null;
  return [v[0], ...v.slice(1).map((x) => num(x, 0))];
}

function readReport(v: unknown): ToolReport | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const data: Record<string, readonly [string, number | string]> = {};
  if (r.data && typeof r.data === "object") {
    for (const [id, pair] of Object.entries(r.data as Record<string, unknown>)) {
      if (Array.isArray(pair) && (pair[0] === "long" || pair[0] === "real" || pair[0] === "string")) data[id] = [pair[0], pair[1] as number | string];
    }
  }
  return {
    result: num(r.result, 0),
    behavior: num(r.behavior, 0),
    help: typeof r.help === "string" ? r.help : "",
    modes: (Array.isArray(r.modes) ? r.modes : []).map(mode).filter((m): m is ToolMode => m !== null),
    draw: (Array.isArray(r.draw) ? r.draw : []).map(drawItem).filter((d): d is ToolDrawItem => d !== null),
    data,
  };
}
