// The converter's pages (rodeo.build/convert, its pairs /convert/<from>-to-<to>, the file viewers at
// /viewer and /viewer/<id>): the formats they name, the pairs of formats that have a page, the viewer
// pages, and the words each page shows. It has no imports, because the server reads it too
// (server/src/convertPage.ts) and Node runs it as it is.

/** How a format is laid out: a drawing of Rodeo's own, 2D line work, or 3D objects. Matches FormatInfo.kind in formats.ts. */
export type FormatKind = "drawing" | "2d" | "3d";

/** A format as the converter's pages describe it. */
export interface PageFormat {
  readonly id: string;
  /** the name in the headline and the tables, upper case */
  readonly short: string;
  /** the name in the description and the formats table */
  readonly long: string;
  /** the app people name when they ask whether they need it */
  readonly app: string;
  /** the extensions the page names; the first one is the usual one */
  readonly extensions: readonly string[];
  readonly read: boolean;
  readonly write: boolean;
  readonly kind: FormatKind;
  /** what Rodeo reads in this format, one or two sentences; empty when it doesn't read it */
  readonly reads: string;
  /** what Rodeo writes in this format, one or two sentences; empty when it doesn't write it */
  readonly writes: string;
  /** the releases of the format Rodeo reads, when the notes say which ones */
  readonly versions?: string;
  /** what is left out when Rodeo reads the format, when it is known */
  readonly readLimits?: string;
  /** what the written file keeps, as a clause after "On the way out," */
  readonly keeps?: string;
  /** what is left out of the written file */
  readonly writeLimits?: string;
  /** an honest note on whether other apps are known to open what Rodeo writes */
  readonly openNote?: string;
}

/** A page's file viewer: the page at /viewer/<id>, whose facts come from the format with that id. */
export interface ViewerPage {
  /** the format's id, which is also the address's last part */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  /** two or three sentences */
  readonly intro: string;
}

/** A link on a page: its address and the text it shows. */
export interface PageLink {
  readonly path: string;
  readonly label: string;
}

/** A titled part of the text under a page's intro: paragraphs, numbered steps or a bulleted list. */
export interface PageSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly steps?: readonly string[];
  readonly items?: readonly string[];
}

/** One question and its answer. The answer may put `code` in backticks. */
export interface PageQuestion {
  readonly q: string;
  readonly a: string;
}

/** One step of the breadcrumb trail: its name and address. */
export interface PageCrumb {
  readonly name: string;
  readonly path: string;
}

/** One page of the converter or the viewer: its address, its text, and the pages it links to. */
export interface ConvertPage {
  readonly kind: "index" | "pair" | "viewer" | "viewer-index";
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  readonly intro: string;
  /** the input format's id, or null on an index page */
  readonly from: string | null;
  /** the output format's id, or null on an index or viewer page */
  readonly to: string | null;
  readonly crumbs: readonly PageCrumb[];
  /** the text between the intro and the links: each part with a heading */
  readonly sections: readonly PageSection[];
  /** links to related pages, shown in a list under the sections */
  readonly see: readonly PageLink[];
  readonly faq: readonly PageQuestion[];
  readonly linksTitle: string;
  readonly links: readonly PageLink[];
}

/** The part-file limits shared by the CAD part formats, which cadmpeg reads. */
const CAD_PART_LIMITS =
  "Colours mostly don't come through, so most parts come in grey. An assembly points at part files that aren't with it, and a file of only sketches or drawings is refused. cadmpeg is young, so some parts come in missing faces: check a part against its app.";

