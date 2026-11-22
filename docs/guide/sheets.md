# Sheets, viewports and worksheets

This page covers viewports on sheets and their data visualisations, worksheets, schedules and reports, and the title block borders and section lines placed on sheets.

## Viewports

### Create Viewport…

**View › Create Viewport…** makes a plan viewport on a sheet, of the design layers and at the scale chosen, in blank drawings too.

### Create Detail Viewport…

**View › Create Detail Viewport…** makes a viewport of a detail from a closed shape drawn round it, on a design layer or on a sheet over a plan viewport. It is named by its drawing and sheet numbers, with a callout round the crop and a drawing label under it.

### Create Section Viewport…

**View › Create Section Viewport…** cuts the 3D model along a Section-Elevation Line, or a plain line or polyline, and draws what it sees on a sheet. Select the line first. The cut is filled in each object's colour with a heavier outline, and the edges beyond it are drawn where nothing nearer hides them.

Look sets which side of the line, as drawn, the view faces; a section line's arrows set it for you. Display extents beyond cut plane draws what lies beyond, as far as the limit (0 for no limit); untick it to draw the cut alone. The viewport is named by its drawing and sheet numbers, with a drawing label under it.

**Limits:** the drawing is made as the model is then, and stays so till you update it (see Update Selected Viewports). A line with corners is cut straight from its first point to its last. Only what lies across the line's length is drawn. The section line's bubbles aren't renumbered, and there are no render modes or section styles.

### Create Interior Elevation Viewport…

**View › Create Interior Elevation Viewport…** draws up to four elevations of a room's walls, one for each way an Interior Elevation Marker's arrows point. Select the marker (Dims/Notes), or a closed shape drawn round the room, first. Each look is named North, East, South or West by the way it faces, and gets a number and title in the dialog; the marker's numbers start them.

Each elevation runs from the wall behind the look to the wall in front, across from wall to wall and up from floor to ceiling, drawn as a section viewport is. A shape gets an Interior Elevation Marker at its middle with the numbers.

**Limits:** the walls are found straight out from the marker's middle, 1 m above its layer, so something in the way (a column, a tall cupboard) stops a look short; draw a shape round the room to set the walls yourself. The viewports are drawn as the model is then, till updated, and aren't linked to the marker.

### Create Horizontal Section Viewport…

**View › Create Horizontal Section Viewport…** cuts the 3D model level at a height above the active design layer and draws the plan it makes on a sheet: walls and other objects the cut passes through filled, and what lies below drawn in thin lines where nothing nearer hides it. Set the Cut Plane height in the dialog (1200 mm at first), and how far below to look.

**Limits:** the cut is drawn as the model is then, till updated. Nothing above the cut plane is drawn, the height is measured from the active layer only, and 2D objects aren't cut.

### Create Multiple Viewports…

**View › Create Multiple Viewports…** (⇧⌘M) draws the 3D model's Front, Top, Right, Left, Bottom and Back views, and an isometric, as a set of viewports at one scale. Choose the views and the projection method:

- **Third angle** puts Top above Front and Right to its right. It's the default for drawings in inches or feet.
- **First angle** puts Top below Front and Left to its right. It's the default for metric drawings.

The views line up with Front and are centred on the active sheet layer, or on a new sheet layer when a design layer is active. The isometric is Right Isometric in third angle and Left Isometric in first.

**Limits:** the views are drawn hidden-line, as the model is then, till updated. There are no viewport styles.

### Update Selected Viewports and Update All Viewports

Section, interior elevation, horizontal section and multiple-view viewports are drawn as the model is when you make them. After the model changes, draw them again:

- **View › Update Selected Viewports** redraws the selected viewports.
- **View › Update All Viewports** redraws every one on every sheet layer.
- Right-click a viewport and choose **Update** to redraw just that one.

Each is cut again through the same plane, of the same design layers, leaving out the classes hidden in it. The new drawing takes the old one's place, the viewport's box grows or shrinks to fit, and anything you added to its annotations stays. One undo puts everything back.

**Limits:** plan viewports already draw live, and viewports from Vectorworks files show the drawing saved in the file, so neither changes. Out-of-date viewports aren't marked, and nothing updates on its own before printing or exporting.

### How viewports draw

Plan viewports draw the design layers they list, live (edits on a design layer show on every sheet), with the viewport's class overrides and grayed layers. Section, elevation and detail viewports draw their cached drawings, with a cached Renderworks render under their line work.

