// Vectorworks' Space objects in Object Info: their parameters a group at a time (driverLayout.ts),
// and a change to them draws the Space again Rodeo's way (draw.ts), as one undo step. A Space
// Vectorworks made shows as it drew it until a change here draws it again; Reshape moves its corners
// (the boundary in its path group) and draws it again. Spaces are made with the Space tool.

import type { RecordValue } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { registerPluginDrivers, type PluginDriver } from "../ext.ts";
import { store } from "../state.ts";
import { errorMessage, toast } from "../toast.ts";
import { drawSpace, reshapeSpace } from "./draw.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatArea, formatLength } from "../units.ts";
import { isComputed, LABEL_FIELDS_BUTTON, spaceChoices, spaceLabel, spaceLayout } from "./driverLayout.ts";
import { extraFields, LABEL_FIELD_CHOICES, setExtraFields } from "./label.ts";
import { F, netBoundaryOf, ownUnits, SPACE, setSpaceValues, spaceOf } from "./model.ts";
import { refitSpace } from "./refit.ts";

/** Why `values` can't be set on a Space, or null. */
function refusal(values: Readonly<Record<string, RecordValue>>): string | null {
  const height = values[F.height];
  if (typeof height === "number" && height < 0) return "A space's height can't be negative.";
  return null;
}

/** Object Info's Label Fields…: which other parameters the Space's label lists under its name and number. */
async function labelFieldsDialog(id: string): Promise<void> {
  const doc = store.session?.doc;
  const sp = doc ? spaceOf(doc, id) : null;
  if (!doc || !sp) return;
  const chosen = new Set(extraFields(doc, id));
  const offered = LABEL_FIELD_CHOICES.filter((c) => sp.has(c.name));
  const v = await toolPrefs(
    "Label Fields",
    offered.map((c) => ({ kind: "check" as const, key: c.name, label: c.label, value: chosen.has(c.name) })),
    "The label lists each chosen field that has a value, under the name and number, and follows the data. The choice is kept in a Space Label record on the space.",
  );
  if (!v) return;
  const fields = offered.filter((c) => v.flag(c.name)).map((c) => c.name);
  attempt("Label Fields", (s) =>
    s.batch(() => {
      setExtraFields(s, id, fields);
      if (fields.length) setSpaceValues(s, id, { [F.showLabel]: true });
      drawSpace(s, id, { attrs: store.drawAttrs });
    }),
  );
}

export const driver: PluginDriver = {
  name: SPACE,
  shape: "point",
  builtIn: true,
  note: "A Space made by Vectorworks shows as Vectorworks drew it until a change here draws it again Rodeo's way.",
  resets: false,
  label: spaceLabel,
  readOnly: isComputed,
  choices: spaceChoices,
  place() {
    toast("Draw a space with the Space tool (Space Planning) to make one.", "info");
  },
  edit(id, values) {
    const why = refusal(values);
    if (why) {
      toast(why);
      return;
    }
    attempt("Edit Space", (s) =>
      s.batch(() => {
        const followed = spaceOf(s.doc, id)?.flag(F.autoBoundary) === true;
        setSpaceValues(s, id, values);
        // Follow Walls switched on: it takes the room its walls close now, if they close one
        if (values[F.autoBoundary] === true && !followed && refitSpace(s, id, store.drawAttrs)) return;
        drawSpace(s, id, { attrs: store.drawAttrs, heights: F.height in values || F.floorToFloor in values });
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawSpace(s, id, { attrs: store.drawAttrs }));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: (_ready, rec) => (rec ? spaceLayout(rec.fields.map((f) => f.name)) : null),
  display(field, value, kind) {
    const units = store.session?.doc.info.units;
    const v = Number(value);
    if (!Number.isFinite(v)) return undefined;
    const own = ownUnits(units);
    // areas and volumes are kept in mm² and mm³, or as plain numbers in the drawing's own units (2023); Length and Width in metres
    if (field === F.area || field === F.grossArea || field === "MeasuredNetAreaNum") return formatArea(kind === "area" ? v : v * own.area, units);
    if (field === F.volume || field === F.grossVolume) return `${String(Number(((kind === "volume" ? v : v * own.volume) / own.volume).toFixed(2)))} ${own.volumeName}`;
    if (field === F.length || field === F.width) return formatLength(v * 1000, units);
    return undefined;
  },
  widgetStates: () => {},
  press(id, widget) {
    if (widget === LABEL_FIELDS_BUTTON) void labelFieldsDialog(id);
  },
  path(id) {
    const doc = store.session?.doc;
    const points = doc ? netBoundaryOf(doc, id) : null;
    return points ? { points, closed: true } : null;
  },
  setPath(s, id, corners) {
    // a boundary moved by hand no longer follows its walls
    setSpaceValues(s, id, { [F.autoBoundary]: false });
    reshapeSpace(s, id, corners, { attrs: store.drawAttrs });
  },
};

registerPluginDrivers(() => [driver]);
