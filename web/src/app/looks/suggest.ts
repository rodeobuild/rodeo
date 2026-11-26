// View › Work Like, offered at the moment it helps: someone who has never picked a look opens a
// file of another application (a Revit project, an AutoCAD drawing, a SketchUp model…), and a
// nudge (nudge.ts) over the drawing offers Rodeo laid out as that application, with its picture.
// Offered once: taking it puts the look on, and closing it means it is not offered again. Not on a
// phone (which keeps Rodeo's touch layout), nor in an embed or a view-only link.

import { onFileIn } from "../ext.ts";
import { nudge, withdraw, type Nudge } from "../nudge.ts";
import { toast } from "../toast.ts";
import { currentLook, LOOKS, onLookChange, setLook } from "./looks.ts";
import { lookThumb } from "./thumbs.ts";
import type { LookId } from "./types.ts";

/** Which application a file comes from, by its extension. */
const LOOK_OF: Readonly<Record<string, LookId>> = {
  vwx: "vectorworks",
  sta: "vectorworks",
  mcd: "vectorworks",
  rvt: "revit",
  rfa: "revit",
  rte: "revit",
  rft: "revit",
  dwg: "autocad",
  dxf: "autocad",
  skp: "sketchup",
  "3dm": "rhino",
  pln: "archicad",
  pla: "archicad",
  tpl: "archicad",
};

/** set once the offer has been made in this browser, whatever the answer */
const OFFERED_KEY = "openvwx.look.offered";
/** the look last chosen (looks.ts keeps it): there at all, someone has used Work Like */
const LOOK_KEY = "openvwx.look";
/** time with the drawing first: the check after a file comes in asks its question before this */
const OFFER_AFTER_MS = 6000;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // storage blocked: nothing can be remembered, so nothing is offered
    return "blocked";
  }
}

function remember(): void {
  try {
    localStorage.setItem(OFFERED_KEY, "1");
  } catch {
    // storage blocked
  }
}

/** Whether Work Like may be offered here: never used, never offered, on a computer, in the editor itself. */
function open(): boolean {
  const params = new URLSearchParams(location.search);
  return (
    currentLook() === "rodeo" &&
    stored(LOOK_KEY) === null &&
    stored(OFFERED_KEY) === null &&
    !document.documentElement.classList.contains("lk-phone") &&
    !params.has("embed") &&
    !params.has("share")
  );
}

let pending: Nudge | null = null;

export function installLookSuggestions(): void {
  onFileIn(({ name, error }) => {
    if (error || pending || !open()) return;
    const id = LOOK_OF[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];
    const look = id && LOOKS.find((l) => l.id === id);
    if (!look) return;
    const offer: Nudge = {
      art: lookThumb(look.id),
      artKind: "picture",
      title: `Used to ${look.name}?`,
      text: "Rodeo can lay out its menus, tools, words and shortcuts the way you know them. Change it any time in View › Work Like.",
      action: `Work Like ${look.name}`,
      refuse: "Not now",
      wanted: open,
      shown: remember,
      // the whole window changes: say what happened and where the way back is
      run: () => void setLook(look.id).then(() => toast("Rodeo's layout changed. Change it back any time in View › Work Like.", "info")),
    };
    pending = offer;
    window.setTimeout(() => nudge(offer), OFFER_AFTER_MS);
  });
  // a look chosen from the menu meanwhile: the offer has nothing left to say
  onLookChange(() => {
    if (pending) withdraw(pending);
  });
}
