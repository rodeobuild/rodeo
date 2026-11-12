// File > Import Site Context…: a large dialog with a Leaflet map to choose the area on (a place
// search, or a rectangle dragged out, at most 2 km × 2 km, or 10 km × 10 km signed in, imported in
// parts no larger than 2 km that meet as imports side by side do), a checklist of the kinds of context, one
// layer or a layer for each kind, and, in a drawing with no georeferencing yet, where the area's
// centre goes. The drawing's georeferencing places the import, and the first import sets it, so
// imports side by side line up. Import shows its steps and can be cancelled; the drawing gets each
// part as one undo step (commands.ts's attempt), on new design layers, the first then made active.
// An import in parts that stops part-way keeps the parts written, and Import carries on from there.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./context.css";
import { appContext } from "../../app/ext.ts";
import { attempt, setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { t, tJoined } from "../../app/i18n.ts";
import { documentGeoref, setDocumentGeoref } from "../../app/georef.ts";
import { drawingToGeo, geoToDrawing, georefThrough, type Georef } from "../../app/geoShapes.ts";
import { addSiteModelFrom } from "../../app/siteModel.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { ANCHOR_FIELD, ANCHOR_FORMAT, anchorOf, anchorText, AREA_FIELD, areaOfText, areaText } from "./anchor.ts";
import { boxCentre, boxFromCorners, boxSizeM, boxTooLarge, MAX_SIDE_M, MAX_SIGNED_IN_M, partsOf, type GeoBox } from "./geo.ts";
import { runImport, type ImportResult, type Placement } from "./importer.ts";
import type { SiteCategory } from "./model.ts";
import { DEFAULT_BUILDING_M } from "./osm.ts";
import { BusyError, searchPlaces, type Place } from "./services.ts";
import { joinReports, writeSiteContext, type WriteReport } from "./writer.ts";
import { requireSignIn } from "../account/signin.ts";
import { currentUser, onUser, refreshUser } from "../../platform/api.ts";
import type { EditSession, Pt, VwxDocument } from "../../core/index.ts";

/** The kinds of context, in the order the checklist lists them. */
const KINDS: readonly { cat: SiteCategory; label: string }[] = [
  { cat: "terrain", label: "Terrain" },
  { cat: "buildings", label: "Buildings" },
  { cat: "roads", label: "Roads" },
  { cat: "paths", label: "Paths and cycleways" },
  { cat: "rail", label: "Railways" },
  { cat: "water", label: "Water" },
  { cat: "green", label: "Green spaces" },
  { cat: "trees", label: "Trees" },
  { cat: "facilities", label: "Public facilities" },
];

const CONTOUR_INTERVALS = [1, 2, 5, 10];
const MIN_AREA_M = 5;
const SEARCH_DEBOUNCE_MS = 600;
/** how near (screen pixels) a dragged corner comes to an earlier import's edge to take it */
const SNAP_PX = 12;
const SEARCH_MIN_CHARS = 2;
/** seconds to wait before asking a busy OpenStreetMap server again, one wait for each try after the first */
const BUSY_WAITS_S = [15, 45];

/** What the area line warns of ("" for nothing), and whether signing in would clear it. */
interface Warning {
  readonly text: string;
  readonly signIn: boolean;
}
const NO_WARNING: Warning = { text: "", signIn: false };

interface Settings {
  area: GeoBox | null;
  kinds: Set<SiteCategory>;
  contourInterval: number;
  labelHeights: boolean;
  centreLines: boolean;
  placement: "origin" | "view";
  layerPerKind: boolean;
}

/** The choices made last time, for the next import (the area aside) while the page is open. */
let remembered: Omit<Settings, "area"> | null = null;

/** Opens the dialog; resolves when it closes. */
export function openSiteContextDialog(): Promise<void> {
  return new Promise((resolve) => {
    const dialog = new SiteContextDialog(() => resolve());
    dialog.open();
  });
}

class SiteContextDialog {
  private readonly done: () => void;
  private readonly settings: Settings = remembered
    ? { ...remembered, area: null, kinds: new Set(remembered.kinds) }
    : {
        area: null,
        kinds: new Set(KINDS.map((k) => k.cat)),
        contourInterval: 5,
        labelHeights: false,
        centreLines: false,
        placement: "origin",
        layerPerKind: false,
      };
  /** what earlier imports wrote into the drawing: their georeferencing and areas */
  private readonly stored = store.session ? storedImports(store.session.doc) : { georef: null, areas: [] };
  /** the drawing's georeferencing when the dialog opened (this browser's, else an earlier import's in the file) */
  private readonly known: Georef | null = documentGeoref() ?? this.stored.georef;
  /** the areas imported before, shown on the map for the next one to meet; the parts of a stopped import join them */
  private readonly earlier: GeoBox[] = [...this.stored.areas];
  /** whether someone is signed in: their areas may be larger, imported in parts */
  private signedIn = currentUser() !== null;
  private stopUser: (() => void) | null = null;
  /** a sign-in in another tab (an emailed link) is noticed when this one is looked at again */
  private readonly onFocus = (): void => {
    if (!this.signedIn) void refreshUser().catch(() => {});
  };
  private signInButton: HTMLButtonElement | null = null;
  /** an import in parts that stopped part-way: its area, the part it stopped at, the parts written and their report */
  private partial: { area: GeoBox; next: number; done: GeoBox[]; report: WriteReport } | null = null;
  private mapEl: HTMLElement | null = null;
  private readonly returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private backdrop: HTMLElement | null = null;
  private map: L.Map | null = null;
  private rect: L.Rectangle | null = null;
  /** where a bigger area divides into its parts */
  private partLines: L.LayerGroup | null = null;
  private drawing = false;
  private anchor: L.LatLng | null = null;
  private drawButton: HTMLButtonElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resultList: HTMLElement | null = null;
  private searchStatus: HTMLElement | null = null;
  private searchTimer = 0;
  private searchAbort: AbortController | null = null;
  private areaText: HTMLElement | null = null;
  private warning: HTMLElement | null = null;
  private error: HTMLElement | null = null;
  private steps: HTMLElement | null = null;
  private importButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private intervalSelect: HTMLSelectElement | null = null;
  private labelBox: HTMLInputElement | null = null;
  private centreBox: HTMLInputElement | null = null;
  /** the import in progress: its controller and the steps shown so far */
  private run: AbortController | null = null;
  private stepLabels: string[] = [];

  constructor(done: () => void) {
    this.done = done;
  }

  open(): void {
    const backdrop = h("div", { cls: "menu-dialog-backdrop sc-backdrop" });
    this.backdrop = backdrop;
    const panel = h(
      "div",
      { cls: "menu-dialog sc-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Import Site Context" } },
      h("h2", { cls: "sc-title", text: "Import Site Context" }),
      h("div", { cls: "sc-body" }, this.sidebar(), this.mapPane()),
      this.footer(),
    );
    backdrop.append(panel);
    document.body.append(backdrop);

    // every key stays inside the dialog: the window's shortcuts do not run under it
    backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (this.drawing) this.setDrawing(false);
      else if (this.run) this.cancelRun();
      else this.close();
    });
    // a click outside the box closes it, unless an import is running
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop && !this.run) this.close();
    });

    this.initMap();
    // the limit follows the account: refresh() now and whenever someone signs in or out
    this.stopUser = onUser((u) => {
      this.signedIn = u !== null;
      this.refresh();
    });
    window.addEventListener("focus", this.onFocus);
    this.searchInput?.focus();
  }

  // ---- layout -----------------------------------------------------------------

  private sidebar(): HTMLElement {
    this.searchInput = h("input", {
      cls: "menu-dialog-input sc-search",
      attrs: { type: "search", "aria-label": "Find a place", placeholder: "Find a place…", spellcheck: "false", autocomplete: "off" },
    });
    this.searchInput.addEventListener("input", () => this.onSearchInput());
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.clearTimeout(this.searchTimer);
        this.runSearch(this.searchInput?.value.trim() ?? "");
      }
    });
    this.resultList = h("ul", { cls: "sc-results", attrs: { role: "listbox", "aria-label": "Places" }, hidden: true });
    this.searchStatus = h("p", { cls: "sc-hint muted" });

    this.drawButton = h("button", {
      cls: "btn sc-draw",
      text: "Draw Area",
      attrs: { type: "button", "aria-pressed": "false" },
    });
    this.drawButton.addEventListener("click", () => this.setDrawing(!this.drawing));
    this.areaText = h("p", { cls: "sc-area" });
    this.warning = h("p", { cls: "sc-warning", attrs: { role: "status" }, hidden: true });
    this.signInButton = h("button", { cls: "btn primary sc-signin", text: "Sign In…", attrs: { type: "button" }, hidden: true });
    this.signInButton.addEventListener(
      "click",
      () => void requireSignIn(`Sign in to import areas up to ${MAX_SIGNED_IN_M / 1000} km × ${MAX_SIGNED_IN_M / 1000} km.`),
    );

    const kindRows = KINDS.map(({ cat, label }) => this.kindRow(cat, label));
    const placeRadio = (value: "origin" | "view", label: string): HTMLElement => {
      const box = h("input", { attrs: { type: "radio", name: "sc-place", value } });
      box.checked = this.settings.placement === value;
      box.addEventListener("change", () => {
        if (box.checked) this.settings.placement = value;
      });
      return h("label", { cls: "menu-dialog-check" }, box, label);
    };
    const layerRadio = (perKind: boolean, label: string): HTMLElement => {
      const box = h("input", { attrs: { type: "radio", name: "sc-layers", value: perKind ? "kind" : "one" } });
      box.checked = this.settings.layerPerKind === perKind;
      box.addEventListener("change", () => {
        if (box.checked) this.settings.layerPerKind = perKind;
      });
      return h("label", { cls: "menu-dialog-check" }, box, label);
    };
    const placing = this.known
      ? [h("p", { cls: "sc-hint muted", text: "Placed by the drawing's georeferencing, so it lines up with what is already there." })]
      : [
          placeRadio("origin", "Drawing origin (0, 0)"),
          placeRadio("view", "Current view centre"),
          h("p", { cls: "sc-hint muted", text: "This sets the drawing's georeferencing, so later imports line up with this one." }),
        ];

    return h(
      "aside",
      { cls: "sc-side" },
      h("h3", { cls: "sc-heading", text: "Find a place" }),
      this.searchInput,
      this.resultList,
      this.searchStatus,
      h("h3", { cls: "sc-heading", text: "Area" }),
      this.drawButton,
      this.areaText,
      this.warning,
      this.signInButton,
      h("h3", { cls: "sc-heading", text: "Include" }),
      ...kindRows,
      h("h3", { cls: "sc-heading", text: "Layers" }),
      layerRadio(false, "One layer, a class for each kind"),
      layerRadio(true, "A layer for each kind"),
      h("h3", { cls: "sc-heading", text: "Place the area's centre" }),
      ...placing,
      h(
        "p",
        { cls: "sc-credit muted" },
        "Data: © OpenStreetMap contributors (ODbL) through Overpass, and AWS terrain tiles. Heights are in metres, drawn at true scale.",
      ),
    );
  }

  private kindRow(cat: SiteCategory, label: string): HTMLElement {
    const box = h("input", { attrs: { type: "checkbox" } });
    box.checked = this.settings.kinds.has(cat);
    box.addEventListener("change", () => {
      if (box.checked) this.settings.kinds.add(cat);
      else this.settings.kinds.delete(cat);
      this.refresh();
    });
    const extra: HTMLElement[] = [];
    if (cat === "terrain") {
      const select = h(
        "select",
        { cls: "menu-dialog-input menu-dialog-select sc-option", attrs: { "aria-label": "Contour interval" } },
        ...CONTOUR_INTERVALS.map((m) => h("option", { value: String(m), text: `${m} m` })),
      );
      select.value = String(this.settings.contourInterval);
      select.addEventListener("change", () => {
        this.settings.contourInterval = Number(select.value);
      });
      this.intervalSelect = select;
      extra.push(h("span", { cls: "sc-sub muted", text: "contours every" }), select);
    }
    if (cat === "buildings") {
      this.labelBox = h("input", { attrs: { type: "checkbox" } });
      this.labelBox.checked = this.settings.labelHeights;
      this.labelBox.addEventListener("change", () => {
        this.settings.labelHeights = this.labelBox?.checked ?? false;
      });
      extra.push(h("label", { cls: "menu-dialog-check sc-sub" }, this.labelBox, "Label heights"));
    }
    if (cat === "roads") {
      this.centreBox = h("input", { attrs: { type: "checkbox" } });
      this.centreBox.checked = this.settings.centreLines;
      this.centreBox.addEventListener("change", () => {
        this.settings.centreLines = this.centreBox?.checked ?? false;
      });
      extra.push(h("label", { cls: "menu-dialog-check sc-sub" }, this.centreBox, "Centre lines"));
    }
    return h(
      "div",
      { cls: "sc-kind" },
      h("label", { cls: "menu-dialog-check" }, box, label),
      extra.length > 0 ? h("div", { cls: "sc-kind-options" }, ...extra) : null,
    );
  }

  private mapPane(): HTMLElement {
    const el = h("div", { cls: "sc-map", attrs: { "aria-label": "Map" } });
    this.mapEl = el;
    return el;
  }

  private footer(): HTMLElement {
    this.steps = h("ol", { cls: "sc-steps", hidden: true });
    this.error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
    this.cancelButton = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
    this.cancelButton.addEventListener("click", () => {
      if (this.run) this.cancelRun();
      else this.close();
    });
    this.importButton = h("button", { cls: "btn primary", text: "Import", attrs: { type: "button" } });
    this.importButton.addEventListener("click", () => void this.importNow());
    return h(
      "div",
      { cls: "sc-foot" },
      this.steps,
      this.error,
      h("div", { cls: "menu-dialog-actions" }, this.cancelButton, this.importButton),
    );
  }

  // ---- map ----------------------------------------------------------------------

  private initMap(): void {
    if (!this.mapEl) return;
    const map = L.map(this.mapEl, { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    this.map = map;
    // the areas imported before, for the next one to meet; the map opens on them
    if (this.earlier.length) {
      for (const b of this.earlier) this.showEarlier(b);
      const all = L.latLngBounds(this.earlier.map((b) => [b.south, b.west] as [number, number]));
      for (const b of this.earlier) all.extend([b.north, b.east]);
      map.fitBounds(all.pad(0.6));
    }
    // a drag makes the rectangle while Draw Area is on: pointer events on the map's container
    const container = map.getContainer();
    container.addEventListener("pointerdown", (e) => {
      if (!this.drawing || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      container.setPointerCapture(e.pointerId);
      this.anchor = this.snap(map.mouseEventToLatLng(e));
      this.previewArea(this.anchor, this.anchor);
    });
    container.addEventListener("pointermove", (e) => {
      if (!this.anchor) return;
      this.previewArea(this.anchor, this.snap(map.mouseEventToLatLng(e)));
    });
    container.addEventListener("pointerup", (e) => {
      if (!this.anchor) return;
      const end = this.snap(map.mouseEventToLatLng(e));
      const start = this.anchor;
      this.anchor = null;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      const box = boxFromCorners({ lat: start.lat, lon: start.lng }, { lat: end.lat, lon: end.lng });
      const { width, height } = boxSizeM(box);
      // a click without a drag keeps the area chosen before
      if (width >= MIN_AREA_M && height >= MIN_AREA_M) this.settings.area = box;
      this.setDrawing(false);
    });
  }

  /** Shows an area imported before on the map, dashed. */
  private showEarlier(b: GeoBox): void {
    if (!this.map) return;
    L.rectangle(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { color: "#6b6b6b", weight: 1, dashArray: "4 4", fillOpacity: 0.12, interactive: false },
    ).addTo(this.map);
  }

  /** A point with its latitude and longitude taken to an earlier import's edge when it is near one on screen. */
  private snap(ll: L.LatLng): L.LatLng {
    const map = this.map;
    if (!map || this.earlier.length === 0) return ll;
    const at = map.latLngToContainerPoint(ll);
    let lat = ll.lat;
    let lng = ll.lng;
    let bestY = SNAP_PX;
    let bestX = SNAP_PX;
    for (const b of this.earlier) {
      for (const edge of [b.south, b.north]) {
        const d = Math.abs(map.latLngToContainerPoint([edge, ll.lng]).y - at.y);
        if (d < bestY) {
          bestY = d;
          lat = edge;
        }
      }
      for (const edge of [b.west, b.east]) {
        const d = Math.abs(map.latLngToContainerPoint([ll.lat, edge]).x - at.x);
        if (d < bestX) {
          bestX = d;
          lng = edge;
        }
      }
    }
    return L.latLng(lat, lng);
  }

  private setDrawing(on: boolean): void {
    this.drawing = on;
    this.drawButton?.setAttribute("aria-pressed", String(on));
    if (this.drawButton) this.drawButton.textContent = on ? "Drag on the map…" : this.settings.area ? "Redraw Area" : "Draw Area";
    this.mapEl?.classList.toggle("sc-drawing", on);
    if (this.map) {
      if (on) {
        this.map.dragging.disable();
        this.map.doubleClickZoom.disable();
      } else {
        this.map.dragging.enable();
        this.map.doubleClickZoom.enable();
      }
    }
    if (!on) this.anchor = null;
    this.refresh();
  }

  /** Shows the rectangle between two corners while it is being dragged out (not yet kept). */
  private previewArea(a: L.LatLng, b: L.LatLng): void {
    const box = boxFromCorners({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    this.showRect(box);
    this.updateAreaText(box);
    this.setWarning(this.warningFor(box));
  }

  /** Takes the rectangle off the map (no area is chosen). */
  private hideRect(): void {
    this.rect?.remove();
    this.rect = null;
    this.partLines?.remove();
    this.partLines = null;
  }

  private showRect(box: GeoBox): void {
    if (!this.map) return;
    const bounds = L.latLngBounds([box.south, box.west], [box.north, box.east]);
    const tooLarge = boxTooLarge(box, this.limit());
    const style = { color: tooLarge ? "#d33" : "#2b78e4", weight: 2, fillOpacity: 0.08 };
    if (!this.rect) this.rect = L.rectangle(bounds, style).addTo(this.map);
    else {
      this.rect.setBounds(bounds);
      this.rect.setStyle(style);
    }
    // the lines between the parts it comes in, each part's east and north edge inside the area
    this.partLines?.remove();
    this.partLines = null;
    const parts = tooLarge ? [] : partsOf(box);
    if (parts.length > 1) {
      const line = { color: style.color, weight: 1, dashArray: "3 5", interactive: false };
      const lines: L.Polyline[] = [];
      for (const p of parts) {
        if (p.east < box.east) lines.push(L.polyline([[p.south, p.east], [p.north, p.east]], line));
        if (p.north < box.north) lines.push(L.polyline([[p.north, p.west], [p.north, p.east]], line));
      }
      this.partLines = L.layerGroup(lines).addTo(this.map);
    }
  }

  // ---- search -------------------------------------------------------------------

  private onSearchInput(): void {
    window.clearTimeout(this.searchTimer);
    const q = this.searchInput?.value.trim() ?? "";
    if (q.length < SEARCH_MIN_CHARS) {
      this.searchAbort?.abort();
      this.showResults([], "");
      return;
    }
    this.searchStatus?.replaceChildren();
    this.searchTimer = window.setTimeout(() => this.runSearch(q), SEARCH_DEBOUNCE_MS);
  }

  private runSearch(q: string): void {
    if (q.length < SEARCH_MIN_CHARS) return;
    this.searchAbort?.abort();
    const ctl = new AbortController();
    this.searchAbort = ctl;
    this.showResults([], "Searching…");
    searchPlaces(q, ctl.signal).then(
      (places) => {
        if (ctl.signal.aborted) return;
        this.showResults(places, places.length === 0 ? "No places found." : "");
      },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        this.showResults([], err instanceof Error ? err.message : "The place search failed.");
      },
    );
  }

  private showResults(places: readonly Place[], status: string): void {
    if (!this.resultList || !this.searchStatus) return;
    this.resultList.replaceChildren(
      ...places.map((p) => {
        const item = h("button", { cls: "sc-result", text: p.name, attrs: { type: "button", role: "option" } });
        item.addEventListener("click", () => this.goTo(p));
        return h("li", {}, item);
      }),
    );
    this.resultList.hidden = places.length === 0;
    this.searchStatus.textContent = status;
  }

  private goTo(p: Place): void {
    if (!this.map) return;
    if (p.box) this.map.fitBounds([[p.box.south, p.box.west], [p.box.north, p.box.east]]);
    else this.map.setView([p.lat, p.lon], 15);
  }

  // ---- state shown ----------------------------------------------------------------

  /** The area's size, and how many parts it comes in when it takes more than one. */
  private updateAreaText(box: GeoBox): void {
    if (!this.areaText) return;
    const { width, height } = boxSizeM(box);
    const [w, tall] = [Math.round(width), Math.round(height)];
    const parts = boxTooLarge(box, this.limit()) ? 1 : partsOf(box).length;
    this.areaText.textContent = parts > 1 ? `Area: ${w} m × ${tall} m, imported in ${parts} parts` : `Area: ${w} m × ${tall} m`;
  }

  /** The longest side an area may have, metres: longer signed in, imported in parts. */
  private limit(): number {
    return this.signedIn ? MAX_SIGNED_IN_M : MAX_SIDE_M;
  }

  /** Brings the area readout, the warning, the Draw button and the Import button into line with the settings. */
  private refresh(): void {
    const area = this.settings.area;
    if (!this.drawing) {
      if (area) {
        this.updateAreaText(area);
        this.showRect(area);
      } else {
        this.hideRect();
        if (this.areaText) this.areaText.textContent = "No area yet. Find a place, then drag Draw Area over the map.";
      }
      if (this.drawButton) this.drawButton.textContent = area ? "Redraw Area" : "Draw Area";
    }
    this.setWarning(this.settings.kinds.size === 0 ? { text: "Choose at least one kind of context.", signIn: false } : area ? this.warningFor(area) : NO_WARNING);
    if (this.intervalSelect) this.intervalSelect.disabled = !this.settings.kinds.has("terrain");
    if (this.labelBox) this.labelBox.disabled = !this.settings.kinds.has("buildings");
    if (this.centreBox) this.centreBox.disabled = !this.settings.kinds.has("roads");
    if (this.importButton) this.importButton.disabled = !this.canImport() || this.run !== null;
  }

  /** What is wrong with an area ("" when it can be imported as it is), and whether signing in would let it be. */
  private warningFor(box: GeoBox): Warning {
    if (boxTooLarge(box, this.limit())) {
      if (!this.signedIn && !boxTooLarge(box, MAX_SIGNED_IN_M)) {
        const [km, more] = [MAX_SIDE_M / 1000, MAX_SIGNED_IN_M / 1000];
        return {
          text: `Areas larger than ${km} km × ${km} km need you to sign in. Signed in, you can import up to ${more} km × ${more} km, in parts that line up.`,
          signIn: true,
        };
      }
      const km = this.limit() / 1000;
      return { text: `The area is larger than ${km} km × ${km} km. Draw a smaller one: import a bigger place in parts, and they line up.`, signIn: false };
    }
    // the parts a stopped import of this same area wrote are no overlap: Import carries on beside them
    const own = this.partial?.area === box ? this.partial.done : [];
    if (this.earlier.some((e) => !own.includes(e) && overlapping(e, box))) {
      return {
        text: "Part of this area was imported before: its buildings, trees and facilities are left out there, but its terrain, roads and water come in again. Start it at the earlier area's edge to avoid that.",
        signIn: false,
      };
    }
    return NO_WARNING;
  }

  private setWarning(w: Warning): void {
    if (this.warning) {
      this.warning.textContent = w.text;
      this.warning.hidden = w.text === "";
    }
    if (this.signInButton) this.signInButton.hidden = !w.signIn;
  }

  private canImport(): boolean {
    const area = this.settings.area;
    return area !== null && !boxTooLarge(area, this.limit()) && this.settings.kinds.size > 0 && !this.drawing;
  }

  // ---- importing ----------------------------------------------------------------

  private async importNow(): Promise<void> {
    const area = this.settings.area;
    const session = store.session;
    if (!area || !session || !this.canImport()) return;
    const run = new AbortController();
    this.run = run;
    this.stepLabels = [];
    this.renderSteps();
    this.setError("");
    this.refresh();

    const georef = this.georefFor(area);
    const place: Placement = {
      toDrawing: (p) => geoToDrawing(georef, p),
      toGeo: (p) => drawingToGeo(georef, p),
    };
    const parts = partsOf(area);
    // an import of this same area that stopped part-way carries on from the part it stopped at
    const resumed = this.partial?.area === area ? this.partial : null;
    this.partial = null;
    const done: GeoBox[] = resumed ? [...resumed.done] : [];
    let report: WriteReport | null = resumed?.report ?? null;
    let at = resumed?.next ?? 0;
    try {
      for (; at < parts.length; at++) {
        const part = parts[at];
        if (parts.length > 1) {
          this.stepLabels = [];
          this.step(`Part ${at + 1} of ${parts.length}`);
        }
        const result = await this.importPart(part, place, run.signal);
        if (run.signal.aborted) throw new Error("cancelled");
        // a part with nothing in it (open sea): the next
        if (result.features.length === 0 && (result.terrain === null || result.terrain.points.length < 3)) continue;
        this.step("Writing to the drawing");
        // one layer: every part on the first part's
        const into = report && !this.settings.layerPerKind ? report.layerId : undefined;
        const written = this.write(result, georef, part, into);
        if (!written) {
          throw new Error(
            done.length ? "The drawing could not take this part." : "The drawing could not take the context. Nothing was imported.",
          );
        }
        done.push(part);
        report = report ? joinReports(report, written) : written;
        // the drawing is placed on the Earth from now on: the next part, and the next import, line up with this one
        if (!documentGeoref()) setDocumentGeoref(georef);
        const { area: _area, ...choices } = this.settings;
        remembered = { ...choices, kinds: new Set(choices.kinds) };
      }
      if (!report) {
        this.setError("Nothing to import: this area has none of the chosen kinds in OpenStreetMap. Try a larger area or more kinds.");
        this.finishRun();
        return;
      }
      setActiveLayer(report.layerId);
      appContext()?.fit();
      this.close();
      toast(summary(report, done.length), "info");
    } catch (err) {
      const cancelled = run.signal.aborted;
      if (cancelled) this.step("Cancelled");
      const why = cancelled ? "" : err instanceof Error ? err.message : "The import failed.";
      if (report && at < parts.length) {
        // the parts written stay in the drawing, shown as imported, and Import carries on from the one that stopped
        this.partial = { area, next: at, done, report };
        for (const b of done) {
          if (this.earlier.includes(b)) continue;
          this.earlier.push(b);
          this.showEarlier(b);
        }
        const carryOn = `The parts before part ${at + 1} of ${parts.length} are in the drawing: press Import to carry on from it.`;
        // each sentence in the interface's language here: shown together, no one text would match them
        this.setError(why ? `${t(why)} ${t(carryOn)}` : carryOn);
      } else {
        this.setError(why);
      }
      this.finishRun();
    }
  }

  /** Fetches one part (the whole area when it is one), asking a busy OpenStreetMap server again after a wait. */
  private async importPart(box: GeoBox, place: Placement, signal: AbortSignal): Promise<ImportResult> {
    for (let tries = 0; ; tries++) {
      try {
        return await runImport(
          {
            box,
            kinds: this.settings.kinds,
            contourInterval: this.settings.contourInterval,
            labelHeights: this.settings.labelHeights,
            centreLines: this.settings.centreLines,
            place,
            earlier: this.earlier,
          },
          signal,
          (label, sameStep) => this.step(label, sameStep === true),
        );
      } catch (err) {
        if (!(err instanceof BusyError) || tries >= BUSY_WAITS_S.length || signal.aborted) throw err;
        await this.waitOut(BUSY_WAITS_S[tries], signal);
      }
    }
  }

  /** Counts down `seconds` in the steps; rejects when the import is cancelled. */
  private async waitOut(seconds: number, signal: AbortSignal): Promise<void> {
    for (let left = seconds; left > 0; left--) {
      this.step(`The OpenStreetMap server is busy: trying again in ${left} s`, left !== seconds);
      await new Promise<void>((resolve, reject) => {
        const stop = (): void => {
          window.clearTimeout(timer);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", stop);
          resolve();
        }, 1000);
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      });
    }
  }

  /** Where the area's centre goes: the drawing's origin, or the centre of the view. */
  private origin(): Pt {
    if (this.settings.placement === "view") {
      const view = appContext()?.view;
      if (view) return { x: view.cx, y: view.cy };
    }
    return { x: 0, y: 0 };
  }

  /**
   * The georeferencing that places the import: the drawing's, else a local one through the area's
   * centre at the origin or the view's centre, true north up.
   */
  private georefFor(area: GeoBox): Georef {
    // an earlier part of this import set the drawing's
    const known = this.known ?? documentGeoref();
    if (known) return known;
    const c = boxCentre(area);
    const at = this.origin();
    const base: Georef = { system: "local", lat: c.lat, lon: c.lon, north: 0 };
    return at.x === 0 && at.y === 0 ? base : georefThrough(base, at, c);
  }

  /** Writes an import (or a part of one, onto `intoLayer` when it has one) in one undo step; the report says what was placed. */
  private write(result: ImportResult, georef: Georef, area: GeoBox, intoLayer?: string): WriteReport | null {
    const corner = { x: result.area.x0, y: result.area.y0 };
    const fallbackClass = store.activeClassIndex;
    const layerPerKind = this.settings.layerPerKind;
    const r = attempt("Import Site Context", (s) =>
      s.batch(() => {
        const report = writeSiteContext(s, result.features, result.terrain, {
          layerName: "Site Context",
          corner,
          fallbackClass,
          layerPerKind,
          intoLayer,
          siteModel: (s2, layerId, classIndex, points, interval) => addSiteModelFrom(s2, layerId, points, { name: "Site Model", classIndex, interval }),
        });
        if (report.creditId) keepAnchor(s, report.creditId, georef, area);
        return report;
      }),
    );
    return r ? r.value : null;
  }

  private step(label: string, sameStep = false): void {
    if (sameStep && this.stepLabels.length > 0) this.stepLabels[this.stepLabels.length - 1] = label;
    else this.stepLabels.push(label);
    this.renderSteps();
  }

  private renderSteps(): void {
    if (!this.steps) return;
    const running = this.run !== null;
    this.steps.hidden = this.stepLabels.length === 0;
    this.steps.replaceChildren(
      ...this.stepLabels.map((label, i) => {
        const current = running && i === this.stepLabels.length - 1 && label !== "Cancelled";
        return h("li", { cls: current ? "sc-step current" : "sc-step done", text: label });
      }),
    );
  }

  private setError(message: string): void {
    if (!this.error) return;
    this.error.textContent = message;
    this.error.hidden = message === "";
  }

  private cancelRun(): void {
    this.run?.abort();
  }

  private finishRun(): void {
    this.run = null;
    this.refresh();
    this.renderSteps();
  }

  private close(): void {
    this.stopUser?.();
    this.stopUser = null;
    window.removeEventListener("focus", this.onFocus);
    this.searchAbort?.abort();
    window.clearTimeout(this.searchTimer);
    this.run?.abort();
    this.map?.remove();
    this.map = null;
    this.backdrop?.remove();
    this.backdrop = null;
    this.returnFocus?.focus();
    this.done();
  }
}

/** True when two boxes share more than an edge. */
function overlapping(a: GeoBox, b: GeoBox): boolean {
  const eps = 1e-9;
  return a.west < b.east - eps && b.west < a.east - eps && a.south < b.north - eps && b.south < a.north - eps;
}

/** What earlier imports wrote into the drawing: the georeferencing they were placed by, and their areas. */
function storedImports(doc: VwxDocument): { georef: Georef | null; areas: GeoBox[] } {
  const out: { georef: Georef | null; areas: GeoBox[] } = { georef: null, areas: [] };
  if (!doc.recordFormats().some((f) => f.name === ANCHOR_FORMAT)) return out;
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      const record = doc.records(o.id).find((r) => r.name === ANCHOR_FORMAT);
      if (!record) continue;
      const value = (name: string): string | null => {
        const v = record.fields.find((f) => f.name === name)?.value;
        return typeof v === "string" ? v : null;
      };
      const g = anchorOf(value(ANCHOR_FIELD) ?? "");
      if (g && !out.georef) out.georef = g;
      const area = areaOfText(value(AREA_FIELD) ?? "");
      if (area) out.areas.push(area);
    }
  }
  return out;
}

