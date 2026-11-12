// The render layers of one picture made into files: each layer drawn (passes.ts), kept as a PNG for
// the render viewer to show, and written into one layered PSD (psd.ts), the picture at the bottom and
// the layers over it hidden, or into a zip of PNG files. The layers are named in the interface's
// language. Loaded by still.ts only when a picture asks for layers.

import type * as THREE from "three";
import { t } from "../../app/i18n.ts";
import { zipFiles } from "../../export/zip.ts";
import { FILE_ORDER, LAYER_IDS, LAYERS, RENDER_LAYER_NAME, inFileOrder, layersFileFor, type LayerId, type LayersFile } from "./layers.ts";
import { LayerPainter } from "./passes.ts";
import { PsdWriter } from "./psd.ts";
import type { RenderScene } from "./sceneBuilder.ts";

/** One layer as the viewer shows it. */
export interface RenderLayer {
  readonly id: LayerId | "render";
  readonly name: string;
  /** PNG */
  readonly blob: Blob;
}

/** A picture's layers: each to show, and the file they save as. */
export interface StillLayers {
  /** the picture first, then the layers in the Output tab's order */
  readonly list: readonly RenderLayer[];
  /** the layered PSD, or the zip of PNG files */
  readonly file: Blob;
  readonly kind: LayersFile;
}

export interface LayerJob {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: RenderScene;
  /** the picture's camera, unjittered */
  readonly camera: THREE.Camera;
  readonly ids: readonly LayerId[];
  readonly file: LayersFile;
  /** the picture as read, RGBA */
  readonly picture: ImageData;
  /** the picture as a PNG already, or null to encode it */
  readonly png: Blob | null;
  readonly encode: (pixels: ImageData) => Promise<Blob>;
  /** Cancel: no layers then */
  readonly cancelled: () => boolean;
  /** the graphics card went: the layers would be empty */
  readonly lost: () => boolean;
  /** `name` is being drawn, the `index`th of `count` */
  readonly progress: (name: string, index: number, count: number) => void;
  /** lets the page breathe between layers */
  readonly yieldTask: () => Promise<void>;
}

/** Draws the layers and makes their file; null when cancelled. Throws when the graphics card was lost. */
export async function makeLayers(job: LayerJob): Promise<StillLayers | null> {
  const { picture } = job;
  const { width, height } = picture;
  const kind = layersFileFor(job.file, width, height);
  const ids = inFileOrder(job.ids);
  const renderName = t(RENDER_LAYER_NAME);
  const psd = kind === "psd" ? new PsdWriter(width, height) : null;
  psd?.add({ name: renderName, rgba: picture.data, blend: "normal", hidden: false });
  const pngs = new Map<LayerId, Blob>();
  const painter = new LayerPainter(job.renderer, job.scene, job.camera, width, height);
  try {
    for (const [i, id] of ids.entries()) {
      if (job.cancelled()) return null;
      const name = t(LAYERS[id].name);
      job.progress(name, i, ids.length);
      await job.yieldTask();
      const pixels = painter.draw(id);
      if (job.lost()) throw new Error("the graphics card stopped while the layers were drawn (the browser lost its WebGL context): try a smaller size or fewer layers");
      psd?.add({ name, rgba: pixels.data, blend: LAYERS[id].blend, hidden: true });
      pngs.set(id, await job.encode(pixels));
    }
  } finally {
    painter.dispose();
  }
  if (job.cancelled()) return null;
  const list: RenderLayer[] = [
    { id: "render", name: renderName, blob: job.png ?? (await job.encode(picture)) },
    ...LAYER_IDS.filter((id) => pngs.has(id)).map((id): RenderLayer => ({ id, name: t(LAYERS[id].name), blob: pngs.get(id) as Blob })),
  ];
  if (psd) return { list, file: psd.finish(picture.data), kind };
  // a zip: numbered as the PSD stacks them, the picture first
  const files: [string, Uint8Array][] = [];
  const stacked = [list[0], ...FILE_ORDER.filter((id) => pngs.has(id)).map((id) => list.find((l) => l.id === id) as RenderLayer)];
  for (const [i, layer] of stacked.entries()) {
    files.push([`${String(i + 1).padStart(2, "0")} ${fileSafe(layer.name)}.png`, new Uint8Array(await layer.blob.arrayBuffer())]);
  }
  // PNGs are deflated already: stored as they are
  return { list, file: new Blob([zipFiles(files, true) as BlobPart], { type: "application/zip" }), kind };
}

/** A name a file can take on every system. */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "Layer";
}
