# Scripts

This page covers running Python scripts and Vectorscripts written for Vectorworks, what they can do with files, preferences and dialogs, script palettes, reading Marionette networks, writing a drawing out as a script, and the format library and Node command line behind Rodeo. Installing and running Vectorworks plug-ins is on the [Symbols and plug-in objects](symbols-plugins.md#vectorworks-plug-ins) page.

## Running scripts

### Python scripts

Python written for Vectorworks runs on the open drawing from **Tools › Plug-ins › Run Script…**, as in Vectorworks. It runs in a window that:

- keeps the script in this browser
- opens and saves `.py` files
- shows what it prints, with a failing line linked.

The script runs in Pyodide in a Web Worker (fetched from jsDelivr the first time, about 11 MB) with a `vs` module of more than 1,100 of Vectorworks' calls:

- drawing: Rect, Oval, Arc, Poly, BeginPoly with ArcTo, CurveTo and CurveThrough, Poly3D, BeginPoly3D with Add3DPt, Locus, CreateText, BeginGroup…
- symbols: Symbol places one by name; GetSymLoc, GetSymRot, SetActSymbol, SymbolToGroup
- walking the drawing by handle: FSActLayer, NextObj, ForEachObject and Count with search criteria, ForEachObjectInLayer
- measuring what matches search criteria: Area, Perim, Length, Width, Height, XCenterN, LeftBoundN, ObjectType…
- reading and setting geometry, class, name, attributes, records and selection
- moving, turning, scaling, mirroring and duplicating, and on the selection FlipHor, FlipVer, Scale, Forward, MoveFront…
- changing a shape: SetPolyPt, InsertVertex, DelVertex, SetPolylineVertex, SetPolyClosed, SetSegPt1, SetArc, SetRRDiam
- layers and classes: a class's fill, pen, line weight and opacity (SetClFPat, SetClLW, GetClFillFore…), RenameClass, DelClass, Class and Layer Options, CreateLayer, a layer's scale, elevation and visibility
- the attributes new objects take: FFillPat, FPenSize, FFillFore…
- text: SetTextSize, SetTextFont with GetFontID, SetTextStyle, SetTextJust, SetTextOrientation, TextFont and TextFace for new texts… A text is styled as a whole, so a call's run of characters styles all of it.
- math, strings, vectors and 2D geometry: Sqrt, Num2StrF, SubString, Ang2Vec, Vec2Ang, CrossProduct, LineLineIntersection, CircleCircleInters, PtInPoly, Centroid…
- 3D: BeginXtrd with EndXtrd, BeginMXtrd, BeginSweep, HExtrude, CreateExtrudeAlongPath, CreateTaperedExtrude, AddSolid, SubtractSolid, IntersectSolid, CreateSphere, CreateCone, Locus3D, Move3DObj, Set3DRot, Rotate3D, Get3DCntr, Get3DInfo, ObjVolume, ObjSurfaceArea…
- walls: Wall draws a plain wall with WallWidth and WallHeight; GetWallThickness, GetWallWidth, HWallHeight, SetWallHeights, SetWallWidth, JoinWalls, ReverseWallSides…
- records and resources: NewField makes a record format or adds a field, SetRecord, GetRecord, NumRecords, NumFields, GetFldName, GetFldType, BuildResourceList with GetNameFromResourceList, Name2Index, NameObject, SetParent (to a layer)
- symbol definitions: BeginSym with EndSym makes one from what is drawn between them; FSymDef, NextSymDef and FInSymDef walk the definitions and what is in them
- worksheets: CreateWS, SetWSCellFormula, GetWSCellValue, GetWSCellString, SetWSColumnWidth, InsertWSRows, ShowWS…
- 2D shapes: RectangleN, ConvertToPolygon, ConvertToPolyline, OffsetPoly, ClipSurface, AddSurface, IntersectSurface, LinearDim, AngularDim, and line markers with SetObjBeginningMarker and SetObjEndMarker
- menu commands by name: DoMenuTextByName runs Group, Ungroup, Select All, Deselect All, Duplicate, Clear, Bring to Front, Send to Back, Send Forward, Send Backward, Rotate Left 90°, Rotate Right 90°, Flip Horizontal and Flip Vertical
- the dialogs: StrDialog and the others wait for the answer where the browser can pause WebAssembly, as Chrome can. AlertInform, AlertCritical and AlertQuestion show Rodeo's own alert with the script's buttons; PtDialog, DistDialog and AngDialog ask for numbers.
- the program: GetVersion answers as Vectorworks 2024 does; GetSavedSetting and SetSavedSetting keep a script's settings in this browser.

The script works on a copy of the drawing taken as it starts, so it sees its own changes. They are applied when it ends, as one undo step, and a script that fails or is stopped changes nothing.

Lengths are in the drawing's units (inches for feet and inches), and colours are the drawing's nearest palette colour. What a script draws takes the Attributes palette's settings for new objects, and the ones the script sets, as in Vectorworks.

Search criteria take class, layer, type, name, selection and visibility terms, record terms (`R IN ['Part Info']`), record fields (`'Part Info'.'Count'>1`), lists with IN, and fill and pen attributes, joined with & and |.

**Limits:**

- Calls Rodeo lacks say so by name. About two thirds of Vectorworks' 3,250 calls are still missing: NURBS, textures, viewports, IFC, roofs, stairs, Spotlight, site models and the rest.
- Attributes on a new object that neither the script nor the Attributes palette set read as 0 until it ends.
- A layer's thickness isn't kept: it reads 0.
- 3D: a script's z is above the active layer. Sweeps, spheres, cones and hemispheres are made as meshes. SetRot3D, Get3DOrientation and SetPolyPt3D work on what the script made in the same run, not on objects already in the drawing. The order of a 3D turn about more than one axis (x, then y, then z) is Rodeo's reading.
- Walls: 16 of Vectorworks' 85 wall calls. Wall styles, components, symbols in walls and round walls aren't available.
- Records: a date field is refused, and number formats are kept as plain numbers. A script reads a symbol definition's contents but can't change them. Symbols can't be put in folders. CreateCustomObject places only a kind of plug-in object the drawing already has.
- Worksheets: a drawing with no worksheet can't make one yet. A formula's result is stored as a number, so it won't recalculate; formulas beyond arithmetic, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, IF and CONCAT are kept as text. Borders, colours, merged cells and the selection last for the run only. Database rows, images in cells and placing a worksheet on the drawing aren't available.
- Dimensions need a dimension already in the drawing to copy. Text width and wrapping, class markers and a class's Use at Creation can't be set.
- Line markers: an arrow, a dot or a slash.
- Progress dialogs show nothing; the script runs on.
- GetMouse, MouseDown and TrackObject aren't available.

### Files and folders in scripts

A browser gives a script no disk, so Rodeo stands in a small one that lasts for the run.

- **GetFile** and **GetFileN** open the browser's file chooser. The script then reads the chosen file with Python's `open`, or with Open, ReadLn, Read and EOF.
- **PutFile** gives a file name to write to (with Rewrite or Append, Write and WriteLn, or `open`). When the script ends without an error, each file it wrote is downloaded.
- **GetFolderPath** answers a folder for every number Vectorworks has. For a plug-in, the plug-in folders are the folder of the files installed with it, so it can import its own modules and read its own settings files. The other folders are empty.
- **FindFileInPluginFolder** finds a file installed with the plug-in.
- **OpenURL** opens an http or https address in a new tab.
- Python's `sqlite3`, `ssl` and `lzma` load when a script imports them.

**Limits:** GetFolder always answers as if cancelled. A file read or written is limited to 50 MB. Scripts have no network: `urllib`, `requests`, sockets, `subprocess` and threads fail. ReadBin and WriteBin aren't available.

### Preferences and object variables

GetPref, SetPref, GetPrefInt, GetPrefReal, GetPrefString, GetPrefRGB and their Set calls, and GetObjectVariableInt, GetObjectVariableReal, GetObjectVariableBoolean, GetObjectVariableString and their Set calls, take every selector number Vectorworks publishes.

- 35 of them answer from the drawing or the editor: the units, the active layer's scale, the grid, snapping, a layer's kind and visibility, an object's attributes and the like.
- The others answer what the script last set in the run, or 0, false or empty text. So a script that reads a preference, changes it and puts it back runs. The developer console lists the selectors a run used this way.
- A number Vectorworks doesn't list is an error that names it.

**Limits:** setting a preference Rodeo doesn't have changes nothing in the drawing. Vectorworks' own defaults for the selectors Rodeo doesn't keep aren't known, so they read as 0, false or empty.

### Vectorscript

**Vectorscript** runs in the same window: a `.vs` or `.px` file, or a script that starts with PROCEDURE or FUNCTION. It is translated to Python in the worker (`web/src/features/python/vscriptModule.ts`) and run on the same calls by their Vectorscript names.

- Nested procedures and functions keep their variables in frame objects, so a nested routine reaches its parent's, and a VAR argument is a reference to a variable, array element or record field.
- Arrays keep their own bounds, and records and arrays copy on assignment.
- Lengths written with `'` and `"` become the drawing's units.
- The vs procedures that hand values back through VAR parameters (GetBBox, GetUnits…) fill the variables from what the Python call returns. Which parameters those are comes from Vectorworks' published signatures, for every call that has them.
- Search criteria written out (`((T=RECT) & (SEL=TRUE))`) are passed as text.
- A POINT argument can be a POINT or VECTOR variable or x and y, and a point or vector a call returns fills a variable's x, y and z.
- A number with a unit written straight after it (`1.75in`, `5/8in`, `300mm`) is a length in that unit.
- WITH works, and so does `{$INCLUDE}` of a file installed with a plug-in.
- ReadLn and Read fill several variables, each by its type.
- Errors are given at the Vectorscript's own lines.

**Limits:** GOTO is refused. `{$INCLUDE}` finds only the files installed with a plug-in, so a script run from the Run Script window can't include one. A CHAR is read as a string.

### Script palettes

**Window › Script Palettes** holds named palettes of Python scripts and Vectorscripts, shown a section each in the Script Palettes palette.

- Double-click a script to run it on the open drawing (one undo step; an error opens an alert with its line).
- Right-click a palette to add a script in the Script Editor or import one from a file, or to rename or delete it.
- Right-click a script to edit, rename, duplicate, export or delete it.

Vectorworks keeps script palettes in the drawing; Rodeo keeps them in this browser, the same for every drawing.

### Custom Tool/Attribute

**Tools › Custom Tool/Attribute…** saves a way of drawing as a script. Select one object to record its attributes, or nothing to record what new objects are drawn with, and pick the tool to draw with first.

The **Custom Tools** dialog ticks what's recorded, in four groups, each with **All**:

- **Fill Attributes:** style, foreground and background colour, and opacity.
- **Pen Attributes:** style, foreground and background colour, and line weight.
- **Text Attributes:** size and alignment (from a text object, or the Text tool's).
- **Other Attributes:** class, layer and the active tool.

Choose **Create VectorScript** or **Create Python Script**, then name it. It goes in a script palette. Double-click it there to set all of that again, ready to draw.

Any script that sets attributes, text size, the class, the layer or the tool (with `SetTool`) leaves them set after it runs, as in Vectorworks. `PushAttrs` and `PopAttrs` put attributes back.

### Marionette

Rodeo reads the Marionette networks in a drawing. It doesn't run them.

- Select a Marionette node or Marionette object: Object Info shows its kind, its input and output ports and its typed values, and **View Script…** opens its Python script to read and copy.
- **Tools › Plug-ins › Marionette Nodes…** lists the drawing's networks with their nodes and wires. Click a node to select it in the drawing.

**Limits:** nothing is run, so a Marionette object stays as Vectorworks last drew it. A node inside a symbol can't be picked out in the drawing. Which port a wire joins is read from where the wire is drawn. How a Marionette object on a layer finds its network isn't known yet.

## Drawings as scripts

### Export Script and Import Script

**Export Script** (**File › Export**) writes the drawing as a Vectorscript that draws its design layers' 2D objects again, in their classes and stacking order with their names, attributes and turns (`web/src/features/python/exportScript.ts`).

- The script's header counts what it leaves out (symbols, plug-in objects, 3D, images, sheet layers) and what it writes plainer (hatches and dashes as solid).
- It refuses to run in a drawing of other units, since its coordinates are in the drawing's own.

**Import Script** (**File › Import**) runs a script file in the Run Script window.

### Export Simple VectorScript (3D only)

**Export Simple VectorScript (3D only)** (**File › Export**) writes the 3D objects on the visible design layers as a plain script of 3D polygons, one per flat face and grouped by object, in Front view or the current view, for other programs to read. It runs back in Rodeo too.

## The format library and command line

The format library in `web/src/core` has no DOM dependencies:

```ts
import { openVwx } from "./src/core/index.ts";

const session = openVwx(bytes, "drawing.vwx");
const layer = session.doc.layers()[0];
session.addObject(layer.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
session.renameLayer(layer.id, "Plan");
session.undo();
const out = session.doc.toBytes();
```

There is also a Node command line for the same library:

```bash
npm run vwx -- info drawing.vwx
npm run vwx -- layers drawing.vwx
npm run vwx -- svg drawing.vwx out.svg
npm run vwx -- dxf drawing.vwx out.dxf
npm run vwx -- pdf drawing.vwx out.pdf [--layer NAME ...]
npm run vwx -- roundtrip drawing.vwx
```

### Agents on your own files

`npx -y @rodeo.build/cli mcp` runs Rodeo as a local MCP server for Claude Code, Claude Desktop, Cursor and other agents, with no browser and no account: it inspects and converts any file Rodeo reads, and makes, reads, edits and models in .vwx drawings. In Claude Code: `claude mcp add rodeo-files -- npx -y @rodeo.build/cli mcp`. In Claude Desktop or Cursor, add a server with the command `npx` and the arguments `-y @rodeo.build/cli mcp`.

Paths are relative to the folder the agent starts it in. It never replaces a file unless the agent asks to overwrite.

**Limits:** .vwx drawings over 500 MB are for Rodeo itself. Pictures of the drawing (looks and renders) need Rodeo in a browser.