/** Writes the georeferencing and the area into a record on the import's credit, for later imports, in any browser, to meet. */
function keepAnchor(s: EditSession, id: string, g: Georef, area: GeoBox): void {
  try {
    const format =
      s.doc.recordFormats().find((f) => f.name === ANCHOR_FORMAT)?.format ??
      s.createRecordFormat(ANCHOR_FORMAT, [
        { name: ANCHOR_FIELD, kind: "text", value: "" },
        { name: AREA_FIELD, kind: "text", value: "" },
      ]);
    s.attachRecords([{ id, format, fields: { [ANCHOR_FIELD]: anchorText(g), [AREA_FIELD]: areaText(area) } }]);
  } catch {
    // a drawing that can't take the record keeps its georeferencing in this browser only
  }
}

/**
 * The toast after an import: what went in (in how many parts), and what had to be simplified, as parts joined by "; ",
 * each translated here: shown whole, "Imported {0} objects{1}{2}" would take it as one text.
 */
function summary(r: WriteReport, pieces: number): string {
  const placed = Object.values(r.placed).reduce((n, v) => n + (v ?? 0), 0);
  const parts = [
    r.layers.length > 1
      ? `Imported ${placed} ${placed === 1 ? "object" : "objects"} onto ${r.layers.length} layers`
      : `Imported ${placed} ${placed === 1 ? "object" : "objects"} onto "${r.layerName}"`,
  ];
  if (pieces > 1) parts.push(`each of the ${pieces} parts is its own undo step`);
  const built = r.buildings3d;
  if (built > 0) parts.push(`${built} ${built === 1 ? "building stands" : "buildings stand"} in 3D on the ground`);
  const guessed = r.heightsGuessed;
  if (guessed > 0) parts.push(`${guessed} ${guessed === 1 ? "has" : "have"} no height in OpenStreetMap, so ${guessed === 1 ? "it is" : "they are"} ${DEFAULT_BUILDING_M} m tall`);
  const flat = r.buildingsFlat;
  if (flat > 0) parts.push(`${flat} ${flat === 1 ? "building stays" : "buildings stay"} flat: this drawing can't make extrudes`);
  if (r.terrain === "site model") parts.push("the terrain is a site model");
  if (r.terrain === "contours") parts.push("the terrain is drawn as contour lines: this drawing can't take a site model");
  if (r.circlesAsPolygons > 0) parts.push(`${r.circlesAsPolygons} tree circles drawn as polygons (no circle in this file)`);
  if (r.outlinesSimplified > 0) parts.push("some outlines drawn as lines (no polygon in this file)");
  if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
  return tJoined(parts);
}

