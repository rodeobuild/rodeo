# Architecture: walls, doors, slabs and roofs

This page covers walls, doors and windows, slabs, columns, stairs, roofs and spaces, and the AEC menu's commands for walls and framing. Tools are in the Building Shell tool set unless noted.

## Walls

### Wall tool

With the **Wall** tool, click the start, then each corner. Every click past the first places a straight wall from the corner before, one undo step each, the last selected. A double-click, <kbd>Enter</kbd> or <kbd>Esc</kbd> ends the run, and <kbd>Shift</kbd> keeps each wall to 15° steps.

A new wall copies a straight wall the drawing has in the style Preferences chooses (one per style, thickness and height): square-ended, with no doors or windows in it, stretched along the line drawn. So its style, thickness, heights, components, plan drawing and 3D are that wall's. It goes on the active layer in the active class.

A drawing with no styled walls, a new blank one among them, also offers plain walls: 4", 6", 8" and 1' thick and 8' high, or 100 to 300 mm and 2700 mm high in metric. A plain wall is a single white solid in plan and a box in 3D, with no components.

Each wall is mitred to the one before it, in plan and 3D, along the bisector of their corner. Clicking the run's start again closes it, mitring that corner too. A corner sharper than 150°, or walls too short for the cut, stay square. The components' outlines show the mitre as a line across the corner.

Starting or ending at a wall already on the layer:

- **A click on the end of a wall** starts or ends the run there, the two mitred at the corner (unless that wall is joined there already or holds a door or window).
- **A click on a wall's side** starts or ends the run at that wall's face, the new wall's end cut along the face (a tee, refused under 15°). The wall met stays as it is, its face line crossing the joint.

A run ends at a wall it joins.

**Limits:**

- Plain walls are not yet opened in Vectorworks.
- No Vectorworks join records are written, and joined walls are untested in Vectorworks.

### Changing a wall in Object Info

Selected, a wall's Object Info sets these, one undo step each:

- its start and end
- its length (from the start)
- its bottom and top (both above its layer)
- its height

Each point of its drawing and 3D goes with the end it is at, so its thickness, components and mitred or cut ends keep their shape, and its 3D stretches between its new bottom and top.

Walls joined to it follow:

- A wall mitred to it at a corner where only the two meet follows an end that moves, and every corner of a wall that moves, turns or follows is mitred again along the line through where their faces cross.
- A wall meeting its side at a tee, or a mitred one's, slides its end along its own line, each point there as deep in it as it was, so each of its components stays joined.
- A wall whose end meets the moving end at the same point (three walls or more meeting there, or two cut as Vectorworks cuts its own corners) goes to where that end went, and one butted into the end goes with it as the end went, each keeping its cut.
- Walls stacked on it at other heights stay as they are.
- A joined wall that can't follow (an end through a door) refuses the move.

The doors, windows and symbols set in it, their openings and anything else between its ends keep their place from the end that stays put (the start when both move), turning with it. They keep their height above its bottom as its top moves.

These are refused, saying why:

- an end that would pass through one
- a top that would come down through one
- a wall sloping over its doors and windows
- a wall too short for its cut ends

Its style and thickness stay read only.

### Wall Join

The **Wall Join** tool joins two walls already drawn. Click a wall on the part to keep, then the other.

- **T Join** (1) runs the first wall's end to the second's face toward the first's other end, cut along it, the second staying as it is.
- **L Join** (2) takes an end of each to where their lines cross and mitres the corner as the Wall tool does.
- **X Join** (3), for walls crossing between their ends, breaks the first where they cross (as [Split](editing.md) does) and runs each part to the second's face toward it, cut along it, as two tees.

Where a wall crosses the other, the part clicked stays; otherwise the end nearer the crossing goes. Joined walls then follow each other as the Wall tool's do. One undo step each.

These are refused, saying why:

- walls that never meet
- an end another wall meets already
- a tee at under 15° or past the wall's end
- ends not cut straight across

**Limits:** the wall met keeps its face lines across the joint: Vectorworks' cleanup there isn't drawn yet.

## Doors and windows

### Door and Window