/** Every format a page can name, with what Rodeo reads and writes in it. The read and write flags and the kinds match web/src/convert/formats.ts. */
export const PAGE_FORMATS: readonly PageFormat[] = [
  {
    id: "vwx",
    short: "VWX",
    long: "Vectorworks",
    app: "Vectorworks",
    extensions: ["vwx", "sta"],
    read: true,
    write: true,
    kind: "drawing",
    reads: "Rodeo opens Vectorworks drawings natively: layers, classes, symbols, records and 3D objects.",
    writes: "A Vectorworks .vwx drawing with its layers, classes and 3D objects.",
    versions:
      "Files saved by Vectorworks 2020 or later open as they are. Files saved by 2018 and 2019 come in whole, 2D and 3D, with their images, worksheets and textures. Files in the 2013, 2016 and 2017 formats are converted to the current format as they open. No file saved by 2014 or 2015 has been tested, and files from before 2013 are refused.",
    readLimits:
      "The data attached to objects, such as record fields and plug-in settings, isn't read from 2018 and 2019 files, and nor are wall and slab styles. From the 2013, 2016 and 2017 formats, images, worksheets and textures aren't read either.",
    keeps: "the layers and classes are kept",
    openNote: "A drawing converted to .vwx is built on Rodeo's blank drawing, which Vectorworks hasn't been confirmed to open.",
  },
  {
    id: "dwg",
    short: "DWG",
    long: "AutoCAD DWG",
    app: "AutoCAD",
    extensions: ["dwg"],
    read: true,
    write: false,
    kind: "2d",
    reads: "Rodeo reads AutoCAD DWG files from every release from R13 to the 2018 format: lines, arcs, polylines, text, hatches and blocks, each AutoCAD layer becoming a class, with colours and line weights.",
    writes: "",
    versions: "Every release from R13 to the 2018 format, which AutoCAD still saves. Rodeo reads a DWG without saving it as DXF first.",
    readLimits:
      "Images, underlays, wipeouts and objects of AutoCAD's vertical apps are left out. A drawing of more than 500,000 objects, counting every copy of a block, isn't read. In the converter's output, line types draw solid.",
  },
  {
    id: "dxf",
    short: "DXF",
    long: "DXF",
    app: "a CAD app",
    extensions: ["dxf"],
    read: true,
    write: true,
    kind: "2d",
    reads: "Rodeo reads DXF files: lines, arcs, polylines, splines, text, hatches and blocks, each layer becoming a class, with colours and line weights.",
    writes: "A DXF file in millimetres that AutoCAD, BricsCAD, LibreCAD and most CAD apps open.",
    readLimits: "Only the objects listed above are read, and other kinds of object are left out. Dashed line types draw solid in the converter's output.",
    keeps: "the layers are kept as DXF layers",
  },
  {
    id: "pdf",
    short: "PDF",
    long: "PDF",
    app: "a PDF reader",
    extensions: ["pdf"],
    read: true,
    write: true,
    kind: "2d",
    reads: "Rodeo reads a PDF page's vector line work, fills and text; pictures, shadings and clipping are left out.",
    writes: "A vector PDF, a page per layer at its scale.",
    readLimits:
      "Pictures, shadings and clipping are left out, and encrypted files are refused. The converter reads one page, and the command line's --page option chooses which.",
    keeps: "each layer is its own page",
  },
  {
    id: "svg",
    short: "SVG",
    long: "SVG",
    app: "a drawing app",
    extensions: ["svg"],
    read: false,
    write: true,
    kind: "2d",
    reads: "",
    writes: "An SVG of the plan in millimetres, for the web and illustration apps.",
    keeps: "the plan is drawn as one picture",
  },
  {
    id: "eps",
    short: "EPS",
    long: "EPS",
    app: "a print app",
    extensions: ["eps"],
    read: false,
    write: true,
    kind: "2d",
    reads: "",
    writes: "An EPS of the plan for print and illustration apps; pictures are left out.",
    writeLimits: "Images and drop shadows are left out.",
    keeps: "the plan is drawn as one picture",
  },
  {
    id: "emf",
    short: "EMF",
    long: "EMF",
    app: "an Office app",
    extensions: ["emf"],
    read: true,
    write: true,
    kind: "2d",
    reads: "Rodeo reads a Windows metafile's line work, fills and text.",
    writes: "A Windows metafile of the plan, for Office documents.",
    readLimits: "Pictures, hatched fills and clipping are left out, and dashes are drawn solid.",
    keeps: "the plan is drawn as one picture",
  },
  {
    id: "rvt",
    short: "RVT",
    long: "Revit",
    app: "Revit",
    extensions: ["rvt"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads a Revit project's levels, walls, floors, doors, windows and other elements with their parameters, with the open-source rvt-rs reader.",
    writes: "",
    versions:
      "Checked on Autodesk's sample projects saved by Revit 2015, 2017, 2019, 2021, 2023, 2024, 2025 and 2027, and on projects saved by Revit 2024 and 2026 of up to 95 MB. Other releases may open, but they haven't been checked.",
    readLimits:
      "Walls come in without their layers. Doors and windows are cut into their walls rather than made as door and window objects. An element whose geometry isn't read yet comes in as a see-through box, and the preview says how many.",
  },
  {
    id: "pln",
    short: "PLN",
    long: "Archicad",
    app: "Archicad",
    extensions: ["pln", "pla", "tpl"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads Archicad projects, archives and templates: stories, walls, slabs, doors, windows, objects and drafting.",
    writes: "",
    versions: "Archicad 25 to 29, saved as .pln, .pla or .tpl files.",
    readLimits:
      "Doors, windows and objects come in at their size as see-through boxes. Shells, stairs' and railings' 3D and cameras aren't brought in, and the section and elevation cuts Archicad makes from the model aren't read.",
  },
  {
    id: "ifc",
    short: "IFC",
    long: "IFC",
    app: "a BIM app",
    extensions: ["ifc"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads IFC models: each element a mesh named after it, grouped by building storey.",
    writes: "An IFC4 model: each object a wall, slab, door, window or other element on its storey, with its records as property sets.",
    versions: "IFC2X3, IFC4 and IFC4X3 files, in the file's own units.",
    readLimits: "Spaces are left out and counted. Elements come in as meshes, not as walls, slabs or doors, and their property sets aren't carried over.",
    keeps: "each layer becomes a storey",
    writeLimits: "Materials and openings aren't carried over.",
  },
  {
    id: "skp",
    short: "SKP",
    long: "SketchUp",
    app: "SketchUp",
    extensions: ["skp"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads SketchUp models: components as symbols, groups, tags, colours and lines.",
    writes: "A SketchUp model that every SketchUp since 2013 opens, symbols as components and classes as tags.",
    versions: "Models saved by SketchUp 6 to SketchUp 2025.",
    readLimits:
      "Hidden geometry, text, dimensions, section planes and scenes are left out. A model of up to 250,000 faces comes in at once.",
    keeps: "each class becomes a tag",
    writeLimits: "Lights, text, dimensions and 2D objects are left out.",
  },
  {
    id: "3dm",
    short: "3DM",
    long: "Rhino",
    app: "Rhino",
    extensions: ["3dm"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads Rhino files: meshes and surfaces, blocks as symbols, layers, curves and text.",
    writes: "A Rhino file in millimetres with layers, blocks, meshes and 2D linework.",
    readLimits: "A file saved with Save Small has no render meshes, so its surfaces are left out. SubDs and bare surfaces are left out too.",
    keeps: "each layer becomes a Rhino layer, with a sublayer per class",
    writeLimits: "Pieces that aren't closed extrusions or flat surfaces stay meshes.",
  },
  {
    id: "glb",
    short: "GLB",
    long: "glTF",
    app: "a 3D app",
    extensions: ["glb", "gltf"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads glTF and GLB models with their colours, in metres.",
    writes: "A binary glTF in metres: each object a named mesh under its layer, with its colours.",
    readLimits:
      "Lines, points, textures and Draco-compressed files are left out. A .gltf whose buffers are in separate files is left out too, and at most 100,000 faces come in.",
    keeps: "each object is a named mesh under its layer",
  },
  {
    id: "obj",
    short: "OBJ",
    long: "OBJ",
    app: "a 3D app",
    extensions: ["obj"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads OBJ meshes with their vertex colours; you choose the units and the up axis.",
    writes: "An OBJ in metres with vertex colours, an object per mesh.",
    readLimits: "Lines, points and textures are left out, and at most 100,000 faces come in.",
    keeps: "each mesh is an object of its own",
  },
  {
    id: "fbx",
    short: "FBX",
    long: "FBX",
    app: "a 3D app",
    extensions: ["fbx"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads FBX models, shared geometry as symbols.",
    writes: "A binary FBX that Blender, 3ds Max, Maya, Unity and Unreal open.",
    versions: "Binary and ASCII FBX files, from Blender, 3ds Max, Maya, Revit, Unity and Unreal.",
    keeps: "each layer is a null holding its meshes",
  },
  {
    id: "dae",
    short: "DAE",
    long: "Collada",
    app: "a 3D app",
    extensions: ["dae", "kmz"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads Collada (.dae) and Google Earth (.kmz) models, instanced nodes as symbols.",
    writes: "A Collada model in metres that SketchUp and Blender open.",
    keeps: "each layer and object is a node",
  },
  {
    id: "stl",
    short: "STL",
    long: "STL",
    app: "a 3D printing app",
    extensions: ["stl"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads binary and text STL, in millimetres unless you choose other units.",
    writes: "A binary STL in millimetres, ready for a slicer.",
    writeLimits: "Shapes only: the file holds no colours, names or layers.",
  },
  {
    id: "ply",
    short: "PLY",
    long: "PLY",
    app: "a 3D app",
    extensions: ["ply"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads PLY meshes with their vertex colours.",
    writes: "A binary PLY in metres with vertex colours.",
    readLimits: "A point cloud is left out.",
    keeps: "the vertex colours are kept",
  },
  {
    id: "3mf",
    short: "3MF",
    long: "3MF",
    app: "a slicer",
    extensions: ["3mf"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads 3MF models from slicers, each object split by its colours, at the place the build puts it.",
    writes: "",
    readLimits: "Supports and other non-printing objects are left out and counted. Textures and beam lattices are left out.",
  },
  {
    id: "3ds",
    short: "3DS",
    long: "3D Studio",
    app: "a 3D app",
    extensions: ["3ds"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads 3D Studio meshes with their material colours.",
    writes: "A 3D Studio file for older renderers.",
    readLimits: "Lines, points and textures are left out, and at most 100,000 faces come in.",
    keeps: "the objects are numbered",
    writeLimits: "Each object is split at the format's limit of 65,535 vertices.",
  },
  {
    id: "usdz",
    short: "USDZ",
    long: "USD",
    app: "a USD app",
    extensions: ["usdz", "usd", "usda", "usdc"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads USD, USDA, USDC and USDZ scenes in the units and up axis they say.",
    writes: "A USDZ scene in metres with its materials, for AR Quick Look and USD apps.",
    versions: "Text and binary USD (crate versions 0.4.0 and later), alone or as the root layer of a USDZ.",
    readLimits:
      "References and payloads to other files, curves, points, instancers and textures are left out, and an animated transform comes in at its default.",
    keeps: "the scene can be organised by layer",
  },
  {
    id: "blend",
    short: "BLEND",
    long: "Blender",
    app: "Blender",
    extensions: ["blend"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads Blender files' meshes, grouped by collection.",
    writes: "",
    readLimits: "Modifiers aren't applied, so a Subdivision or Array shows its base mesh. Curves, text and collection instances are left out.",
  },
  {
    id: "step",
    short: "STEP",
    long: "STEP",
    app: "a CAD app",
    extensions: ["stp", "step"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads STEP files' parts, grouped as their assemblies group them, each in the colour its faces have.",
    writes: "A STEP file for mechanical CAD such as SolidWorks and Fusion: closed objects as solids, the rest as surfaces.",
    readLimits:
      "At most 250,000 triangles come in at once, so a bigger model is triangulated coarser to fit. A file with only wires in it is refused.",
    keeps: "the parts are grouped by layer",
    writeLimits: "Curved surfaces come out flat-faceted.",
    openNote: "It has been checked with Rodeo's own STEP reader, but not yet opened in a CAD program.",
  },
  {
    id: "iges",
    short: "IGES",
    long: "IGES",
    app: "a CAD app",
    extensions: ["igs", "iges"],
    read: true,
    write: true,
    kind: "3d",
    reads: "Rodeo reads IGES files' parts, each in the colour its faces have.",
    writes: "An IGES file for CAD: closed objects as solids, the rest as trimmed surfaces.",
    readLimits:
      "At most 250,000 triangles come in at once, so a bigger model is triangulated coarser to fit. A file with only wires in it is refused.",
    keeps: "each layer is a numbered level",
    writeLimits: "Curved surfaces come out flat-faceted, and levels are numbered rather than named.",
    openNote: "It has been checked with Rodeo's own IGES reader, but not yet opened in a CAD program.",
  },
  {
    id: "sldprt",
    short: "SLDPRT",
    long: "SolidWorks part",
    app: "SolidWorks",
    extensions: ["sldprt"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads SolidWorks part files and shows their solids in 3D, through the cadmpeg reader.",
    writes: "",
    readLimits: CAD_PART_LIMITS,
  },
  {
    id: "ipt",
    short: "IPT",
    long: "Inventor part",
    app: "Inventor",
    extensions: ["ipt"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads Autodesk Inventor part files and shows their solids in 3D, through the cadmpeg reader.",
    writes: "",
    readLimits: CAD_PART_LIMITS,
  },
  {
    id: "f3d",
    short: "F3D",
    long: "Fusion 360 design",
    app: "Fusion 360",
    extensions: ["f3d"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads Fusion 360 design files and shows their solid bodies in 3D, through the cadmpeg reader.",
    writes: "",
    readLimits: CAD_PART_LIMITS,
  },
  {
    id: "fcstd",
    short: "FCSTD",
    long: "FreeCAD document",
    app: "FreeCAD",
    extensions: ["fcstd"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads FreeCAD documents (.FCStd) and shows their shapes in 3D, through the cadmpeg reader.",
    writes: "",
    readLimits: CAD_PART_LIMITS,
  },
  {
    id: "prt",
    short: "PRT (NX / Creo)",
    long: "NX or Creo part",
    app: "NX or Creo",
    extensions: ["prt"],
    read: true,
    write: false,
    kind: "3d",
    reads: "Rodeo reads NX and Creo part files (.prt) and shows their solids in 3D, through the cadmpeg reader. It tries NX's reader first, then Creo's.",
    writes: "",
    readLimits: CAD_PART_LIMITS,
  },
  {
    id: "png",
    short: "PNG",
    long: "PNG",
    app: "an image app",
    extensions: ["png"],
    read: false,
    write: true,
    kind: "2d",
    reads: "",
    writes: "A PNG picture of the plan, 3,000 pixels across.",
    keeps: "the plan is drawn as one picture",
  },
];

/** The file viewers, one page each, at /viewer/<id>. A viewer's facts come from the format with the same id in PAGE_FORMATS. */
export const VIEWER_PAGES: readonly ViewerPage[] = [
  {
    id: "vwx",
    title: "VWX viewer online: open Vectorworks files free | Rodeo",
    description:
      "Open a Vectorworks .vwx drawing in your browser, free. See it in 3D and plan, with its layers and classes. Nothing is uploaded, and you can convert it too.",
    h1: "Open Vectorworks (.vwx) files online",
    intro:
      "Drop a Vectorworks drawing on the page and Rodeo reads it in your browser, then shows it in 3D and in plan with its layers, classes and facts. You don't need Vectorworks installed, and the file is never uploaded. Open the drawing in the full editor to measure and change it, or convert it to another format.",
  },
  {
    id: "dwg",
    title: "DWG viewer online: open AutoCAD files free | Rodeo",
    description:
      "Open an AutoCAD DWG drawing in your browser, free. See its lines, text, blocks and layers in plan, then convert it to PDF, DXF or SVG. Nothing is uploaded.",
    h1: "Open AutoCAD (.dwg) files online",
    intro:
      "Drop a DWG file on the page to see its drawing in plan, with each AutoCAD layer as a class and its colours and line weights kept. AutoCAD doesn't need to be on your computer, and the file is read in your browser rather than sent anywhere. Open the drawing in the editor to measure or change it, or convert it to PDF, DXF or SVG.",
  },
  {
    id: "dxf",
    title: "DXF viewer online: open drawing exchange files free | Rodeo",
    description:
      "Open a DXF drawing in your browser, free. See its layers, lines, text and hatches in plan, then convert it to PDF, SVG or Vectorworks. Nothing is uploaded.",
    h1: "Open DXF (.dxf) drawings online",
    intro:
      "A DXF file holds 2D drawing objects as plain text, and most CAD apps can write one. Drop a DXF on the page to see it in plan, with each layer as a class. Then open it in the editor or convert it, and nothing is uploaded.",
  },
  {
    id: "rvt",
    title: "RVT viewer online: open Revit files free | Rodeo",
    description:
      "Open a Revit .rvt project in your browser, free. See its levels, walls, floors and doors in 3D and plan, with their parameters. Nothing is uploaded.",
    h1: "Open Revit (.rvt) projects online",
    intro:
      "Drop a Revit project on the page and Rodeo reads its levels and elements, then shows the building in 3D and in plan, with each element's parameters as records. You don't need Revit, and the model is read in your browser, so it's never uploaded. A very large project can need more memory than a browser has.",
  },
  {
    id: "pln",
    title: "PLN viewer online: open Archicad files free | Rodeo",
    description:
      "Open an Archicad .pln project in your browser, free. See its stories, walls and slabs in 3D and plan, then convert it to IFC or SketchUp. Nothing is uploaded.",
    h1: "Open Archicad (.pln) projects online",
    intro:
      "Drop an Archicad project, archive or template on the page to see its stories in 3D and in plan, with each Archicad layer as a class. Archicad doesn't need to be installed, and nothing is uploaded. Straight walls come in as walls you can edit, and most other objects come in as 3D or 2D.",
  },
  {
    id: "ifc",
    title: "IFC viewer online: open BIM models free | Rodeo",
    description:
      "Open an IFC building model in your browser, free. See each element in 3D, grouped by storey, then convert it to OBJ, glTF or SketchUp. Nothing is uploaded.",
    h1: "Open IFC (.ifc) building models online",
    intro:
      "An IFC file is the open BIM format that Revit, Archicad and other building apps can export. Drop one on the page to see every element as a mesh in 3D, grouped by its building storey. Nothing is uploaded, and no BIM app needs to be installed.",
  },
  {
    id: "skp",
    title: "SKP viewer online: open SketchUp files free | Rodeo",
    description:
      "Open a SketchUp .skp model in your browser, free. See its components, groups, tags and colours in 3D, then convert it to OBJ, glTF or IFC. Nothing is uploaded.",
    h1: "Open SketchUp (.skp) models online",
    intro:
      "Drop a SketchUp model on the page and Rodeo shows it in 3D, with components as symbols, groups with their names and each tag as a class. SketchUp doesn't need to be installed, and the file stays on your computer.",
  },
  {
    id: "3dm",
    title: "3DM viewer online: open Rhino files free | Rodeo",
    description:
      "Open a Rhino .3dm file in your browser, free. See its meshes, surfaces, blocks and layers in 3D and plan, then convert it to OBJ, STL or IFC. Nothing is uploaded.",
    h1: "Open Rhino (.3dm) files online",
    intro:
      "Drop a Rhino file on the page to see its meshes and surfaces in 3D, with blocks as symbols and layers as groups. Curves, text and points also come in as 2D objects for the plan. Rhino doesn't need to be installed, and nothing is uploaded.",
  },
  {
    id: "glb",
    title: "GLB viewer online: open glTF 3D models free | Rodeo",
    description:
      "Open a glTF or GLB 3D model in your browser, free. See its meshes and colours in 3D, then convert it to OBJ, STL or FBX. Nothing is uploaded.",
    h1: "Open glTF and GLB (.glb) models online",
    intro:
      "glTF is the open 3D format used on the web and in AR, and a GLB is one file holding a glTF model. Drop one on the page to see its meshes in their colours, in metres. The model is read in your browser, so nothing is uploaded.",
  },
  {
    id: "obj",
    title: "OBJ viewer online: open Wavefront OBJ files free | Rodeo",
    description:
      "Open a Wavefront OBJ 3D model in your browser, free. See its meshes and vertex colours in 3D, then convert it to STL, glTF or SketchUp. Nothing is uploaded.",
    h1: "Open OBJ (.obj) 3D models online",
    intro:
      "OBJ is one of the oldest 3D model formats, and most 3D apps still write it. Drop an OBJ on the page and choose its units and up axis, as the file doesn't say them. Each mesh comes in as an object with its colours, and nothing is uploaded.",
  },
  {
    id: "fbx",
    title: "FBX viewer online: open 3D models free | Rodeo",
    description:
      "Open an Autodesk FBX 3D model in your browser, free. See it as Blender, Maya or Unity saved it, in 3D, then convert it to OBJ or glTF. Nothing is uploaded.",
    h1: "Open FBX (.fbx) 3D models online",
    intro:
      "FBX is the exchange format that Blender, 3ds Max, Maya, Unity and Unreal all read and write. Drop an FBX on the page to see each model in 3D, with its transforms applied and its shared geometry kept as symbols. Nothing is uploaded, and no 3D app needs to be installed.",
  },
  {
    id: "dae",
    title: "DAE viewer online: open Collada and KMZ files free | Rodeo",
    description:
      "Open a Collada .dae model, or a Google Earth .kmz, in your browser, free. See it in 3D with its colours, then convert it to OBJ, glTF or STL. Nothing is uploaded.",
    h1: "Open Collada (.dae) and KMZ models online",
    intro:
      "Collada is the 3D format SketchUp exports, and a KMZ is a zipped Collada model used by Google Earth. Drop one on the page to see its nodes in 3D with their colours, grouped by the model's top-level nodes. Nothing is uploaded.",
  },
  {
    id: "stl",
    title: "STL viewer online: open 3D print files free | Rodeo",
    description:
      "Open a binary or ASCII STL file in your browser, free. See its triangles in 3D before you print, then convert it to OBJ, glTF or STEP. Nothing is uploaded.",
    h1: "Open STL (.stl) files online",
    intro:
      "An STL file holds the surface of a 3D shape as triangles, which slicers and 3D printers read. Drop one on the page to see it in 3D before you print. STL doesn't store its units, so you choose them, and nothing is uploaded.",
  },
  {
    id: "ply",
    title: "PLY viewer online: open mesh and scan files free | Rodeo",
    description:
      "Open a PLY mesh in your browser, free. See its faces and vertex colours in 3D from scanners, MeshLab or Blender, then convert it to OBJ or STL. Nothing is uploaded.",
    h1: "Open PLY (.ply) meshes online",
    intro:
      "PLY is the polygon format used by 3D scanners, MeshLab and Blender. Drop a PLY mesh on the page to see its faces in 3D, split by vertex colour. PLY doesn't store its units, so you choose them, and the file is never uploaded.",
  },
  {
    id: "3mf",
    title: "3MF viewer online: open slicer files free | Rodeo",
    description:
      "Open a 3MF model from a slicer in your browser, free. See each object in its place on the build plate, then convert it to OBJ, STL or glTF. Nothing is uploaded.",
    h1: "Open 3MF (.3mf) print files online",
    intro:
      "A 3MF file is the 3D printing format that Bambu Studio, PrusaSlicer and OrcaSlicer save. Drop one on the page to see each object where the build puts it, split by colour. The file is read in your browser, so nothing is uploaded.",
  },
  {
    id: "3ds",
    title: "3DS viewer online: open 3D Studio files free | Rodeo",
    description:
      "Open a 3D Studio .3ds model in your browser, free. See its meshes and material colours in 3D, then convert it to OBJ or glTF. Nothing is uploaded.",
    h1: "Open 3D Studio (.3ds) models online",
    intro:
      "3DS is an older 3D format that many packages still read. Drop a 3DS file on the page to see each mesh in 3D, split by its material colour. The file is read on your computer, so nothing is uploaded.",
  },
  {
    id: "usdz",
    title: "USDZ viewer online: open USD scenes free | Rodeo",
    description:
      "Open a USD, USDA, USDC or USDZ scene in your browser, free. See its meshes and materials in 3D, then convert it to OBJ, glTF or STL. Nothing is uploaded.",
    h1: "Open USD and USDZ (.usdz) scenes online",
    intro:
      "Universal Scene Description, or USD, is the format behind Apple's AR Quick Look, and a USDZ is a USD scene in one file. Drop any USD file on the page to see its meshes in 3D, in the units and up axis the file gives. Nothing is uploaded.",
  },
  {
    id: "blend",
    title: "BLEND viewer online: open Blender files free | Rodeo",
    description:
      "Open a Blender .blend file in your browser, free. See its meshes, grouped by collection, in 3D, then convert it to OBJ, glTF or FBX. Nothing is uploaded.",
    h1: "Open Blender (.blend) files online",
    intro:
      "Drop a .blend file on the page to see its meshes in 3D, each at its place in the scene and grouped by collection. Blender doesn't need to be installed, and the file is never uploaded. Compressed files and backups such as .blend1 are read too.",
  },
  {
    id: "step",
    title: "STEP viewer online: open CAD solids free | Rodeo",
    description:
      "Open a STEP .stp or .step CAD file in your browser, free. See its parts in 3D, each in the colour its faces have, then convert it to OBJ, glTF or IGES. Nothing is uploaded.",
    h1: "Open STEP (.stp, .step) files online",
    intro:
      "STEP is the standard exchange format for mechanical CAD, and most CAD apps can save one. Drop a STEP file on the page to see its parts and assemblies in 3D, each part in the colour its faces have. Nothing is uploaded, and no CAD app is needed.",
  },
  {
    id: "iges",
    title: "IGES viewer online: open CAD surfaces free | Rodeo",
    description:
      "Open an IGES .igs or .iges CAD file in your browser, free. See its parts in 3D, then convert it to OBJ, glTF or STL. Nothing is uploaded.",
    h1: "Open IGES (.igs, .iges) files online",
    intro:
      "IGES is an older CAD exchange format for surfaces and solids that many apps still write. Drop an IGES file on the page to see its parts in 3D, each in the colour its faces have. The file is read on your computer, so nothing is uploaded.",
  },
  {
    id: "sldprt",
    title: "SLDPRT viewer online: open SolidWorks parts free | Rodeo",
    description:
      "Open a SolidWorks .sldprt part in your browser, free, without SolidWorks. See the part in 3D, then convert it to STEP, STL or OBJ. Nothing is uploaded.",
    h1: "Open SolidWorks (.sldprt) parts online",
    intro:
      "Drop a SolidWorks part on the page and Rodeo reads it with cadmpeg, a reader that runs in your browser, so SolidWorks doesn't need to be installed. The part comes in as a 3D shape in millimetres, usually grey. Nothing is uploaded, and the preview says what was left out.",
  },
  {
    id: "ipt",
    title: "IPT viewer online: open Inventor parts free | Rodeo",
    description:
      "Open an Autodesk Inventor .ipt part in your browser, free, without Inventor. See the part in 3D, then convert it to STEP, STL or OBJ. Nothing is uploaded.",
    h1: "Open Autodesk Inventor (.ipt) parts online",
    intro:
      "Drop an Inventor part on the page to see it in 3D. Rodeo reads the part with cadmpeg in your browser, so Inventor doesn't need to be installed, and the file is never uploaded. An Inventor assembly (.iam) points at part files that aren't in the drop, so open the parts one at a time.",
  },
  {
    id: "f3d",
    title: "F3D viewer online: open Fusion 360 files free | Rodeo",
    description:
      "Open a Fusion 360 .f3d design in your browser, free, without Fusion. See its solids in 3D, then convert it to STEP, STL or OBJ. Nothing is uploaded.",
    h1: "Open Fusion 360 (.f3d) designs online",
    intro:
      "Drop a Fusion 360 .f3d design on the page to see its solid bodies in 3D. The design is read with cadmpeg in your browser, so Fusion doesn't need to be installed, and nothing is uploaded. A design that holds only sketches or drawings is refused, with a note saying so.",
  },
  {
    id: "fcstd",
    title: "FCSTD viewer online: open FreeCAD files free | Rodeo",
    description:
      "Open a FreeCAD .FCStd document in your browser, free, without FreeCAD. See its parts in 3D, then convert it to STEP, STL or OBJ. Nothing is uploaded.",
    h1: "Open FreeCAD (.FCStd) files online",
    intro:
      "A FreeCAD .FCStd file is a document of parts and sketches. Drop one on the page to see its shapes in 3D, read with cadmpeg in your browser so FreeCAD doesn't need to be installed. Nothing is uploaded, and a document with only sketches is refused.",
  },
  {
    id: "prt",
    title: "PRT viewer online: NX and Creo parts free | Rodeo",
    description:
      "Open an NX or Creo .prt part in your browser, free, without either app. See the part in 3D, then convert it to STEP, STL or OBJ. Nothing is uploaded.",
    h1: "Open NX and Creo (.prt) parts online",
    intro:
      "A .prt file is a part from Siemens NX or PTC Creo, and both use the same extension. Rodeo tries NX's reader first and then Creo's, so you don't need to say which app saved it. Both readers run in your browser, and nothing is uploaded.",
  },
];

/** The converter's pairs, in the order their pages are listed. Each is [from, to], and every one has a page. */
export const PAIRS: readonly (readonly [string, string])[] = [
  ["rvt", "ifc"],
  ["rvt", "pdf"],
  ["rvt", "dxf"],
  ["rvt", "skp"],
  ["rvt", "obj"],
  ["rvt", "glb"],
  ["rvt", "fbx"],
  ["rvt", "stl"],
  ["rvt", "3dm"],
  ["rvt", "vwx"],
  ["dwg", "pdf"],
  ["dwg", "dxf"],
  ["dwg", "svg"],
  ["dwg", "vwx"],
  ["dxf", "pdf"],
  ["dxf", "svg"],
  ["dxf", "vwx"],
  ["skp", "obj"],
  ["skp", "glb"],
  ["skp", "fbx"],
  ["skp", "stl"],
  ["skp", "ifc"],
  ["skp", "dae"],
  ["skp", "3dm"],
  ["skp", "vwx"],
  ["ifc", "obj"],
  ["ifc", "glb"],
  ["ifc", "stl"],
  ["ifc", "skp"],
  ["ifc", "fbx"],
  ["ifc", "3dm"],
  ["ifc", "dae"],
  ["ifc", "vwx"],
  ["3dm", "obj"],
  ["3dm", "stl"],
  ["3dm", "glb"],
  ["3dm", "skp"],
  ["3dm", "ifc"],
  ["3dm", "fbx"],
  ["3dm", "dae"],
  ["pln", "ifc"],
  ["pln", "obj"],
  ["pln", "skp"],
  ["pln", "pdf"],
  ["pln", "glb"],
  ["pln", "vwx"],
  ["vwx", "pdf"],
  ["vwx", "dxf"],
  ["vwx", "ifc"],
  ["vwx", "svg"],
  ["vwx", "skp"],
  ["vwx", "obj"],
  ["vwx", "glb"],
  ["fbx", "obj"],
  ["fbx", "glb"],
  ["fbx", "stl"],
  ["fbx", "skp"],
  ["obj", "stl"],
  ["obj", "glb"],
  ["obj", "fbx"],
  ["obj", "skp"],
  ["obj", "3dm"],
  ["obj", "step"],
  ["stl", "obj"],
  ["stl", "glb"],
  ["stl", "step"],
  ["stl", "3dm"],
  ["glb", "obj"],
  ["glb", "stl"],
  ["glb", "fbx"],
  ["glb", "skp"],
  ["dae", "obj"],
  ["dae", "glb"],
  ["dae", "stl"],
  ["dae", "skp"],
  ["blend", "obj"],
  ["blend", "glb"],
  ["blend", "stl"],
  ["blend", "fbx"],
  ["step", "obj"],
  ["step", "glb"],
  ["step", "stl"],
  ["step", "ifc"],
  ["iges", "obj"],
  ["iges", "glb"],
  ["iges", "stl"],
  ["usdz", "obj"],
  ["usdz", "glb"],
  ["usdz", "stl"],
  ["pdf", "dxf"],
  ["pdf", "svg"],
  ["pdf", "vwx"],
];

/** The formats whose files are plain meshes: their objects carry shapes and, in most, colours, but no records. */
const MESH_FORMATS: readonly string[] = ["obj", "glb", "fbx", "dae", "stl", "ply", "3ds", "usdz"];

/** The shared sentences on the pages. Each is true of every page that uses it. */
const NO_VERSIONS =
  "Rodeo doesn't list the releases it has been checked on for this format. Try your file: the preview shows what came in, and what was left out.";
const NO_LIMITS = "No particular limits are listed for this format. The preview shows what was left out, if anything.";
const NOT_UPLOADED = "No. The file is read on your computer and never sent anywhere, and the converter doesn't upload it.";
const ON_ANY_DEVICE =
  "Yes. It runs in a web browser on a Mac, a Windows PC, a Linux computer or a Chromebook, and it has a layout for phones. A very large file can need more memory than a phone has, and the command line has more room.";
const IN_BROWSER =
  "The conversion runs in your browser and the file is never uploaded. A very large file can need more memory than the browser has, and the command line has more room.";

/** The questions and answers of the converter's index page. An answer may put `code` in backticks. */
const INDEX_FAQ: readonly PageQuestion[] = [
  { q: "Are my files uploaded?", a: "No. The converter runs in your browser: your files are read and written on your computer and never sent anywhere." },
  { q: "Is it free?", a: "Yes, with no sign-up and no limits beyond your computer's memory. Rodeo is open source." },
  { q: "Can I convert to DWG?", a: "Not yet: Rodeo doesn't write DWG. Convert to DXF, which AutoCAD and every DWG app open." },
  { q: "How big can a file be?", a: "As big as your browser's memory allows. Very large Revit models do better with the command line, which has more room." },
  {
    q: "Can I convert many files, or script it?",
    a: 'Yes: `npx @rodeo.build/cli convert "plans/*.dwg" --to pdf --out pdfs` converts a folder at a time on your computer, and --json prints results for scripts.',
  },
];

/** The page's format with this id, or undefined. */
export function pageFormat(id: string): PageFormat | undefined {
  return PAGE_FORMATS.find((f) => f.id === id);
}

/** The address part of a pair's page: "rvt-to-ifc". */
export function pairSlug(from: string, to: string): string {
  return `${from}-to-${to}`;
}

/** The viewer page for this format id, or undefined. */
export function viewerFor(id: string): ViewerPage | undefined {
  return VIEWER_PAGES.find((v) => v.id === id);
}

/** Lists words the way English does: "A", "A and B", "A, B and C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A short phrase on what comes across, for a pair's description. */
function pairSummary(from: PageFormat, to: PageFormat): string {
  if (to.id === "ifc") return "Objects become IFC elements";
  if (to.id === "step" || to.id === "iges") return "Closed objects come across as solids";
  if (from.kind === "3d" && to.kind === "2d") return "Only a plan view comes across";
  if (from.kind === "2d" && to.kind === "drawing") return "Flat line work comes in as drawing lines";
  if (from.kind === "2d" && to.kind === "2d") return "Line work, text and fills come across";
  if (MESH_FORMATS.includes(to.id)) return "Objects come across as meshes";
  if (to.kind === "drawing") return "The objects come into a Vectorworks drawing";
  return "Shapes come across, with colours where the format holds them";
}

/** The page's sentence about what it shows, from the kinds of the two formats. */
function kindLine(from: PageFormat, to: PageFormat): string {
  if (to.id === "step" || to.id === "iges") {
    return "Closed objects come across as solids and the rest as surfaces. Curved surfaces come across flat-faceted, as triangles.";
  }
  if (to.id === "ifc") {
    return "Each object becomes an IFC element on its storey. It is a wall, slab, door or window only when its plug-in name says so, and otherwise a generic building element.";
  }
  if (from.kind === "3d" && to.kind === "2d") {
    return "Only a plan view comes across. The model is seen from above, so the output shows each object's footprint, not its heights, sections or elevations.";
  }
  if (from.kind === "drawing" && to.kind === "2d") {
    return "Only the plan of the drawing comes across: its 2D line work, text and fills, without the 3D objects.";
  }
  if (from.kind === "2d" && to.kind === "drawing") {
    return "Flat line work comes across as lines and shapes in the drawing. Rodeo doesn't build solids from it, so walls and heights come across only where the source file has 3D objects.";
  }
  if (from.kind === "2d" && to.kind === "2d") return "Line work, text and fills come across as they are drawn.";
  if (MESH_FORMATS.includes(to.id)) {
    return "The objects come across as meshes. The records attached to them, such as parameters and property sets, don't: a mesh holds shapes and, in most of these formats, colours only.";
  }
  return "The objects come across as 3D objects, with their colours where the output format holds them.";
}

/** The sentence about what the source contributes: colours, text, units. */
function fromLine(from: PageFormat): string {
  if (from.kind === "2d") return "Text stays text, and filled shapes come across as filled shapes.";
  if (from.kind === "drawing") return "The drawing's layers and classes come across with its objects, and the preview shows what the file holds.";
  return "Colours come across where the output format holds them. The preview shows the units the file came in with, so check them before you convert.";
}

/** The viewer's sentence about how the preview shows the file. */
function viewLine(f: PageFormat): string {
  if (f.kind === "3d") return "The preview shows the file in 3D or in plan, and you can switch between them when both are there.";
  if (f.kind === "2d") return "The preview shows the drawing in plan, with its layers as classes and its colours and line weights.";
  return "The preview shows the drawing in 3D or in plan, with its layers and classes.";
}

/** The viewer's bullet on converting: the formats its pairs write, or the ones Rodeo writes. */
function convertItem(f: PageFormat): string {
  const targets = [...new Set(PAIRS.filter(([a]) => a === f.id).map(([, b]) => pageFormat(b)?.long ?? b))];
  if (!f.write) {
    const suggest = targets.length ? joinList(targets.slice(0, 4)) : "DXF, IFC or glTF";
    return `Rodeo doesn't write ${f.short} files, so convert it to a format it does write, such as ${suggest}.`;
  }
  if (targets.length) return `Convert it to ${joinList(targets)}, with the links below.`;
  return "Convert it with the Convert to menu, which lists every format Rodeo writes.";
}

/** The viewer's questions and answers: which app is needed, the releases, the limits, devices and uploads. */
function viewerFaq(f: PageFormat): readonly PageQuestion[] {
  return [
    {
      q: `Do I need ${f.app} to open it?`,
      a: `No. Rodeo reads the file itself in your browser, so ${f.app} doesn't need to be on your computer, and nothing has to be opened there first.`,
    },
    { q: "Which versions can it open?", a: f.versions ?? NO_VERSIONS },
    {
      q: "What is left out when a file opens?",
      a: f.readLimits ? `${f.readLimits} The preview lists what was left out.` : NO_LIMITS,
    },
    { q: "Does it work on a Mac, a PC, a Chromebook or a phone?", a: ON_ANY_DEVICE },
    { q: "Is my file uploaded?", a: NOT_UPLOADED },
  ];
}

/** The text with its first letter in lower case, for a sentence that continues after "is". */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The pair's questions and answers: the releases, what is lost, what opens the result, and a whole folder. */
function pairFaq(from: PageFormat, to: PageFormat): readonly PageQuestion[] {
  const lost = [from.readLimits, to.writeLimits].filter((s): s is string => Boolean(s));
  return [
    {
      q: `Which ${from.short} files can I convert?`,
      a: from.versions ?? `${from.reads} ${NO_VERSIONS}`,
    },
    {
      q: `Does converting ${from.short} to ${to.short} lose anything?`,
      a: lost.length
        ? "Some things can be left out, as the notes above say. The preview lists what was left out before you download."
        : "Nothing is noted as left out for this pair. The preview lists anything that was left out before you download, so check it.",
    },
    {
      q: `Will the ${to.short} file open in other apps?`,
      a: [`The output is ${lowerFirst(to.writes)}`, to.openNote ?? "Open the result in the app you plan to use before you rely on it."].join(" "),
    },
    {
      q: `Can I convert a whole folder of ${from.short} files at once?`,
      a: `Yes. On your computer, run \`npx @rodeo.build/cli convert "folder/*.${from.extensions[0]}" --to ${to.id} --out converted\`. You can also drop several files on the page and choose Download all (.zip).`,
    },
  ];
}

/** The index page at /convert when `slug` is null, a pair's page for its slug, and null for anything else (including a slug that isn't lower case). */
export function convertPage(slug: string | null): ConvertPage | null {
  if (slug === null) {
    return {
      kind: "index",
      path: "/convert",
      title: "Convert CAD files online, free and private | Rodeo",
      description:
        "Convert Revit, DWG, SketchUp, IFC, Rhino, Archicad and Vectorworks files to IFC, PDF, DXF, glTF, OBJ, STL and more, free in your browser. Nothing is uploaded.",
      h1: "Convert CAD and 3D files",
      intro:
        "Drop Revit, AutoCAD, SketchUp, Rhino, Archicad, IFC or Vectorworks files here and download IFC, PDF, DXF, glTF, OBJ, STL, SketchUp and more. Rodeo converts them in your browser, so your files never leave your computer.",
      from: null,
      to: null,
      crumbs: [
        { name: "Rodeo", path: "/" },
        { name: "Convert", path: "/convert" },
      ],
      sections: [],
      see: [{ path: "/viewer", label: "Open a CAD or 3D file without converting it" }],
      faq: INDEX_FAQ,
      linksTitle: "Popular conversions",
      links: PAIRS.map(([a, b]) => ({ path: `/convert/${pairSlug(a, b)}`, label: `${pageFormat(a)?.short ?? a} to ${pageFormat(b)?.short ?? b}` })),
    };
  }

  const pair = PAIRS.find(([a, b]) => pairSlug(a, b) === slug);
  if (!pair) return null;
  const [fromId, toId] = pair;
  const from = pageFormat(fromId);
  const to = pageFormat(toId);
  if (!from || !to) return null;

  // five other pairs from the same input and three into the same output, topped up from whichever list has more: eight at most
  const sameFrom = PAIRS.filter(([a, b]) => a === fromId && b !== toId);
  const sameTo = PAIRS.filter(([a, b]) => b === toId && a !== fromId);
  const picks = [...sameFrom.slice(0, 5), ...sameTo.slice(0, 3)];
  const spare = [...sameFrom.slice(5), ...sameTo.slice(3)];
  while (picks.length < 8 && spare.length) picks.push(spare.shift() as readonly [string, string]);

  const keeps = to.keeps ? [`On the way out, ${to.keeps}.`] : [];
  const viewer = viewerFor(fromId);
  const pairName = `${from.short} to ${to.short}`;
  const limitNotes = [from.readLimits && `From ${from.short}: ${from.readLimits}`, to.writeLimits && `Into ${to.short}: ${to.writeLimits}`].filter(
    (s): s is string => Boolean(s),
  );

  return {
    kind: "pair",
    path: `/convert/${pairSlug(fromId, toId)}`,
    title: `Convert ${from.short} to ${to.short} online, free | Rodeo`,
    description: `Convert ${from.long} (.${from.extensions[0]}) files to ${to.long} (.${to.extensions[0]}) in your browser, free. ${pairSummary(from, to)}. Nothing is uploaded and there is no sign-up.`,
    h1: `Convert ${from.short} to ${to.short}`,
    intro: `${from.reads} You get ${lowerFirst(to.writes)} Your file never leaves your computer.`,
    from: fromId,
    to: toId,
    crumbs: [
      { name: "Rodeo", path: "/" },
      { name: "Convert", path: "/convert" },
      { name: pairName, path: `/convert/${pairSlug(fromId, toId)}` },
    ],
    sections: [
      {
        heading: `How to convert ${from.short} to ${to.short}`,
        steps: [
          `Choose ${from.short} files with Choose files, or drop them on the page. Rodeo reads them in your browser.`,
          `Pick ${to.long} in the Convert to menu. The preview shows what came in: its units, layers, objects and size, and what was left out.`,
          "Click Download to save the converted file. With several files, Download all (.zip) saves them together.",
        ],
      },
      {
        heading: "What comes across",
        paragraphs: [kindLine(from, to), ...keeps, fromLine(from)],
      },
      {
        heading: "Good to know",
        items: [...limitNotes, IN_BROWSER],
      },
    ],
    see: viewer ? [{ path: `/viewer/${fromId}`, label: `Open a ${from.short} file in the viewer first` }] : [],
    faq: pairFaq(from, to),
    linksTitle: "Popular conversions",
    links: picks.map(([a, b]) => ({ path: `/convert/${pairSlug(a, b)}`, label: `${pageFormat(a)?.short ?? a} to ${pageFormat(b)?.short ?? b}` })),
  };
}

/** The viewer's index at /viewer when `id` is null, a viewer page for its id, and null for anything else. */
export function viewerPage(id: string | null): ConvertPage | null {
  if (id === null) {
    return {
      kind: "viewer-index",
      path: "/viewer",
      title: "Open CAD and 3D files online, free | Rodeo",
      description:
        "Open Vectorworks, Revit, Archicad, IFC, SketchUp, Rhino, STEP, SolidWorks and 3D model files in your browser, free. Nothing is uploaded.",
      h1: "Open CAD and 3D files online",
      intro:
        "Rodeo's viewer opens a drawing or model in your browser and shows it in 3D or in plan, with its layers, objects and facts. Pick a file type below to see what Rodeo reads from it. Nothing is uploaded, so your files stay on your computer.",
      from: null,
      to: null,
      crumbs: [
        { name: "Rodeo", path: "/" },
        { name: "Viewer", path: "/viewer" },
      ],
      sections: [
        {
          heading: "What you can open",
          paragraphs: [
            "Each page below opens one kind of file in the same converter, so you can see what is in a file before you decide what to do with it.",
            "Everything happens in your browser. Rodeo doesn't upload the file, and it doesn't need the app that made the file.",
          ],
        },
        {
          heading: "Formats without a page",
          paragraphs: [
            "PDF and EMF files open in the converter too. They are generic formats rather than CAD files, so they have no viewer page of their own: drop one on the converter to read its line work and convert it.",
          ],
        },
      ],
      see: [{ path: "/convert", label: "Convert files between formats" }],
      faq: [
        {
          q: "Do I need a CAD or 3D app to open these files?",
          a: "No. Rodeo reads each file itself in your browser, so none of the apps that made the files needs to be on your computer.",
        },
        {
          q: "Can I convert these files to other formats?",
          a: "Yes, for many of them. The converter writes Vectorworks, DXF, IFC, SketchUp, glTF, OBJ and other formats. It doesn't write DWG, Revit, Archicad, 3MF, Blender or the CAD part formats, so a file in one of those is converted to a format it does write.",
        },
        { q: "Is my file uploaded?", a: NOT_UPLOADED },
        {
          q: "Does it work on a phone?",
          a: "It has a layout for phones, but a large model can need more memory than a phone has. The command line has more room, on a computer.",
        },
        { q: "Is it free?", a: "Yes. There is no sign-up and no limit beyond your computer's memory. Rodeo is open source under AGPL-3.0." },
      ],
      linksTitle: "Open a file type",
      links: VIEWER_PAGES.map((v) => {
        const f = pageFormat(v.id);
        return { path: `/viewer/${v.id}`, label: `${f?.long ?? v.id} (.${f?.extensions[0] ?? v.id})` };
      }),
    };
  }

  const viewer = viewerFor(id);
  const f = pageFormat(id);
  if (!viewer || !f) return null;
  const pairs = PAIRS.filter(([a]) => a === id).slice(0, 8);

  return {
    kind: "viewer",
    path: `/viewer/${id}`,
    title: viewer.title,
    description: viewer.description,
    h1: viewer.h1,
    intro: viewer.intro,
    from: id,
    to: null,
    crumbs: [
      { name: "Rodeo", path: "/" },
      { name: "Viewer", path: "/viewer" },
      { name: f.short, path: `/viewer/${id}` },
    ],
    sections: [
      {
        heading: "What you see",
        paragraphs: [f.reads, viewLine(f)],
      },
      {
        heading: "What you can do with it",
        items: [
          "Open in Rodeo opens the file in the editor, in a new tab, where you can measure it and change it. Save asks where to write the drawing, so the original file stays as it was.",
          convertItem(f),
          "Check it first: the preview lists the commonest kinds of object, the size, the units and the layers, and says what was left out.",
        ],
      },
    ],
    see: [
      { path: "/viewer", label: "All the file viewers" },
      { path: "/convert", label: "Convert files between formats" },
    ],
    faq: viewerFaq(f),
    linksTitle: "Convert it",
    links: pairs.map(([a, b]) => ({ path: `/convert/${pairSlug(a, b)}`, label: `${pageFormat(a)?.short ?? a} to ${pageFormat(b)?.short ?? b}` })),
  };
}
