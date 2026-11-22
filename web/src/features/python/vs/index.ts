// The vs module's parts after its core (vsModule.ts): each file a family of Vectorworks' calls, as
// Python source appended to the core in this order, so a part may use the core's helpers (_S, _obj,
// _add, _mm, _host...) and those of the parts before it. A part adds what it keeps to a run's state
// with _INIT_HOOKS and what it reports with _RESULT_HOOKS; its steps are applied by its own
// ...Steps.ts file (steps.ts imports them all).

import { VS_FILES } from "./files.ts";
import { VS_MISC } from "./misc.ts";
import { VS_PLUGIN_OBJECTS } from "./pluginObjects.ts";
import { VS_PREFS } from "./prefs.ts";
import { VS_RECORDS } from "./records.ts";
import { VS_STRINGS } from "./strings.ts";
import { VS_3D } from "./threeD.ts";
import { VS_TOOL_EVENTS } from "./toolEvents.ts";
import { VS_WALLS } from "./walls.ts";
import { VS_WORKSHEETS } from "./worksheets.ts";

export const VS_PARTS: readonly string[] = [VS_PREFS, VS_FILES, VS_RECORDS, VS_3D, VS_WALLS, VS_WORKSHEETS, VS_PLUGIN_OBJECTS, VS_TOOL_EVENTS, VS_STRINGS, VS_MISC];

/** The parts' file names, in the same order. */
export const VS_PART_NAMES: readonly string[] = ["prefs", "files", "records", "threeD", "walls", "worksheets", "pluginObjects", "toolEvents", "strings", "misc"];