The **Door** and **Window** tools set a door or window in a straight wall. Click the wall where its middle goes: the side of the wall you click is the side it opens to. The tool's **Preferences** hold what a new one is: a door's configuration (swing, bi-part, pocket, sliding, bi-fold, barn, overhead, revolving, a plain or cased opening), width and height; a window's sash (fixed, casement, awning, hopper, hung, sliding, pivot, louver), width, height and sill height. The drawing needs no door of its own to start from, and the wall can already hold others.

Rodeo cuts the opening through the wall: its plan drawing stops at the jambs, component by component, and its 3D has the hole. The door or window is a Vectorworks Door or Window object with Vectorworks' own parameters, so a schedule or a worksheet reads its width and height as it reads any other, and Rodeo draws it from them: the frame, the leaf and its swing, glazing, sashes, sill and trim in plan, and the same as solids in 3D.

One undo step; the new door or window is selected afterwards, and the tool stays active for the next.

A click is refused, saying why, when the opening would reach the wall's end or another door's or window's opening.

### Changing a door or window

Select it (a click with the **Select** tool picks it out of its wall) and **Object Info** lists its parameters: a door's configuration, width, height, leaf, thicknesses, jamb, open angle, threshold, transom, sidelights and trims; a window's sash, width, height, elevation, jamb, sashes, columns and rows, sill and trims. A change draws it again and recuts the opening to the new size.

- **Move it** by dragging, nudging or **Move**: it slides along its wall, the wall closing where it stood and opening where it goes. Dragged onto another straight wall, it goes into that wall, which is cut, and the wall it left closes.
- **Flip it** with Object Info's **Flip Side** (to the wall's other side) and **Flip Hinge** (end for end), **Modify › Flip in Wall**, or Flip Horizontal and Flip Vertical. A half turn does both. Other turns are refused: a door in a wall turns with its wall.
- **Duplicate** copies it along the wall, by the offset or just clear of itself, with an opening of its own.
- **Delete** removes it and closes the wall.
- **Modify › Take Out of Wall** closes the wall and leaves the door or window standing beside it, a free object that can be turned, grouped or put on another layer. Grouping one that is in a wall takes it out first.

Each is one undo step.

Doors, windows and symbols Vectorworks set in walls move, flip, copy and delete the same way. Rodeo reads the opening from the wall as it is drawn, so it closes whatever Vectorworks cut there, finishes wrapped round the jambs included. A door or window Vectorworks drew keeps its drawing until you change one of its parameters; it is then drawn Rodeo's way, which is plainer.

**Limits:**

- Nothing Rodeo writes of this has been opened in Vectorworks. The wall's record is kept in step as far as its layout is known (the opening's entry moves, flips, goes or is added with the door); what Vectorworks does on opening such a wall isn't known.
- Round walls take no doors or windows yet.
- A wall's 3D is rebuilt component by component round the opening. A component Rodeo can't take apart there (its faces lean both along and across the wall, or it differs on the two sides of the opening) stays as it was, and a message says how many did; the plan drawing is right either way. A new door or window is refused when none of the wall's 3D can be cut for it. A deleted one goes anyway, and the wall then keeps the opening in 3D.
- Some components of walls from Vectorworks can't be kept the way Vectorworks keeps them once Rodeo has changed them, and are kept as meshes inside the wall instead. They look the same and move with the wall, but stay as they are if the wall's end is later stretched or joined again.
- Rodeo cuts square holes: a round window moved along its wall gets a square opening.
- Rodeo cuts square: it doesn't wrap finishes round the jambs as Vectorworks can, and closing an opening removes the wraps it had.
- An opening at the very end of a wall (a corner window) closes in 3D but stays open in the plan drawing.
- Symbols set in walls slide and delete, but can't be flipped, copied along the wall or moved to another wall yet.
- In a drawing where no wall has a door, window or symbol yet, a new opening is cut and drawn, but the wall's record gets no entry for it (Rodeo copies an entry from a wall with as many components; it can't yet write one from nothing). Rodeo's own walls keep no such record at all.
- Of a door's and window's several hundred Vectorworks parameters, Rodeo draws from those listed above. Muntins, shutters, lintels, splays, hardware and ID tags are kept in the record and not drawn.
- A transom's height uses the door's Top Panel Height field, since the 2023 layout has none of its own.

## Slabs, columns and structure

### Slab

The **Slab** tool draws a rectangular slab between two corners, by press-drag-release or click-click (<kbd>Shift</kbd> for a square).

