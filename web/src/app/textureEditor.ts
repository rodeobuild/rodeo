// Resources > New Texture… and Edit Texture…: a texture's name, the width one repeat covers, its
// colour (a plain colour, or an image's filter colour) and its reflectivity, transparency and bump
// shaders as the drawing has them. A shader's settings the dialog doesn't name are listed as they
// are: numbers and checkboxes, labelled by the drawing's own names. A preview square follows the
// edits. OK makes one undo step; a change the core refuses shows in the dialog, which stays open.

import type { ImageTextureSpec, ShaderField, TextureShader, VwxDocument } from "../core/index.ts";
import { h } from "./dom.ts";
import { imageTextureSpec } from "./meshImport.ts";
import { showDialog } from "./menubar.ts";
import { previewPngs, previewSizes } from "./resourcePreview.ts";
import { store } from "./state.ts";
import { errorMessage } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import "./resourceEditor.css";
import "./textureEditor.css";

/** the width one repeat covers, for a new texture, mm */
const DEFAULT_SIZE_MM = 1000;
const DEFAULT_COLOUR = "#c8c8c8";
const DEFAULT_OPACITY = 50;
/** a new colour or image texture's previews, the sizes the core writes */
const NEW_PREVIEWS = [
  { width: 256, height: 256 },
  { width: 64, height: 64 },
];
/** the checkerboard's squares behind a see-through preview, canvas px */
const CHECK_PX = 6;
/** the preview square, CSS px */
const SQUARE_PX = 96;

/**
 * What a preview shows: the image, untinted, or a colour, at an opacity. An image's filter colour is
 * kept in the file but not shown, as Rodeo's 3D view does not tint by it.
 */
interface Look {
  readonly image?: ImageBitmap;
  readonly rgb: string;
  readonly alpha: number;
}

/** Paints `look` on the canvas, the image tiled `tile` px across or fitted (`fit`), over a checkerboard when see-through. */
function paintLook(canvas: HTMLCanvasElement, look: Look, tile: number | "fit"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  // the look alone first, so the checkerboard shows through it at the opacity
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const g = layer.getContext("2d");
  if (!g) return;
  if (look.image) {
    const img = look.image;
    if (tile === "fit") {
      const k = Math.min(width / img.width, height / img.height);
      g.drawImage(img, (width - img.width * k) / 2, (height - img.height * k) / 2, img.width * k, img.height * k);
    } else {
      for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) g.drawImage(img, x, y, tile, tile);
    }
  } else {
    g.fillStyle = look.rgb;
    g.fillRect(0, 0, width, height);
  }
  ctx.clearRect(0, 0, width, height);
  if (look.alpha < 1) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#d9d9d9";
    for (let y = 0; y * CHECK_PX < height; y++) for (let x = y % 2; x * CHECK_PX < width; x += 2) ctx.fillRect(x * CHECK_PX, y * CHECK_PX, CHECK_PX, CHECK_PX);
  }
  ctx.globalAlpha = look.alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
}

/** An image's bitmap, or null when the browser can't open it. */
async function decode(bytes: Uint8Array, mime: string): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime || "image/png" }));
  } catch {
    return null;
  }
}

/** The drawing's names, but `own`'s: a texture can't take one of them. */
function takenNames(doc: VwxDocument, own: number | null): Set<string> {
  return new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.stories().map((s) => s.name),
    ...doc.resources().filter((r) => r.index !== own).map((r) => r.name),
  ]);
}

