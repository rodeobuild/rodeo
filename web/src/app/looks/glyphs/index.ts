// The coloured icons a look's buttons are drawn with (LookSpec.icons "color"), all four batches as
// one table by command key. Each is the inside of a 24-unit SVG painted with the look's --g-* colours
// (looks.css has Rodeo's; each look's stylesheet its own). Loaded only when such a look is chosen.
import { GLYPHS as A } from "./a.ts";
import { GLYPHS as B } from "./b.ts";
import { GLYPHS as C } from "./c.ts";
import { GLYPHS as D } from "./d.ts";

const ALL: Record<string, string> = { ...A, ...B, ...C, ...D };

// Move by Points in its copy modes (AutoCAD's COPY, Rhino's and Revit's Copy, Archicad's Drag a
// Copy) is drawn as Duplicate is, so Copy never looks like Move beside it
ALL["tool:moveby:copy"] = ALL["menu:Edit › Duplicate"];
ALL["tool:moveby:multiple"] = ALL["menu:Edit › Duplicate"];

export const GLYPHS: Readonly<Record<string, string>> = ALL;