It copies a rectangular slab plug-in the drawing has in the style Preferences chooses (one per style and thickness), its parts stretched along the outline's sides onto the rectangle. So its style, thickness, heights, components and 3D are that slab's. It goes on the active layer in the active class, one undo step, selected.

**Limits:** slabs with other outlines, and styles whose 3D stands past the outline, can't be drawn yet.

### Column

With the **Column** tool, click to place a rectangular (key <kbd>1</kbd>) or round (key <kbd>2</kbd>) column, a press dragged turning it.

**Limits:** Vectorworks makes a column a plug-in object, with 3D; here it's plain objects in plan, grouped.

### Pilaster

With the **Pilaster** tool, click to put the middle of its shaft on a wall's face, a press dragged turning it along the wall. It draws, as set in Preferences:

- its shaft (rectangular or a half oval)
- its base and capital outlines
- its structural part (concrete, wood or a steel wide flange) at its offsets, with the clearance cut round it
- centre marks and column ID

### Structural Member

With the **Structural Member** tool, click a column's section (steel, concrete or wood), or a linear or polyline member drawn its breadth wide, aligned on its clicks. Its ends are run on, cut back or mitred, with caps and centre marks. Plain objects in plan.

## Stairs, ramps, elevators and escalators

### Stair

With the **Stair** tool, drag a straight stair from its foot to its head for its treads at the going in Preferences, its walk line and arrow, its break line and "UP".

**Limits:** Vectorworks makes a stair a plug-in object, with 3D; here it's plain objects in plan, grouped.

### Simple Stair and Ramp

The **Simple Stair**, **Ramp**, **Elevator** and **Escalator** tools all place the same way: click to place one, a press dragged turning it. They draw plain objects in plan, grouped.

Simple Stair and Ramp run straight, through a landing, turn left or right at one, or double back beside themselves. They draw:

