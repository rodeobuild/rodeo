// File access: File System Access API when available, otherwise <input> and
// download fallbacks. Also installs window-wide drag and drop.

import { h } from "./dom.ts";
import { shell, type Shell, type ShellFile, type ShellFilter } from "../platform/shell.ts";
import { asHandle, fileFor, picked, ShellHandle, shellFilters } from "./shellFiles.ts";
import { toast } from "./toast.ts";

export interface PickedFile {
  readonly name: string;
  /** the file itself, read a slice at a time as it opens (a large one could not be read whole) */
  readonly file: Blob;
  readonly handle: FileSystemFileHandle | null;
}

export type SaveTarget = { readonly kind: "handle"; readonly handle: FileSystemFileHandle } | { readonly kind: "download" };

interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FileSystemPickers {
  showOpenFilePicker?: (options?: { types?: FilePickerType[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: FilePickerType[] }) => Promise<FileSystemFileHandle>;
}

const VWX_TYPES: FilePickerType[] = [
  { description: "Vectorworks drawing", accept: { "application/octet-stream": [".vwx"] } },
  { description: "Vectorworks template", accept: { "application/octet-stream": [".sta"] } },
];

/** A template is a drawing saved for starting others from: the same format, offered first. */
const TEMPLATE_TYPES: FilePickerType[] = [VWX_TYPES[1], VWX_TYPES[0]];

const DWG_TYPES: FilePickerType[] = [{ description: "AutoCAD drawing", accept: { "application/acad": [".dwg"] } }];
/** File > Open takes pictures too: each opens as a new drawing with the picture placed (app.ts openPicture). */
const PICTURE_TYPES: FilePickerType[] = [
  { description: "Picture", accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/gif": [".gif"], "image/webp": [".webp"], "image/bmp": [".bmp"], "image/tiff": [".tif", ".tiff"], "image/heic": [".heic", ".heif"] } },
];
/** File > Open also takes Revit files (revitFile.ts) and Archicad projects (plnImport.ts). */
const REVIT_TYPES: FilePickerType[] = [
  { description: "Revit project or family", accept: { "application/octet-stream": [".rvt", ".rfa", ".rte", ".rft"] } },
  { description: "Archicad project", accept: { "application/octet-stream": [".pln", ".pla", ".tpl"] } },
];
/** File > Open also takes STEP, IGES, 3MF and CAD part models, which come in as a drop of one does (meshImport.ts). */
const MODEL_TYPES: FilePickerType[] = [
  { description: "STEP or IGES model", accept: { "model/step": [".stp", ".step"], "model/iges": [".igs", ".iges"] } },
  { description: "3MF model", accept: { "model/3mf": [".3mf"] } },
  { description: "CAD part", accept: { "application/octet-stream": [".sldprt", ".ipt", ".fcstd", ".f3d", ".prt"] } },
];

function pickers(): FileSystemPickers {
  return window as unknown as FileSystemPickers;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function pickWithInput(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, file, handle: null });
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/**
 * Asks the user for a .vwx (or .sta template) file, templates first when `template`; File > Open
 * takes a .dwg too, which opens as a new drawing, and a Revit, Archicad, STEP or IGES file (`revit`).
 * Resolves null when the picker is cancelled.
 */
export async function pickFile(template = false, revit = false): Promise<PickedFile | null> {
  const sh = shell();
  if (sh) {
    const types = template ? TEMPLATE_TYPES : [...VWX_TYPES, ...DWG_TYPES, ...(revit ? [...REVIT_TYPES, ...MODEL_TYPES] : []), ...PICTURE_TYPES];
    const [ref] = await sh.call("file_pick_open", { filters: shellFilters(types), multiple: false });
    return ref ? await picked(ref) : null;
  }
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickWithInput(template ? ".sta,.vwx" : revit ? ".vwx,.sta,.dwg,.rvt,.rfa,.rte,.rft,.pln,.pla,.tpl,.stp,.step,.igs,.iges,.3mf,.sldprt,.ipt,.fcstd,.f3d,.prt,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif" : ".vwx,.sta,.dwg,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif");
  try {
    const [handle] = await open({ types: template ? TEMPLATE_TYPES : [...VWX_TYPES, ...DWG_TYPES, ...(revit ? [...REVIT_TYPES, ...MODEL_TYPES] : []), ...PICTURE_TYPES], multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, file, handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Asks the user for a .dwg file. Resolves null when the picker is cancelled. */
export async function pickDwg(): Promise<PickedFile | null> {
  const sh = shell();
  if (sh) {
    const [ref] = await sh.call("file_pick_open", { filters: shellFilters(DWG_TYPES), multiple: false });
    if (!ref) return null;
    return { name: ref.name, file: await fileFor(ref), handle: null };
  }
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickWithInput(".dwg");
  try {
    const [handle] = await open({ types: DWG_TYPES, multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, file, handle: null };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** A DXF file read as text. */
export interface PickedDxf {
  readonly name: string;
  readonly text: string;
  readonly file: Blob;
}

const DXF_TYPES: FilePickerType[] = [{ description: "AutoCAD DXF drawing", accept: { "application/dxf": [".dxf"] } }];

/** Reads a DXF file as UTF-8, or as Windows-1252 when it is not UTF-8 (older files often are). */
export async function readDxfText(file: Blob): Promise<string> {
  const bytes = await readBytes(file);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function pickDxfWithInput(): Promise<PickedDxf | null> {
  return new Promise((resolve, reject) => {
    const input = h("input", { attrs: { type: "file", accept: ".dxf" }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      readDxfText(file).then((text) => resolve({ name: file.name, text, file }), reject);
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/** Asks the user for a .dxf file. Resolves null when the picker is cancelled. */
export async function pickDxf(): Promise<PickedDxf | null> {
  const sh = shell();
  if (sh) {
    const [ref] = await sh.call("file_pick_open", { filters: shellFilters(DXF_TYPES), multiple: false });
    if (!ref) return null;
    const file = await fileFor(ref);
    return { name: file.name, text: await readDxfText(file), file };
  }
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickDxfWithInput();
  try {
    const [handle] = await open({ types: DXF_TYPES, multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, text: await readDxfText(file), file };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

function pickFilesWithInput(accept: string): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept, multiple: "" }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      finish();
      resolve(files.length > 0 ? files.map((file) => ({ name: file.name, file, handle: null })) : null);
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/** Asks the user for several .dwg or .dxf files at once, such as the external references a drawing needs. Resolves null when the picker is cancelled. */
export async function pickDrawingFiles(): Promise<PickedFile[] | null> {
  const sh = shell();
  if (sh) {
    const refs = await sh.call("file_pick_open", { filters: shellFilters([...DWG_TYPES, ...DXF_TYPES]), multiple: true });
    if (refs.length === 0) return null;
    return await Promise.all(refs.map(async (ref) => ({ name: ref.name, file: await fileFor(ref), handle: null })));
  }
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickFilesWithInput(".dwg,.dxf");
  try {
    const handles = await open({ types: [...DWG_TYPES, ...DXF_TYPES], multiple: true });
    if (handles.length === 0) return null;
    return await Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        return { name: file.name, file, handle: null };
      }),
    );
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Chooses where Save As writes, templates first when `template`. Falls back to a download when the picker is unavailable. */
export async function chooseSaveTarget(suggestedName: string, template = false): Promise<SaveTarget | null> {
  const sh = shell();
  if (sh) {
    const ref = await sh.call("file_pick_save", { suggestedName, filters: shellFilters(template ? TEMPLATE_TYPES : VWX_TYPES) });
    return ref ? { kind: "handle", handle: asHandle(new ShellHandle(ref)) } : null;
  }
  const save = pickers().showSaveFilePicker?.bind(window);
  if (!save) return { kind: "download" };
  try {
    const handle = await save({ suggestedName, types: template ? TEMPLATE_TYPES : VWX_TYPES });
    return { kind: "handle", handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const out = await handle.createWritable();
  try {
    await out.write(new Uint8Array(bytes));
    await out.close();
  } catch (err) {
    await out.abort().catch(() => undefined);
    throw err;
  }
}

/** The size of each piece a save in the desktop app reads a blob in and writes out. */
const SAVE_PIECE = 8 << 20;

/**
 * Asks where to save a file in the desktop app, then writes the blob there a piece at a time, so a
 * big export is never copied whole. Cancelled leaves nothing; a failure says so and leaves no
 * half-written file in place (the shell commits a write only when it is closed).
 */
async function saveWithDialog(sh: Shell, name: string, blob: Blob): Promise<void> {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
  const filters: ShellFilter[] = extension ? [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] : [];
  let ref: ShellFile | null;
  try {
    ref = await sh.call("file_pick_save", { suggestedName: name, filters });
  } catch (err) {
    toast(`Could not save ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!ref) return;
  const handle = new ShellHandle(ref);
  let out: Awaited<ReturnType<ShellHandle["createWritable"]>> | null = null;
  try {
    out = await handle.createWritable();
    for (let at = 0; at < blob.size; at += SAVE_PIECE) {
      await out.write(new Uint8Array(await blob.slice(at, at + SAVE_PIECE).arrayBuffer()));
    }
    await out.close();
  } catch (err) {
    await out?.abort().catch(() => undefined);
    toast(`Could not save ${ref.name}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  toast(`Saved ${ref.name}`, "info");
}

/**
 * Saves a file the user downloads: a browser downloads it, the desktop app asks where to save it
 * (saveWithDialog). The desktop save runs on after this returns, so a caller that marks a drawing
 * saved on return marks it before the bytes are written.
 */
export function downloadBlob(name: string, blob: Blob): void {
  const sh = shell();
  if (sh) {
    void saveWithDialog(sh, name, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { attrs: { href: url, download: name }, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A drop's file handle, in browsers that hand one over (it is asked for during the drop). */
interface HandleItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

/**
 * Calls onFile for the first file dropped anywhere in the window, with its handle
 * where the browser offers one (null otherwise) and every file dropped with it. Shows the drop
 * overlay while dragging.
 */
export function installFileDrop(onFile: (file: File, handle: Promise<FileSystemFileHandle | null>, all: readonly File[]) => void): void {
  const overlay = document.getElementById("drop-overlay");
  let depth = 0;
  const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const setOverlay = (on: boolean): void => {
    overlay?.classList.toggle("on", on);
  };
  window.addEventListener("dragenter", (e) => {
    if (!carriesFiles(e)) return;
    depth++;
    setOverlay(true);
  });
  window.addEventListener("dragleave", (e) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setOverlay(false);
  });
  window.addEventListener("dragover", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth = 0;
    setOverlay(false);
    const item = e.dataTransfer?.items[0] as (DataTransferItem & HandleItem) | undefined;
    const handle = (item?.getAsFileSystemHandle?.() ?? Promise.resolve(null)).then(
      (h) => (h?.kind === "file" ? (h as FileSystemFileHandle) : null),
      () => null,
    );
    const all = [...(e.dataTransfer?.files ?? [])];
    if (all[0]) onFile(all[0], handle, all);
  });

  const sh = shell();
  if (!sh) return;
  // in the desktop app the shell says when files are dragged over the window, and hands over the
  // files a double click, a drop on the icon or a second launch names
  sh.on("drag", (on) => setOverlay(on));
  const deliver = async (refs: readonly ShellFile[]): Promise<void> => {
    const got: { name: string; file: File; handle: FileSystemFileHandle }[] = [];
    for (const ref of refs) {
      try {
        got.push(await picked(ref));
      } catch (err) {
        console.error(err);
        toast(`Could not open ${ref.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const first = got[0];
    if (first) onFile(first.file, Promise.resolve(first.handle), got.map((g) => g.file));
  };
  sh.on("open", (refs) => {
    void deliver(refs);
  });
  // the files the app was started with, or handed over before the page was ready: after the listener above
  sh.call("pending_take", {}).then(deliver, (err: unknown) => console.error(err));
}
