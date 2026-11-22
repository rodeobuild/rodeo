# Symbols and plug-in objects

This page covers symbols, the Resources panel that holds them with the drawing's other resources, plug-in objects such as doors, windows and title blocks, installing and running Vectorworks plug-ins, the data records attached to objects, and textures: making and editing them, and how they are set and mapped on an object's parts.

## Symbols

### Placing a symbol

Resources lists the file's symbol definitions by folder with previews and search. Pick one and the **Symbol** tool (<kbd>K</kbd>) places it with a live preview, with a click or (Click and Rotate) a click and then a second click for its rotation, Shift in 15° steps.

### Symbol instances

Instances are drawn through their placement matrix and can be moved, rotated and mirrored. Object Info shows the definition and replaces it with another.

### Create Symbol…

**Modify › Create Symbol…** turns the selection into a new definition and puts an instance in its place.

**Symbols in new drawings.** Create Symbol and the rest of the symbol commands now work in a blank drawing, where they used to refuse for lack of a symbol to copy from.

**Limits:** these symbols haven't been opened in Vectorworks yet.

### Editing a symbol

**Modify › Edit Symbol** (or double-click an instance, or **Edit Symbol** on its Resources tile) opens the definition in place of the layers, at its insertion point, for every tool to edit. Each change reaches every instance and undoes as usual.

**Exit Symbol** (the bar over the drawing, Modify, or <kbd>⌘]</kbd>) goes back to the layer and view it came from.

## Resources

### Locating a resource from the drawing

Right-click an object on the drawing for **Locate Symbol** (or Hatch, Gradient, Tile, Image Fill, Line Type, Text Style, Worksheet, Texture) in Resource Manager: one row for each resource it uses, which shows Resources with that tile selected and scrolled to. A symbol becomes the one the Symbol tool places, without switching tools.

### Renaming, duplicating and deleting

Right-click a tile in Resources to rename any resource, to duplicate or delete a symbol definition, or to delete a worksheet or a data record format (its records going from the objects that have one).

**Limits:**

- A definition, worksheet, hatch, gradient, line type or text style still in use somewhere isn't deleted.
- A resource whose name other records hold as text (plug-in parameters, worksheet formulas, data visualizations) or a plug-in's parameter format isn't renamed or deleted, since those would not follow.

### Hatches

Hatches are edited in Resources too (**Edit Hatch…**, or a double-click on the tile):

- the ground colour
- whether the sizes are on the printed page or in the world
- the levels of parallel lines with their angle, spacing, shift along the line, dash, start point, colour and weight

A preview follows each change. **New Hatch…**, **Duplicate…** and **Delete…** sit beside it.

### Gradients, line types and text styles

These are edited the same way:

- **Gradients:** their stops' position, colour, opacity and midpoint.
- **Line types:** dash and gap lengths on the printed page.
- **Text styles:** font, size in points and alignment, with a sample line. Editing one restyles the texts that follow it, by name or through their class, keeping a size they set apart in proportion.

### Textures

**New Texture…** (the + button, or a texture's right-click menu) makes a texture from a colour or from a PNG or JPEG image, with its name and **Size**: the width one repeat covers.

**Edit Texture…** (right-click, or double-click the tile) shows the texture's name, size and how many objects and classes use it, then each of its shaders:

- **Color:** a plain colour to pick, or an image with its filter colour. Other kinds (noise, tiles, bricks and so on) are named and kept as they are.
- **Reflectivity**, **Transparency** and **Bump:** the kind Vectorworks names (Mirror, Plastic, Glass, Image and so on) with its settings as the drawing's file names them, each to change, and **Remove** to take the shader off. A texture with no transparency can be given a **Plain transparency** with its **Opacity %**.

A preview follows the edits. OK makes them as one undo step. **Delete…** removes a texture nothing uses.

In the 3D view a texture with a plain colour colours its faces, and a Plain transparency makes them see-through. The Render palette's Auto finish reads the shaders: Glass transparency is glass, Mirror reflectivity chrome, Glow and Backlit glowing, and Plastic and Anisotropic set the finish where the texture's name says nothing.

**Limits:**

- An image's **Filter color** is kept in the file and can be changed, but Rodeo doesn't tint the image by it: when Vectorworks applies it isn't known.
- A texture's image can't be swapped for another, and shaders other than Plain transparency can't be added: Rodeo only writes shader settings it can copy from the drawing itself.
- Plain transparency can be added only in a drawing that already has that shader (import a texture that has one first).
- The settings of a shader are listed under the names in the drawing's file, which are in the language of the Vectorworks that saved it. Rodeo doesn't interpret them beyond colour and opacity.
- A texture in use isn't deleted.
- Textures Rodeo makes or edits haven't been opened in Vectorworks.

### New resources

The panel's + button makes a new hatch, gradient, line type, text style, record format or texture. A drawing with no gradient or text style yet gets its first from a hatch's frame.

### Importing resources from another file

The + button's **Import from Another File…** (or **File › Import Resources…**) lists another .vwx file's symbols, textures, hatches, gradients, simple line types, text styles and data record formats to tick. One whose name the drawing already uses comes in as Name-2, replaces the drawing's own of that kind (a replaced symbol's instances draw its new contents), or stays out, as chosen.