- treads (a stair's risers from its height and maximum riser)
- stringers
- rails
- a path-of-travel arrow with each flight's risers and riser height
- a break line where a plan cut 1200 mm up crosses them

### Elevator

**Elevator** draws the hoistway, the cab crossed inside and its doors (single slide, side bi-pass or bi-part) standing open, front and rear.

### Escalator

**Escalator** draws its truss, steps, handrails and balustrades, cut Up or Down at the break, with its pit and the opening the floor above needs.

## Roofs

### Create Roof

**AEC › Create Roof** makes a roof over walls or a closed shape, hipped all round with valleys at inward corners, or gabled where you click an edge in the dialog. The eave's cut, thickness and levels are set as in Vectorworks.

**Limits:** it's a plain group of plan and solid, so to change it, make it again.

### Roof Face

**AEC › Roof Face** turns a closed shape into one sloping roof plane.

1. Draw the shape the roof covers, select it, and choose **AEC › Roof Face**.
2. In the dialog, choose how the slope is given:
   - an **Angle**;
   - a **Rise over Run**;
   - **2nd Click Height**, the height where you'll click.
3. Set the cuts and levels, then click **OK**:
   - the **Eave Cut**: Vertical, Horizontal, Double or Square;
   - the **Hole Cut**: Vertical, Splayed or Square;
   - **Axis Z**, the underside's height at the axis;
   - the **Thickness**.
4. Click the start and end of the roof's axis, or drag along it. An arrow shows which side rises.
5. Click the side that rises. With 2nd Click Height, click where the roof is that high.

Object Info changes the angle, rise and run, levels and cuts, and shows its area. Reshape moves its corners. **Modify › Surfaces › Clip Surface** with a shape on top cuts a hole in it.

**Limits:**

- The eave is each edge facing down the slope; the other edges are cut vertically.
- There are no roof styles, components, dormers or skylights.
- Roof faces can't be joined to each other.
- Vectorworks sees it as a plug-in drawn in plan and 3D, not its own roof face object.

## Spaces and space planning

### Space

With the **Space** tool (Space Planning tool set), draw a room as a rectangle or polygon, click inside walls, or pick the walls round it. Its name, number and area are labelled, the numbers counting on.

**AEC › Space Planning** has:

- **Create Spaces from Walls** finds every room, or the gross floor, and run again reshapes them to moved walls.
- **Create Spaces from Polys** converts shapes.
- **Create Walls from Spaces** makes exterior and interior walls in the styles you choose.
- **Update Spaces** re-measures them.

**Limits:** a space is a group with its data in a record, not a Vectorworks Space object, and has no finishes or 3D volume.

### Adjacency tools

The Space Planning tool set's adjacency tools are Space Link, Adjacency Score, Adjacency Matrix, Stacking Diagram:

- **Space Link**: link two spaces with a click on each. The stronger the link (1 to 18, in Object Info), the heavier its line.
- **Adjacency Score** adds up each link's length × strength, the lower the better.
- **Adjacency Matrix** lists the spaces in a diamond grid of strengths, ordered by each space's Matrix Order.
- **Stacking Diagram** shows each layer's spaces as wide as their areas, stacked by layer elevation and grouped by Department.

All of them follow the spaces as you move them, in the same undo step, and a link goes when its space does.

### Import Adjacency Matrix…

**AEC › Space Planning › Import Adjacency Matrix…** imports a tab- or comma-delimited adjacency spreadsheet and builds the spaces, links, matrix and stacking diagram.

**Limits:**

- The adjacency tools read Rodeo's spaces, not Vectorworks' own Space objects.
- Imported spaces are squares in rows.
- Link length is centre to centre.
- The score's unit and Row Spacing 0 files are this app's reading of the help.

## Walls, shapes and hybrids from the AEC menu

These commands are in the AEC menu.

### Create Objects from Shapes…

**AEC › Create Objects from Shapes…** turns the selected lines, rectangles, polygons and polylines into walls or slabs, in a style the drawing has (the ones the Wall and Slab tools copy).

- Walls run along each side from corner to corner, each mitred to the one before, and round a closed shape the last to the first; corners closer than 1 unit merge.
- A slab covers each rectangle square to x and y.
- **Delete Source Shapes** takes the shapes away.

They go on the shape's layer in the active class, in one undo step, and are selected.

**Limits:** polylines with curves, rounded rectangles and circles are refused.

### Create Polys from Walls…

**AEC › Create Polys from Walls…** draws a polygon round the outside of the selected walls (Gross Area Polys) or inside each room they close (Net Area (Room) Polys). Each wall is taken as the area its plan drawing covers, with door and window gaps filled.

### Dimension Exterior Walls…

**AEC › Dimension Exterior Walls…** dimensions every building the walls on a layer make, on all four sides, each chain further out:

- its doors and windows (edges or centres, and the walls meeting it from inside)
- its corners and jogs
- its overall size

The chains go to the outer faces or the centrelines, with small spans drawn in red.

### Pillar…

**AEC › Pillar…** stands the selected shapes up to a height, closed ones as extrudes and open ones as flat screens.

### Create Auto Hybrid

**AEC › Create Auto Hybrid** holds the selected 3D objects in an object that 3D views show as they are, and Top/Plan as a plan worked out from them: where a level cut plane goes through them, and the edges below and above it, those out of sight dashed or left out.

2D Appearance sets the cut's height and each part's class, fill and pen. **Modify › Edit Auto Hybrid** opens the objects to change, and leaving them draws the plan again.

## Framing

### Create Joists…

**AEC › Framing › Create Joists…** frames the selected closed shape:

- joists the spacing apart along two clicks, cut to the perimeter members round its edge (lapped or mitred)
- headers round openings selected inside it
- a Joist Take-Off worksheet when the drawing has a worksheet to copy one from

Each member is a group of its plan and a solid.

### Wall Framer…

**AEC › Framing › Wall Framer…** frames the walls on the layers ticked: studs the spacing apart, plates, and king and jack studs, headers, cripples and sills round each door and window, with each wall class's own spacing and lumber.

They're drawn on the framing model's own layers in 3D, in plan and as a diagram of each wall, with take-off and wall info worksheets when the drawing has a worksheet to copy one from.

### Roof Framer…

**AEC › Framing › Roof Framer…** frames the selected roofs from their 3D faces, each kind in its class, with a Roof Framing Take-Off worksheet:

- rafters down each slope (jacks at the hips and valleys)
- ridges, hips and valleys where slopes meet
- level purlins and plates under the eaves

### Simple Beam Calculator…

**AEC › Framing › Simple Beam Calculator…** works out a beam's reactions, end moments, greatest shear and bending moment, bending stress and greatest deflection as the values are typed. It has twelve configurations (simple, fixed at both ends, propped cantilever and cantilever, under a uniform load or concentrated loads), in Imperial or Metric units.