/** `base`-n, the first n from `from` the drawing doesn't use. */
function freeName(taken: ReadonlySet<string>, base: string, from: number): string {
  let n = from;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A number typed in a field (a comma counts as a point), NaN when it is not one. */
function numberOf(text: string): number {
  const t = text.trim();
  return t === "" ? Number.NaN : Number(t.replace(",", "."));
}

/** The opacity a field's percentage gives, 0 to 1; 1 when it doesn't read. */
function alphaOf(text: string): number {
  const v = numberOf(text);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 1;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** New Texture…: a colour (or an image) of the size one repeat covers. */
export async function newTexture(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const units = doc.info.units;
  const taken = takenNames(doc, null);
  const nameInput = h("input", {
    cls: "menu-dialog-input re-name",
    value: freeName(taken, "Texture", 1),
    attrs: { type: "text", "aria-label": "Name", spellcheck: "false" },
  });
  const colourRadio = h("input", { attrs: { type: "radio", name: "tx-new-kind", value: "color", "aria-label": "Color" }, checked: true });
  const imageRadio = h("input", { attrs: { type: "radio", name: "tx-new-kind", value: "image", "aria-label": "Image" } });
  const colourInput = h("input", { cls: "tx-colour", value: DEFAULT_COLOUR, attrs: { type: "color", "aria-label": "Color" } });
  const fileInput = h("input", { attrs: { type: "file", accept: "image/png,image/jpeg", "aria-label": "Image" } });
  const fileName = h("span", { cls: "muted tx-file-name", text: "No image chosen" });
  const thumb = h("img", { cls: "tx-thumb", hidden: true, attrs: { alt: "" } });
  const sizeInput = h("input", {
    cls: "menu-dialog-input",
    value: formatLengthValue(DEFAULT_SIZE_MM, units),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Size", spellcheck: "false" },
  });
  const localError = h("p", { cls: "menu-dialog-error", hidden: true, attrs: { role: "alert" } });
  const preview = h("div", { cls: "tx-preview" });
  const previewImg = h("img", { cls: "tx-preview-img", hidden: true, attrs: { alt: "" } });
  preview.append(previewImg);

  let chosen: { spec: ImageTextureSpec | null; url: string } | null = null;
  let token = 0;
  // the chosen file's object URL, released when the dialog closes
  let blobUrl: string | null = null;

  const isImage = (): boolean => imageRadio.checked;
  const imageRow = h("div", { cls: "tx-image", hidden: true }, h("div", { cls: "tx-image-row" }, fileInput, thumb), fileName);
  const colourRow = h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Color" }), colourInput);

  const refresh = (): void => {
    const image = isImage() && chosen?.spec ? chosen.url : null;
    if (image) {
      preview.style.background = "";
      previewImg.src = image;
      previewImg.hidden = false;
    } else {
      previewImg.hidden = true;
      preview.style.background = isImage() ? "" : colourInput.value;
    }
  };

  const showKind = (): void => {
    colourRow.hidden = isImage();
    imageRow.hidden = !isImage();
    localError.hidden = true;
    refresh();
  };
  colourRadio.addEventListener("change", showKind);
  imageRadio.addEventListener("change", showKind);
  colourInput.addEventListener("input", refresh);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    const id = ++token;
    chosen = null;
    localError.hidden = true;
    if (!file) {
      fileName.textContent = "No image chosen";
      thumb.hidden = true;
      refresh();
      return;
    }
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      fileInput.value = "";
      fileName.textContent = "No image chosen";
      thumb.hidden = true;
      localError.textContent = "Choose a PNG or JPEG image.";
      localError.hidden = false;
      refresh();
      return;
    }
    const url = URL.createObjectURL(file);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = url;
    fileName.textContent = file.name;
    thumb.src = url;
    thumb.hidden = false;
    // the image's previews and colour are made now; the size is set on OK
    const spec = await imageTextureSpec(new Uint8Array(await file.arrayBuffer()), file.type, 1);
    if (id !== token) return;
    chosen = { spec, url };
    if (!spec) {
      localError.textContent = "This image couldn't be read.";
      localError.hidden = false;
    }
    refresh();
  });

  const body = [
    h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
    h("div", { cls: "tx-kind-row", attrs: { role: "radiogroup", "aria-label": "Color or image" } }, h("label", { cls: "tx-radio" }, colourRadio, h("span", { text: "Color" })), h("label", { cls: "tx-radio" }, imageRadio, h("span", { text: "Image" }))),
    colourRow,
    imageRow,
    h(
      "label",
      { cls: "menu-dialog-field tx-field" },
      h("span", { cls: "menu-dialog-label", text: "Size" }),
      sizeInput,
      h("span", { cls: "muted tx-unit", text: lengthSuffix(units) }),
    ),
    h("p", { cls: "muted tx-note", text: "The width one repeat of the texture covers." }),
    preview,
    localError,
  ];
  showKind();

  const result = showDialog<true>({
    title: "New Texture",
    okLabel: "OK",
    cls: "re-dialog tx-dialog",
    body,
    check: () => {
      const name = nameInput.value.trim();
      if (!name) return { error: "Enter a name for the texture.", focus: nameInput };
      if (taken.has(name)) return { error: `"${name}" is already used in this drawing.`, focus: nameInput };
      const mm = parseLength(sizeInput.value, units);
      if (mm === null || !(mm > 0)) return { error: "Enter a size above 0.", focus: sizeInput };
      const s = store.session;
      if (!s) return { error: "No drawing is open." };
      try {
        if (isImage()) {
          if (!chosen) return { error: "Choose a PNG or JPEG image.", focus: fileInput };
          if (!chosen.spec) return { error: "This image couldn't be read.", focus: fileInput };
          s.addImageTexture(name, { ...chosen.spec, size: mm });
        } else {
          const rgb = colourInput.value;
          const pngs = previewPngs(NEW_PREVIEWS, (c) => paintLook(c, { rgb, alpha: 1 }, "fit"));
          s.createColorTexture(name, rgb, mm, { large: pngs.get(256)!, small: pngs.get(64)! });
        }
      } catch (err) {
        return { error: errorMessage(err) };
      }
      return { value: true };
    },
  });
  await result;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
}