- **A symbol** brings the symbols nested in it and the classes, line types, hatches, gradients, text styles, record formats and textures (those its 3D objects show) it uses that the drawing lacks. The drawing's own of the same name are used as they are.
- **A texture** brings its shaders' images and settings and the shader record formats the drawing lacks (one it has must hold the same kinds of field in the same places).
- **A record format** that replaces the drawing's keeps the values of the fields both have, of the same kind, in the records already attached.

Colours are matched to the drawing's palette (the nearest when it lacks one), previews are drawn anew, and the imports are one undo step.

**Limits:**

- Symbols holding plug-in objects are listed with the reason they can't come in yet.
- A record format with fields a new format can't have yet (choice fields, say) is listed with the reason.

## Plug-in objects

### How plug-in objects draw

Plug-in objects (doors, windows, title blocks, spaces, grids, plants…) draw their cached 2D geometry placed by their own matrix, and can be moved.

As in Top/Plan, one that has a 2D drawing shows only that, not its 3D parts (a cabinet's footprint, not its panels, nor the hinge markers doors keep on their leaves for elevations). 3D solids elsewhere draw as wireframe (an extrude's profile placed by the extrude's own frame, where its body starts; a 3D polygon as its outline seen from above), and open polygons and polylines with a fill are filled.

### Parameters in Object Info

Object Info lists a plug-in's parameters and any data records attached to an object (text, numbers, dimensions, choices, checkboxes) and edits them.

### Plug-in Insertion tool

The **Plug-in Insertion** tool (the Insertion tool set) places plug-in objects of any kind the drawing has on its design layers (columns and beams, plants, cabinets, stairs, grid axes, railings, spaces…). Press where its insertion point goes and drag to turn it (Shift in 15° steps), or click to keep the turn of the one it copies. Preferences picks the kind.

The copy keeps that object's class, parameters and drawing, since Rodeo can't redraw a plug-in from its parameters.

**Limits:** tags, section lines, cameras and Heliodons (their own tools place them), site models and design layer viewports aren't offered.

### Vectorworks plug-ins

**Plug-ins › Vectorworks Plug-ins** installs and runs plug-ins made with Vectorworks' Plug-in Manager: menu commands (`.vsm`), tools (`.vst`) and objects (`.vso`), written in Python or Vectorscript. They run on the same calls as scripts do; the [Scripts](scripting.md) page lists them.

**Install…** takes the plug-in file with every file that came with it, chosen together, or a zip of the plug-in's folder: the Python modules it imports, Vectorscript include files, settings files and its `.vwr` resource file or folder. They are kept in this browser, and **Manage…** removes a plug-in. A file over 5 MB is left out, and the message says so.

- **Menu commands** run from the submenu.
- **Tools** start from the submenu. A tool that asks for points (GetPt, GetLine, GetRect) takes clicks in the drawing; Esc ends it and keeps what it drew. A tool that handles its own events shows a bar with its name, its modes and pull-down menus and its help text: click its points in the drawing, and each finished object is one undo step. Esc drops the points so far, a second Esc or **End tool** ends it, and so does choosing another tool.
- **Objects** are placed with the **Plug-in Insertion** tool. Click for a point object and drag to turn it; drag along a linear one; drag across a rectangular one. A path object is drawn by clicking its corners, and a double-click or Enter ends it. A click on a wall puts a point or linear object on the wall's centre line, turned along the wall.
- The **Reshape** tool moves a path object's corners and an object's control points, and the object draws again.
- **Object Info** shows an object's parameters with their display names, popup choices and class menus, or the layout the plug-in sets up itself: its own order and indents, dividers, text, buttons, popups it fills, and the rows it greys or hides. A change draws the object again, as one undo step.
- A plug-in's script may draw in 3D: extrudes, sweeps and solids go inside the object and show in the 3D view.
- **Dialogs** a plug-in builds are shown over the drawing: text, number and length fields, check boxes, radio buttons, push buttons, pull-down menus, class, layer and symbol menus, list boxes, list browsers with sortable columns and check columns, sliders, tree controls, colour menus, group boxes, tabs and swap panes. The plug-in's handler runs for each change, on each keystroke in a field.
- A plug-in reads its own strings from its `.vwr` with GetVWRString, and its own files through its plug-in folder.
- **Tools › Utilities › Reset All Plug-Ins** draws every object of the installed plug-ins again.

**Limits:**

- Plug-ins whose script is encrypted, and plug-ins built with the SDK (`.vlb`), are refused.
- A plug-in that checks a Vectorworks licence or serial number stops at that check: Rodeo has neither.
- A plug-in that needs a call Rodeo lacks stops with a message naming the call.
- An object placed on a wall isn't set into it: it cuts no opening and doesn't move with the wall.
- A path object has a 2D path only, with no profile, and a script can't make one with CreateCustomObjectPath.
- In dialogs, pictures and icons from resource files aren't shown (a picture button shows its name), texture menus and the line style, line weight, marker and pattern menus are empty, a list browser's cells can't be edited in place, and a resizable dialog doesn't resize its controls.
- A plug-in's numbered strings (GetPluginString) read as empty unless its `.vwr` holds one under that number, and GetResourceString isn't available.
- A tool that handles its own events: the event numbers are taken from public tools, not from Vectorworks' documents; the data bar isn't shown; 3D points lose their height; and the tool's own variables don't last from one click to the next.
- Untested in Vectorworks: the plug-in file doesn't say an object's shape, so Rodeo takes it from what its script reads (its path, PLineLength, PBoxWidth and PBoxHeight); a rectangular object's origin is taken to be the middle of its left side.

### Title Block Manager

**File › Title Block Manager…** edits the title blocks' data: project data on all of them, sheet data on the sheets ticked (several at once, differing values shown as Varies). Their drawn text follows where it shows a value exactly, and Sheet Number and Sheet Title rename the sheet, all in one undo step.

**Limits:** revision data isn't edited yet.

### Duplicate on Layers

Right-click a title block border and choose **Duplicate on Layers…** to copy it to other layers. The dialog lists every layer that has no title block border yet. Tick the ones to copy it to, or use **Select/Deselect All**. Each copy lands where the original stands. On a sheet layer, the copy's Sheet Number and Sheet Title become that sheet's.

**Limits:** it works on title block borders from Vectorworks files, not on the borders Rodeo's own Title Block Border tool draws. Sheet data is always filled in, whatever the border's own setting.

## Data records

### Attaching and detaching records

Object Info's Data tab attaches a record of any of the document's data record formats (holding the format's default values) and detaches one.

**Tools › Records › Attach Record…** attaches one to every selected object without it, in one undo step, and **Detach Record…** takes a format's records off them.

### Change One Field… and Change All Fields…

**Change One Field…** and **Change All Fields…** set a record's values on the symbol definitions in a symbol folder, at the top level or everywhere, which symbols placed afterwards start with.

### Merge Record Formats… and Split Record Format…

**Merge Record Formats…** puts one format's fields on the end of another's, the objects' values going with them, and deletes the first.

**Split Record Format…** moves the fields ticked to a new format, every object with the source format's record gaining one of the new format with its values.

### Modify by Record…

**Modify by Record…** reads a field's number on each object (across the drawing or the selection, in groups if asked) and, in one undo step:

- colours the objects by it (along a gradient, by ranges or by value, on the fill's or pen's colours)
- scales them by it
- extrudes them that high or raises polygons to 3D polygons at it

### Making and editing record formats

**Tools › Records** makes new data record formats and edits them (also from a format's Resources tile): fields of text, integers, numbers, dimensions and checkboxes with their defaults, added, renamed, moved and removed. The objects' records keep their values in the fields kept.

## Textures on objects

### Render tab

Object Info's Render tab lists an object's texture parts under the names Vectorworks gives them: **Overall** for the whole object; **Top**, **Bottom** and **Sides** of an extrude, sweep or multiple extrude; a wall's **Left**, **Right**, **Start Cap**, **End Cap**, **Top**, **Bottom** and **Holes** and its components; a slab's **Top**, **Bottom** and **Sides**; a mesh's materials; and a plug-in's own parts by number. A 3D object without parts takes a texture on the whole of it.

For each part it sets:

- **Texture:** none, the class's or one of the drawing's. A part other than Overall set to none shows the Overall texture.
- **Map Type:** how the image is laid on the faces (below).
- **Offset H** and **Offset V**, **Scale** and **Rotation:** where one repeat of the image sits, how large and turned how far.
- **Radius**, for Sphere and Cylinder: the radius the image is wrapped at.
- **Flip Horizontal:** mirrors the image.
- **Repeat Horizontally** and **Repeat Vertically:** off, the image shows once that way and its edge runs on beyond it.
- **Align to Longest Edge**, **Use World Z** and **Use World Origin**, for Auto-Align Plane.

**Texture a part on its own** adds a Top, Bottom or Sides part to an extrude, sweep or multiple extrude, starting as a copy of Overall. That face then takes its own texture and mapping.

### Map types

- **Auto-Align Plane:** each flat face is projected on its own plane, so the image is undistorted on every face. It runs across the face and up it; Align to Longest Edge runs it along the face's longest edge instead. With Use World Origin the image is measured from the drawing's origin, so it carries on across neighbouring objects; without, from the object's own corner, so it moves with the object.
- **Plane:** one projection through the whole object. Faces square to it show the image; faces edge-on to it show streaks, as in Vectorworks.
- **Surface UV:** each flat face is laid on its own plane from the object's corner, and an extrude's curved sides take the image along their outline. It is what Vectorworks gives new extrudes and solids since 2022.
- **Perimeter:** the image wraps round an extrude's sides along its outline, without a seam at the corners, and lies flat on its caps.
- **Cylinder** and **Sphere:** the image wraps round an axis or a centre at the Radius. Choosing one centres it on the object and takes the radius from the object's width.
- **Imported**, **Default** and **Shader** show only on a part that already has them (a mesh's own UV map, an image prop). Choosing another map type replaces them.

A part Vectorworks never mapped says so. It is drawn by the default (Auto-Align Plane from the world's origin) until one of its settings changes.

### Attribute Mapping in 3D

In the 3D view the **Attribute Mapping** tool works on textures. Click a textured face: one repeat of the image is outlined on it, with a square at its origin corner and two round handles.

- Drag inside the outline to slide the texture across the face.
- Drag the round handle at the end of the first edge to turn it about the origin corner. <kbd>⇧</kbd> keeps the turn to 15° steps.
- Drag the round handle at the far corner to scale it about the origin corner.

The change is made when the drag ends, as one undo step, and the Render tab shows the new numbers. <kbd>Esc</kbd> gives up a drag, or drops the pick. On an extrude's top, bottom or sides that has its own part, the tool works on that part alone.

A face still drawn by the default mapping needs a second click, which maps the texture on the object itself (Auto-Align Plane without Use World Origin) so that it can be moved.

Right-click a face with the tool for the texture commands below and **Texture This Face on Its Own**, which gives an extrude's top, bottom or sides its own part.

### Texture commands

Right-clicking a part's heading in the Render tab, or a textured object in the drawing (every textured part of it), gives these, each one undo step:

- **Rotate Texture by 90°**
- **Reset to Default Mapping** (no offset, scale 1, no rotation, not flipped)
- **Remove Texture Override:** an extrude's Top, Bottom or Sides part is removed, so the face shows the Overall texture again. On any other part the texture is set to none; from the drawing, the whole object's texture only.
- **Locate in View** (from a part's heading): shows the 3D view fitted to the object, with that part's faces outlined for a moment.

The heading's menu also folds or opens every part (**Expand All**, **Collapse All**).

**Limits:**

- Vectorworks' developer documents name the map types and their settings but not their arithmetic, so how each one lays the image is Rodeo's own reading. Plane mapping on 3D polygons and Surface UV on flat panels were checked against real drawings; on other objects where a repeat starts, and which way round a wrapped image runs, may differ from Vectorworks. One real drawing's solid with a Perimeter mapping shows its image turned half round in Rodeo.
- Use World Z is kept and written but doesn't change how Rodeo draws.
- Flip Horizontal isn't applied to a 3D polygon's plane mapping or to a mesh's own UV map.
- With a repeat off, Rodeo runs the image's edge colour on beyond it.
- Only an extrude's, sweep's and multiple extrude's Top, Bottom and Sides can be added or removed as parts. A wall's sides, caps and holes, a slab's and a roof's parts are listed and edited, but Rodeo draws walls and slabs by their components and whole-object part, not by those.
- Picking one face among several of a solid, and decals (a second image over a texture), aren't done: no drawing Rodeo has seen holds a decal, so how one is stored isn't known.
- A few plug-in objects hold further groups of parts that Rodeo leaves as they are.
- Nothing Rodeo writes here has been opened in Vectorworks.
