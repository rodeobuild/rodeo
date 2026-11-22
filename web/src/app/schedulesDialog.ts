// The dialogs of Tools > Reports for schedules: Create Schedule… (a worksheet that lists the doors,
// windows, rooms or room finishes: schedules.ts), Worksheet on Drawing… (shows a worksheet on a
// layer) and Recalculate Worksheets. The worksheet made is opened in the worksheet editor.

import type { LayerInfo, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { appContext } from "./ext.ts";
import { PRESETS, createSchedule, freeScheduleName, placementOn, scheduleSourceOf, scheduleSpec, type SchedulePreset } from "./schedules.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { editWorksheet } from "./worksheetEditor.ts";
import { recalculateNow } from "./worksheetFormulas.ts";

const field = (label: string, input: HTMLElement): HTMLElement =>
  h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);

/** The layers a worksheet can be shown on: sheet layers first, then design layers. */
function placeChoices(doc: VwxDocument): LayerInfo[] {
  const layers = doc.layers();
  return [...layers.filter((l) => l.kind === "sheet"), ...layers.filter((l) => l.kind === "design")];
}

/** The active layer's id when it is one of `layers`, else `fallback`. */
function activeOf(layers: readonly LayerInfo[], fallback: string): string {
  const active = store.activeLayerId;
  return layers.some((l) => l.id === active) ? (active as string) : fallback;
}

function layerSelect(label: string, layers: readonly LayerInfo[], value: string, noneLabel: string | null): HTMLSelectElement {
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
    ...(noneLabel === null ? [] : [h("option", { value: "", text: noneLabel })]),
    ...layers.map((l) => h("option", { attrs: { translate: "no" }, value: l.id, text: l.name })),
  );
  select.value = value;
  return select;
}

/** Tools > Reports > Create Schedule…: which schedule, its name, and the layer to show it on. */
export async function createScheduleDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const src = scheduleSourceOf(doc);
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.layers().map((l) => l.name)]);
  const usable = (p: SchedulePreset): boolean => !("error" in scheduleSpec(src, p));
  const first = PRESETS.find(usable) ?? PRESETS[0];

  const kind = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Schedule" } },
    ...PRESETS.map((p) =>
      h("option", {
        value: p.id,
        text: usable(p) ? p.title : `${p.title} (none in this drawing)`,
        disabled: !usable(p),
      }),
    ),
  );
  kind.value = first.id;
  const name = h("input", {
    cls: "menu-dialog-input cr-name",
    value: freeScheduleName(taken, first.title),
    attrs: { type: "text", "aria-label": "Name", spellcheck: "false" },
  });
  let shownDefault = first.title;
  const layers = placeChoices(doc);
  const place = layerSelect("Place on", layers, activeOf(layers.filter((l) => l.kind === "sheet"), ""), "Don't place");
  const note = h("p", { cls: "muted" });
  const showNote = (): void => {
    const p = PRESETS.find((x) => x.id === kind.value) ?? first;
    const built = scheduleSpec(src, p);
    note.textContent = "error" in built ? "" : built.all ? p.noteAll : p.note;
  };
  kind.addEventListener("change", () => {
    const p = PRESETS.find((x) => x.id === kind.value) ?? first;
    // a name still the last default follows the schedule chosen
    if (name.value.trim() === freeScheduleName(taken, shownDefault)) {
      name.value = freeScheduleName(taken, p.title);
      shownDefault = p.title;
    }
    showNote();
  });
  showNote();

  const result = await showDialog<{ preset: SchedulePreset; name: string; layerId: string | null; missing: string[] }>({
    title: "Create Schedule",
    okLabel: "Create",
    cls: "cr-dialog",
    body: [field("Schedule", kind), field("Name", name), field("Place on", place), note],
    check: () => {
      const preset = PRESETS.find((p) => p.id === kind.value);
      if (!preset) return { error: "Choose a schedule.", focus: kind };
      const title = name.value.trim();
      if (!title) return { error: "Name the schedule.", focus: name };
      if (taken.has(title)) return { error: `"${title}" is already used in this drawing.`, focus: name };
      const built = scheduleSpec(src, preset);
      if ("error" in built) return { error: built.error, focus: kind };
      return { value: { preset, name: title, layerId: place.value || null, missing: built.missing } };
    },
  });
  if (!result) return;
  const at = result.layerId ? { layerId: result.layerId, ...placementOn(doc.layers(), result.layerId, visibleOn(result.layerId)) } : null;
  const made = attempt("Create Schedule", (s) => createSchedule(s, result.preset, result.name, at));
  if (!made) return;
  const after = store.session?.doc ?? doc;
  const lines = after.worksheetLive(made.value)?.database[0]?.subrows ?? 0;
  const left = result.missing.length ? ` ${result.preset.leftOut} ${result.missing.join(", ")}` : "";
  toast(`${result.name}: ${lines} ${lines === 1 ? "line" : "lines"}.${left}`, "info");
  await editWorksheet(made.value);
}

/** Whether the drawing has a worksheet to show on a layer. */
export const canPlaceWorksheet = (): boolean => !!store.session?.doc.resources().some((r) => r.kind === "worksheet");

/** Tools > Reports > Worksheet on Drawing…: shows a worksheet on a layer and selects it. */
export async function worksheetOnDrawingDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const sheets = doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .sort((a, b) => a.index - b.index);
  const layers = placeChoices(doc);
  if (sheets.length === 0 || layers.length === 0) return;
  const picked = [...store.selection].map((id) => doc.object(id)?.worksheet ?? null).find((i) => i !== null) ?? null;
  const sheet = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Worksheet" } },
    ...sheets.map((s) => h("option", { attrs: { translate: "no" }, value: String(s.index), text: s.name })),
  );
  sheet.value = String(picked !== null && sheets.some((s) => s.index === picked) ? picked : sheets[0].index);
  const layer = layerSelect("Place on", layers, activeOf(layers, layers[0].id), null);

  const v = await showDialog<{ index: number; layerId: string }>({
    title: "Worksheet on Drawing",
    okLabel: "Place",
    body: [field("Worksheet", sheet), field("Place on", layer)],
    check: () => {
      const index = Number(sheet.value);
      if (!layer.value) return { error: "Choose a layer to place it on.", focus: layer };
      return { value: { index, layerId: layer.value } };
    },
  });
  if (!v) return;
  const where = placementOn(doc.layers(), v.layerId, visibleOn(v.layerId));
  const made = attempt("Worksheet on Drawing", (s) => s.placeWorksheet(v.index, v.layerId, where.at, where.scale));
  if (made) setSelection([made.value]);
}

/** What the window shows of layer `layerId`, when it is the layer in view in plan; null otherwise. */
function visibleOn(layerId: string): { x0: number; y0: number; x1: number; y1: number } | null {
  if (layerId !== store.activeLayerId || store.view3d) return null;
  return appContext()?.view.visibleRect() ?? null;
}

/** Whether a worksheet holds a formula or a database row, so that recalculating it changes anything. */
export const canRecalculate = (): boolean => !!store.session?.doc.hasLiveWorksheets();

/** Tools > Reports > Recalculate Worksheets: works out every worksheet again from the drawing. */
export function recalculateWorksheetsNow(): void {
  const made = attempt("Recalculate Worksheets", (s) => recalculateNow(s));
  if (!made) return;
  toast(made.value > 0 ? `Worksheets recalculated: ${made.value} changed.` : "Worksheets recalculated: nothing changed.", "info");
}
