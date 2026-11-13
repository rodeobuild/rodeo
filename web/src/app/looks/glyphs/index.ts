// The coloured icons a look's buttons are drawn with (LookSpec.icons "color"), all four batches as
// one table by command key. Each is the inside of a 24-unit SVG painted with the look's --g-* colours
// (looks.css has Rodeo's; each look's stylesheet its own). Loaded only when such a look is chosen.
import { GLYPHS as A } from "./a.ts";
import { GLYPHS as B } from "./b.ts";
import { GLYPHS as C } from "./c.ts";
import { GLYPHS as D } from "./d.ts";

export const GLYPHS: Readonly<Record<string, string>> = { ...A, ...B, ...C, ...D };