/** One shader's part of the Edit Texture dialog: its head (title, kind, Remove or Undo) and its settings. */
interface Section {
  readonly family: TextureShader["family"];
  readonly shader: TextureShader | undefined;
  /** whether it can be removed (the colour shader can't) */
  readonly removable: boolean;
  /** marked for removal on OK */
  removed: boolean;
  readonly status: HTMLElement;
  readonly removeBtn: HTMLButtonElement | null;
  readonly undoBtn: HTMLButtonElement | null;
  readonly body: HTMLElement;
  /** what a texture without the shader shows instead of its settings, if anything */
  readonly none: HTMLElement | null;
  readonly el: HTMLElement;
}

/** A shader setting as the dialog edits it: its input, and the field it came from. */
interface FieldRow {
  readonly family: TextureShader["family"];
  readonly field: ShaderField;
  readonly input: HTMLInputElement;
}

/**
 * Edit Texture…: the texture `index`'s name, size, colour, and its reflectivity, transparency and
 * bump shaders. OK applies only what changed, as one undo step.
 */
export async function editTexture(index: number): Promise<void> {
  const s0 = store.session;
  const doc = s0?.doc;
  if (!s0 || !doc) return;
  const res = doc.resources().find((r) => r.kind === "texture" && r.index === index);
  if (!res) return;
  const shaders = doc.textureShaders(index);
  const shaderOf = (f: TextureShader["family"]): TextureShader | undefined => shaders.find((x) => x.family === f);
  const colourShader = shaderOf("color");
  const pickerKind = colourShader?.kind === "Plain" || colourShader?.kind === "Image" ? colourShader.kind : null;
  const units = doc.info.units;
  const uses = doc.textureUses(index);
  const taken = takenNames(doc, index);
  const bitmap = res.image ? await decode(res.image, res.imageMime ?? "image/png") : null;
  const imageUrl = res.image ? URL.createObjectURL(new Blob([new Uint8Array(res.image)], { type: res.imageMime ?? "image/png" })) : null;
  const rgb0 = (res.shaders?.color?.rgb ?? DEFAULT_COLOUR).toLowerCase();
  const sizeStart = res.imageSize && res.imageSize > 0 ? formatLengthValue(res.imageSize, units) : "";
  const rows: FieldRow[] = [];

  const nameInput = h("input", { cls: "menu-dialog-input re-name", value: res.name, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const sizeInput = h("input", { cls: "menu-dialog-input", value: sizeStart, attrs: { type: "text", inputmode: "decimal", "aria-label": "Size", spellcheck: "false" } });
  const colourInput = h("input", { cls: "tx-colour", value: rgb0, attrs: { type: "color", "aria-label": pickerKind === "Image" ? "Filter color" : "Color" } });
  const preview = h("canvas", { cls: "tx-preview-canvas", attrs: { width: String(SQUARE_PX), height: String(SQUARE_PX), role: "img", "aria-label": "Preview" } });

  // the transparency's opacity, as a Plain one shows it, and as a new Plain one takes it
  const opacityStart = shaderOf("transparency")?.kind === "Plain" ? String(Math.round((res.shaders?.transparency?.percent ?? DEFAULT_OPACITY) * 100) / 100) : "";
  const opacityPlain = h("input", { cls: "menu-dialog-input", value: opacityStart, attrs: { type: "text", inputmode: "decimal", "aria-label": "Opacity %", spellcheck: "false" } });
  const opacityNone = h("input", { cls: "menu-dialog-input", value: String(DEFAULT_OPACITY), attrs: { type: "text", inputmode: "decimal", "aria-label": "Opacity %", spellcheck: "false" } });
  opacityNone.disabled = true;
  const plainChk = h("input", { attrs: { type: "checkbox", "aria-label": "Plain transparency" } });

  const refresh = (): void => {
    const tr = sections.find((x) => x.family === "transparency");
    let alpha = 1;
    if (tr && !tr.removed) {
      if (tr.shader) alpha = tr.shader.kind === "Plain" ? alphaOf(opacityPlain.value) : 1;
      else if (plainChk.checked) alpha = alphaOf(opacityNone.value);
    }
    const look: Look = { image: pickerKind === "Image" ? (bitmap ?? undefined) : undefined, rgb: colourInput.value, alpha };
    paintLook(preview, look, 48);
  };
  colourInput.addEventListener("input", refresh);
  opacityPlain.addEventListener("input", refresh);
  opacityNone.addEventListener("input", refresh);
  plainChk.addEventListener("change", () => {
    opacityNone.disabled = !plainChk.checked;
    refresh();
  });

  /** A field's row: its label (the drawing's own name, Rodeo's name for it, or "Setting <n>") and its input. */
  const fieldEl = (family: TextureShader["family"], f: ShaderField): HTMLElement => {
    const label = f.name.trim() ? f.name : `Setting ${f.index}`;
    let input: HTMLInputElement;
    if (f.kind === "boolean") {
      input = h("input", { attrs: { type: "checkbox", "aria-label": label } });
      input.checked = f.value === true;
    } else {
      input = h("input", {
        cls: "menu-dialog-input",
        value: String(f.value),
        attrs: { type: "text", inputmode: f.kind === "integer" ? "numeric" : "decimal", "aria-label": label, spellcheck: "false" },
      });
    }
    rows.push({ family, field: f, input });
    input.addEventListener("input", refresh);
    input.addEventListener("change", refresh);
    // the drawing's names are not translated; Rodeo's own are
    return h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: label, attrs: f.named ? { translate: "no" } : {} }), input);
  };

  /** The settings the dialog doesn't show as a colour or opacity, the fields of a kind it can edit. */
  const fieldsOf = (family: TextureShader["family"], shader: TextureShader | undefined): HTMLElement[] => {
    if (!shader) return [];
    return shader.fields
      .filter((f) => {
        if (f.kind !== "integer" && f.kind !== "boolean" && f.kind !== "number" && f.kind !== "dimension") return false;
        if (family === "color" && shader.kind === "Plain") return f.index < 3 || f.index > 5;
        if (family === "color" && shader.kind === "Image") return f.index < 5 || f.index > 7;
        if (family === "transparency" && shader.kind === "Plain") return f.index !== 3;
        return true;
      })
      .map((f) => fieldEl(family, f));
  };

  const sections: Section[] = [];
  const section = (title: string, family: TextureShader["family"], shader: TextureShader | undefined, removable: boolean, body: Node[], none: HTMLElement | null): void => {
    const status = h("span", { cls: "tx-kind" });
    const removeBtn = removable ? h("button", { cls: "btn small", text: "Remove", attrs: { type: "button" } }) : null;
    const undoBtn = removable ? h("button", { cls: "btn small", text: "Undo", attrs: { type: "button" } }) : null;
    const bodyEl = h("div", { cls: "tx-body" }, ...body);
    const el = h(
      "section",
      { cls: "tx-section", attrs: { "data-family": family } },
      h("div", { cls: "tx-head" }, h("span", { cls: "tx-title", text: title }), status, h("span", { cls: "tx-actions" }, undoBtn, removeBtn)),
      bodyEl,
      none,
    );
    const sec: Section = { family, shader, removable, removed: false, status, removeBtn, undoBtn, body: bodyEl, none, el };
    removeBtn?.addEventListener("click", () => {
      sec.removed = true;
      sync();
      refresh();
    });
    undoBtn?.addEventListener("click", () => {
      sec.removed = false;
      sync();
      refresh();
    });
    sections.push(sec);
  };

  const sync = (): void => {
    for (const sec of sections) {
      const has = sec.shader !== undefined;
      const kept = has && !sec.removed;
      sec.status.textContent = sec.removed ? "None (removed on OK)" : has ? sec.shader!.kind : "None";
      sec.status.setAttribute("translate", kept ? "no" : "yes");
      sec.body.hidden = !kept;
      if (sec.none) sec.none.hidden = has || sec.removed;
      if (sec.removeBtn) sec.removeBtn.hidden = !kept;
      if (sec.undoBtn) sec.undoBtn.hidden = !sec.removed;
    }
  };

  // colour: a Plain colour's picker, an Image's thumbnail and filter colour, or another kind's settings as they are
  const colourBody: Node[] = [];
  if (pickerKind === "Plain") colourBody.push(h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Color" }), colourInput));
  if (pickerKind === "Image") {
    if (imageUrl) colourBody.push(h("img", { cls: "tx-thumb", attrs: { src: imageUrl, alt: "" } }));
    colourBody.push(h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Filter color" }), colourInput));
    colourBody.push(h("p", { cls: "muted tx-note", text: "Kept in the file. Rodeo doesn't tint the image by it." }));
  }
  if (colourShader && !pickerKind) colourBody.push(h("p", { cls: "muted tx-note", text: "This shader's settings are kept as they are" }));
  colourBody.push(...fieldsOf("color", colourShader));
  section("Color", "color", colourShader, false, colourBody, null);

  const reflectivity = shaderOf("reflectivity");
  section("Reflectivity", "reflectivity", reflectivity, true, fieldsOf("reflectivity", reflectivity), null);

  // transparency: a Plain one's opacity; with none, a Plain one can be added at an opacity
  const transparency = shaderOf("transparency");
  const transBody: Node[] = [];
  if (transparency?.kind === "Plain") transBody.push(h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Opacity %" }), opacityPlain));
  transBody.push(...fieldsOf("transparency", transparency));
  const transNone = h(
    "div",
    { cls: "tx-none" },
    h("label", { cls: "menu-dialog-field tx-field" }, plainChk, h("span", { cls: "menu-dialog-label", text: "Plain transparency" })),
    h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Opacity %" }), opacityNone),
  );
  section("Transparency", "transparency", transparency, true, transBody, transNone);

  const bump = shaderOf("bump");
  section("Bump", "bump", bump, true, fieldsOf("bump", bump), null);
  sync();

  const usesText = `Used by ${plural(uses.objects, "object", "objects")} and ${plural(uses.classes, "class", "classes")}`;
  const body: Node[] = [
    h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
    h("p", { cls: "muted tx-uses", text: usesText }),
    h("label", { cls: "menu-dialog-field tx-field" }, h("span", { cls: "menu-dialog-label", text: "Size" }), sizeInput, h("span", { cls: "muted tx-unit", text: lengthSuffix(units) })),
    ...sections.map((x) => x.el),
    h("div", { cls: "tx-preview-row" }, preview),
  ];
  refresh();

  const plan = (): { name: string; mm: number | null; rgb: string | null; opacity: number | null; fields: { family: TextureShader["family"]; index: number; value: number | boolean }[]; removals: TextureShader["family"][] } | { error: string; focus: HTMLElement } => {
    const fail = (error: string, focus: HTMLElement): { error: string; focus: HTMLElement } => ({ error, focus });
    const name = nameInput.value.trim();
    if (!name) return fail("Enter a name for the texture.", nameInput);
    if (name !== res.name && taken.has(name)) return fail(`"${name}" is already used in this drawing.`, nameInput);
    let mm: number | null = null;
    if (sizeInput.value !== sizeStart) {
      mm = parseLength(sizeInput.value, units);
      if (mm === null || !(mm > 0)) return fail("Enter a size above 0.", sizeInput);
    }
    const rgb = pickerKind && colourInput.value !== rgb0 ? colourInput.value : null;
    const removals = sections.filter((x) => x.removable && x.removed && x.shader).map((x) => x.family);
    const fields: { family: TextureShader["family"]; index: number; value: number | boolean }[] = [];
    for (const row of rows) {
      if (removals.includes(row.family)) continue;
      const f = row.field;
      const label = f.name.trim() ? f.name : `Setting ${f.index}`;
      if (f.kind === "boolean") {
        if (row.input.checked !== f.value) fields.push({ family: row.family, index: f.index, value: row.input.checked });
        continue;
      }
      if (row.input.value === String(f.value)) continue;
      const v = numberOf(row.input.value);
      if (!Number.isFinite(v)) return fail(`${label} takes a number.`, row.input);
      if (f.kind === "integer" && !Number.isInteger(v)) return fail(`${label} takes a whole number.`, row.input);
      fields.push({ family: row.family, index: f.index, value: v });
    }
    // the opacity: a Plain one's, or the one a new Plain transparency takes
    let opacity: number | null = null;
    const tr = sections.find((x) => x.family === "transparency")!;
    if (!tr.removed && tr.shader?.kind === "Plain" && opacityPlain.value !== opacityStart) {
      const v = numberOf(opacityPlain.value);
      if (!(v >= 0 && v <= 100)) return fail("Opacity % takes a number from 0 to 100.", opacityPlain);
      opacity = v;
    }
    if (!tr.removed && !tr.shader && plainChk.checked) {
      const v = numberOf(opacityNone.value);
      if (!(v >= 0 && v <= 100)) return fail("Opacity % takes a number from 0 to 100.", opacityNone);
      opacity = v;
    }
    return { name, mm, rgb, opacity, fields, removals };
  };

  const result = showDialog<true>({
    title: "Edit Texture",
    okLabel: "OK",
    cls: "re-dialog tx-dialog",
    body,
    check: () => {
      const p = plan();
      if ("error" in p) return p;
      const s = store.session;
      if (!s) return { error: "No drawing is open." };
      const colourChanged = p.rgb !== null;
      const trRemoved = p.removals.includes("transparency");
      const transparencyChanged = trRemoved || p.opacity !== null;
      const nothing = p.name === res.name && p.mm === null && !colourChanged && !p.fields.length && !p.removals.length && p.opacity === null;
      if (nothing) return { value: true };
      // the previews follow the look, when it changed: a Plain colour's, and any transparency's; an image's filter colour is not shown, so it does not repaint them
      const tr = sections.find((x) => x.family === "transparency")!;
      let alpha = 1;
      if (!trRemoved) {
        if (p.opacity !== null) alpha = p.opacity / 100;
        else if (tr.shader?.kind === "Plain") alpha = alphaOf(opacityPlain.value);
      }
      const rgbNow = p.rgb ?? rgb0;
      const canPaint = pickerKind === "Plain" || (pickerKind === "Image" && bitmap !== null);
      try {
        s.batch(() => {
          if (p.name !== res.name) s.renameResource(index, p.name);
          if (p.mm !== null) s.setTextureSize(index, p.mm);
          if (colourChanged) s.setTextureColor(index, rgbNow);
          for (const f of p.fields) s.setShaderField(index, f.family, f.index, f.value);
          for (const family of p.removals) s.removeTextureShader(index, family as "reflectivity" | "transparency" | "bump");
          if (p.opacity !== null) s.setTextureOpacity(index, p.opacity);
          if (((pickerKind === "Plain" && colourChanged) || transparencyChanged) && canPaint) {
            const pngs = previewPngs(previewSizes(doc, "texture", res), (c) => paintLook(c, { image: pickerKind === "Image" ? (bitmap ?? undefined) : undefined, rgb: rgbNow, alpha }, "fit"));
            s.setTexturePreviews(index, pngs);
          }
        });
      } catch (err) {
        return { error: errorMessage(err) };
      }
      return { value: true };
    },
  });
  await result;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  bitmap?.close();
}
