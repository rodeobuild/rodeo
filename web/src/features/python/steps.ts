// What the families of vs calls in vs/ add to a script's run (runner.ts), each from its own file:
// the kinds of step a script's record may hold and how each is applied to the drawing, what the
// copy of the drawing a script reads holds besides runner.ts's own, the questions a script may ask
// the editor while it runs, and what is done with the rest of its result when it ends.

import type { EditSession, ObjectInfo, VwxDocument } from "../../core/index.ts";

/** What a step is applied with. */
export interface StepContext {
  readonly s: EditSession;
  /** the ids the script made up, as the real ones made so far */
  readonly made: Map<string, string>;
  /** the real id for one a step names */
  real(v: unknown): string;
  /** a list of ids as a step holds it */
  ids(v: unknown): string[];
  /** a class by name, made when the drawing hasn't it */
  classIndex(name: string): number;
}

/** Applies one step: `a` is the step without its kind. Throws to refuse the whole run. */
export type StepFn = (a: readonly unknown[], ctx: StepContext) => void;

const steps = new Map<string, StepFn>();

/** Adds a kind of step (the first word of a list the vs module appends to its ops). */
export function registerStep(kind: string, fn: StepFn): void {
  if (steps.has(kind)) throw new Error(`step ${kind} is registered twice`);
  steps.set(kind, fn);
}

export function extraStep(kind: string): StepFn | undefined {
  return steps.get(kind);
}

/** More of the drawing for the script's copy: keys merged into the snapshot (read in Python by an _INIT_HOOKS entry). */
export type SnapshotPart = (s: EditSession) => Record<string, unknown>;
/** More of one object for the script's copy: keys merged into the object's entry, or null for none. */
export type ObjectPart = (o: ObjectInfo, doc: VwxDocument) => Record<string, unknown> | null;

export const snapshotParts: SnapshotPart[] = [];
export const objectParts: ObjectPart[] = [];

export function registerSnapshot(part: SnapshotPart): void {
  snapshotParts.push(part);
}

export function registerObjectSnapshot(part: ObjectPart): void {
  objectParts.push(part);
}

/** Answers a question a running script asks with vs's _host(kind, ...): its arguments as texts; the answer goes back as JSON. */
export type HostFn = (args: readonly string[]) => Promise<unknown>;

const hosts = new Map<string, HostFn>();

export function registerHost(kind: string, fn: HostFn): void {
  if (hosts.has(kind)) throw new Error(`host call ${kind} is registered twice`);
  hosts.set(kind, fn);
}

export function hostAsk(kind: string): HostFn | undefined {
  return hosts.get(kind);
}

/**
 * Called with a finished script's whole result (after its steps were applied) and whether it was a
 * plug-in's run: for what a _RESULT_HOOKS entry added that isn't a step, such as a setting to keep.
 */
export type ResultHandler = (result: Readonly<Record<string, unknown>>, s: EditSession, plugin: boolean) => void;

export const resultHandlers: ResultHandler[] = [];

export function registerResult(fn: ResultHandler): void {
  resultHandlers.push(fn);
}