Both are placed at the viewport's scale and rotation and cropped as on the sheet, with their annotations (dimensions, tags, grid bubbles) where Vectorworks puts them. Edges Vectorworks hides and crop objects (often filled white) are left out. Drawings are cropped to the crop object's shape (polygons, rounded rectangles), annotations to the box.

PDF and SVG exports of a sheet include its plan drawings, cropped to their viewports.

### Moving and editing a viewport

Click a viewport's drawing to select the viewport and drag to move it, drawing, annotations and all.

Duplicate, Duplicate Array, Move by Points with copy, and copy and paste make a viewport of its own, with its drawing, annotations and crop. Pasted into another drawing, it needs the layers and classes it shows there; without them the paste is refused.

Scale Objects and Flip leave viewports as they are: a viewport's size follows its scale and crop, so change its scale in Object Info. Rotate does not turn viewports yet.

Object Info edits a viewport's:

- scale (the drawing and its annotations rescale about the box's centre)
- crop edges
- which design layers it shows, and their visibility
- class overrides

### Edit Annotations

**Edit Annotations** (right-click a viewport, or double-click it) opens its annotations as the active layer at the viewport's scale, over what it shows. Every tool draws and snaps there, the viewport's drawing included. **Exit Viewport Annotation** goes back to the sheet.

### Data visualisation

A plan viewport applies the data visualisations it lists. It redraws the objects that match their criteria (plug-in type, layer, class, story, object type for slabs) with the fill and pen of their value: for every object, by class or by object style or by material. For example:

- wall cabinets dashed with no fill
- floor slabs hatched by finish
- shading devices in a highlight colour
- framing hidden on a ceiling plan
- lower floors greyed on a roof plan
- steel columns black

Section, elevation and detail viewports apply theirs to the drawing they cache, piece by piece by class and material (cut framing greyed under its batt insulation on a wall section).

Fills can be none, solid, a pattern or a hatch; pens none, solid or a line type. Exports show them too.

## Worksheets

### Worksheets on sheets

Schedules placed on sheets (door, window and steel schedules, drawing lists) are drawn from the values their worksheets hold: database rows expanded and sorted, merged cells, fills, bold headers, and dimensions, areas and counts formatted as the worksheet says. They can be moved. When a worksheet's values change, every place it is shown redraws and resizes to its new lines, its top left corner staying put.

### Schedules that follow the drawing

A worksheet's formulas and database rows are worked out again after each change to the drawing, as part of that change, so one undo takes back both. Widen a door and its line in the door schedule shows the new width; place another door and it gets a line; delete one and its line goes. On a big drawing (some tens of thousands of objects) this waits for a pause in the editing. **Tools › Reports › Recalculate Worksheets** does it at once.

Schedules made in Vectorworks follow the drawing too, where Rodeo can read what they ask for (see the limits under Edit Worksheet…). What it can't work out keeps the values the file holds.

### Create Schedule…

**Tools › Reports › Create Schedule…** makes a door, window, room or room finish schedule in one step: a worksheet with a title, a row of headings and a database row that lists every door or window set to show on schedules, or every room. It works in a drawing that has no worksheet yet.

- A door schedule shows each door's mark, width, height, thickness, type, leaf, material, head, jamb and threshold details, manufacturer, model and notes.
- A window schedule shows mark, width, height, glazing, head, jamb and sill details, manufacturer, model and description.
- A room schedule shows each Space's number, name, type, department, area, perimeter and clear height. The name is the one the Space shows.
- A room finish schedule shows number, name, the floor, base, four wall and ceiling finishes, and remarks.

Columns the drawing's objects don't have are left out, and the message says which. The schedule is sorted by mark or number. Choose **Place on** to put it on a sheet or design layer straight away; it then opens in the worksheet editor, where its columns can be changed.

**Limits:** it reads doors, windows and Spaces as Vectorworks' own Door, Window and Space objects keep them, and a schedule can be made once the drawing has one of them. Rooms kept the older way (groups with a Space Data record) get a room schedule of number, name, department, area and height, and no finish schedule.

### Worksheet on Drawing…

**Tools › Reports › Worksheet on Drawing…** shows a worksheet on a layer and selects it. On a sheet layer it goes at the top left of the page; on a design layer it is drawn at the layer's scale, at the top left of the window.

### Edit Worksheet…

A worksheet is edited in a grid. Open it with **Tools › Reports › Edit Worksheet…**, a worksheet's Resources tile, or a double-click on it on a sheet.

Pick a cell and type in the bar above the grid: a number, text, or a formula starting with `=`. Cell entries go into the drawing together on **Done**, as one undo step. The buttons above the grid add and delete rows and columns, and change the drawing at once.

Formulas are written as in Vectorworks: `=B2*C2`, `=SUM(D2..D9)`, `=IF((C7<100), 100, C7)`, `='Door Schedule':B4` for another worksheet's cell, `=COUNT((R IN ['Door']))` for how many objects meet criteria. Rodeo works out `+ − × ÷ ^`, comparisons, cell references and ranges, and SUM, AVERAGE, MIN, MAX, ROUND, INT, ABS, SQRT, the trigonometry functions, IF, CONCAT and VALUE.

A **database row** shows one line for each object that meets its criteria. Its own line in the grid shows each column's formula, with its lines under it. Double-click it, or pick an empty row and press **Database Row…**, to set what it lists and its columns:

- **Objects** picks the objects with a record, or type the criteria as Vectorworks writes them: `=DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))`. Rodeo follows `R IN ['Record']`, `PON='Plug-in name'`, `L='Layer'` and `'Record'.'Field'=value` or `<>value`, joined with `&` (and) and `|` (or).
- Each column has a formula, most often a field (`='Door'.'Width'`, from **Add field…**), or `=COUNT`, `=IF(…)`, `=CONCAT(…)` or one field times another.
- **Sort** orders the lines by a column. **Summarize** gives one line to the objects that agree in a column (with `=COUNT` beside it, a count of each kind). **Sum** adds a column's numbers up on summarized lines.

**Limits:**

- Some formulas can't be saved as Vectorworks formulas, because the file's codes for them aren't known: `+ − ÷ ^ < >`, FALSE, a cell reference, a range, SUM and the other maths functions. Rodeo still works such a formula out and keeps it with the drawing, but saves the cell as the value it comes to, so Vectorworks shows the value and not the formula. The same goes for a formula in a plain cell that comes to text. The editor says so when you pick the cell.
- A database row is saved as Vectorworks keeps one, so its criteria and columns can only use what can be saved: no `+`, no criteria by type, class, symbol or name, no column sorted descending.
- Not worked out, and shown as the file holds them: OBJECTDATA and the other functions that measure an object (AREA, LENGTH and VOLUME in a column among them), popup fields whose choices are numbered, the criteria switches of 2025 and 2026 files, and room areas given as whole numbers in some Vectorworks schedules.
- Cell formats, borders, fills and merged cells can't be set here; a new database column shows numbers plainly unless a schedule set its format.
- Nothing Rodeo writes here has been opened in Vectorworks yet.

### Create Report…

**Tools › Reports › Create Report…** makes a new worksheet listing objects from the selection, the active layer, or the visible or all design layers, optionally only those meeting Custom Selection's criteria. It works in a new drawing too.

It has the columns chosen: type, name, class, layer, area, perimeter, length and their record and plug-in fields. It is sorted and optionally summarized with counts and sums.

**Limits:** it holds the values as they are now. For a list that follows the drawing, use Create Schedule…, or a database row in the worksheet editor.

### Create Sheet List…

**Tools › Reports › Create Sheet List…** makes an index of the drawing's sheets.

1. The title block borders are listed on the left by sheet number and title. Move the ones you want to the **Proposed Sheet List** with **Add >** (or a double-click), and back with **< Remove**.
2. **New…** adds an entry of your own. **Move Up** and **Move Dn** reorder the list. The picked entry's **Sheet No.** and **Title** can be edited below it.
3. **Format…** chooses a **Text Block** or a **Worksheet**, and sets the heading and the text size.
4. Click **OK**. For a text block, click the top left corner of its area, then the bottom right. The entries wrap to that width, and a long title's continued lines sit under it.

A worksheet has a Sheet No. and a Title column and opens in the worksheet editor.

**Limits:**

- The worksheet isn't placed on the drawing.
- It is made from a worksheet the drawing has, so a drawing with none can only have a text block.

## Title blocks and section lines

### Title Block Border

With the **Title Block Border** tool (Dims/Notes), click to place an ISO, ARCH, ANSI or custom sheet's border at the layer's scale. Its zones are lettered and numbered in the margins, with grid extensions, crop marks and a title block (project, sheet title, drawn by, date, scale, sheet number). The border is plain objects, grouped.

### Section-Elevation Line

With the **Section-Elevation Line** tool (Dims/Notes), click a straight or broken cut line with a numbered bubble past each end, past its start only, or on its middle for an elevation, looking left or right. It is optionally gapped, its bubbles scaled. The line is plain objects, grouped.
