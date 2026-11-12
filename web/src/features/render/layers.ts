// Render layers: the pictures Render can make beside a still, each lined up with it pixel for pixel,
// for finishing the picture in Photoshop, Affinity Photo, GIMP or Photopea. Material and object
// colours are flat blocks to select by colour; shadows, ambient occlusion and lines lay over the
// picture in Multiply; base colour, depth, normals and the sky mask are for masks and effects. They
// save as one layered PSD (the picture at the bottom, the layers above it hidden) or as PNG files in a
// zip. No three.js and no DOM here: the Output tab loads this with the editor; passes.ts draws them.

export type LayerId = "material" | "object" | "shadow" | "ao" | "albedo" | "depth" | "normal" | "lines" | "sky";
/** how the layers save: one layered Photoshop file, or a PNG file each in a zip */
export type LayersFile = "psd" | "zip";
/** how a layer lays over the ones below it in the PSD */
export type LayerBlend = "normal" | "multiply";

export interface LayerKind {
  /** the layer's name, in the file and the lists */
  readonly name: string;
  /** what it shows, for the chip's tooltip */
  readonly hint: string;
  readonly blend: LayerBlend;
}

/** The layers in the order the Output tab lists them. */
export const LAYER_IDS: readonly LayerId[] = ["material", "object", "shadow", "ao", "albedo", "depth", "normal", "lines", "sky"];

export const LAYERS: Readonly<Record<LayerId, LayerKind>> = {
  material: { name: "Material colours", hint: "A flat colour for each material, to select by colour", blend: "normal" },
  object: { name: "Object colours", hint: "A flat colour for each object, to select by colour", blend: "normal" },
  shadow: { name: "Shadows", hint: "The sun's and the lights' cast shadows, white elsewhere: lay it over in Multiply", blend: "multiply" },
  ao: { name: "Ambient occlusion", hint: "The soft shade in corners and where things meet: lay it over in Multiply", blend: "multiply" },
  albedo: { name: "Base colour", hint: "The materials' own colours and textures, without light or shade", blend: "normal" },
  depth: { name: "Depth", hint: "How far each point is: white near, black far", blend: "normal" },
  normal: { name: "Normals", hint: "Which way each face points, as colour (camera space)", blend: "normal" },
  lines: { name: "Lines", hint: "Edges and creases in black on a clear layer", blend: "multiply" },
  sky: { name: "Sky mask", hint: "White where the sky shows, black over the model and the ground", blend: "normal" },
};

/** The rendered picture's own layer, at the bottom of the file. */
export const RENDER_LAYER_NAME = "Render";

/**
 * The order the layers lie in the PSD, bottom to top, the picture under them all: masks and data
 * low down, the Multiply layers on top, where they darken the picture once turned on.
 */
export const FILE_ORDER: readonly LayerId[] = ["sky", "depth", "normal", "albedo", "object", "material", "shadow", "ao", "lines"];

/**
 * The most pixels a layered PSD takes: its layers are held in memory while it is written (a 4K
 * picture with every layer is a file of a few hundred MB). A bigger picture saves its layers as PNG
 * files in a zip.
 */
export const MAX_PSD_PIXELS = 4096 * 4096;

/** The file the layers of a `width` × `height` picture save as: the choice, unless a PSD would be too big. */
export function layersFileFor(file: LayersFile, width: number, height: number): LayersFile {
  return file === "psd" && width * height > MAX_PSD_PIXELS ? "zip" : file;
}

/** The layers chosen, in file order, without repeats or unknown ids. */
export function inFileOrder(ids: readonly string[]): LayerId[] {
  return FILE_ORDER.filter((id) => ids.includes(id));
}

/** Ids read back from storage: the known ones, in the Output tab's order. */
export function layerIdsFrom(v: unknown): LayerId[] | null {
  if (!Array.isArray(v)) return null;
  return LAYER_IDS.filter((id) => v.includes(id));
}

/** The layers turned on by default: what a picture is most often finished with. */
export const DEFAULT_LAYERS: readonly LayerId[] = ["material", "object", "shadow", "ao", "depth", "lines", "sky"];
