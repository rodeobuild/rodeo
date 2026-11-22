// (part of the vs module: see index.ts)
//
// Walls: a Wall makes a plain wall (no style, no components) on the active layer, as addPlainWalls
// does; the heights, thickness and joins of a wall the drawing holds are read from the snapshot, and
// the changes Rodeo can make are steps (walls in wallsSteps.ts). The calls Rodeo can't give raise the
// module's NotImplementedError; wall-calls.md in the scratch folder says what each one is.

export const VS_WALLS = String.raw`
# The default wall a Wall call makes: 150 mm (or 6 inches) thick and 2700 mm (or 8 feet) high, which
# are the drawing's plain-wall sizes (the second of four, and the storey height). SetWallWidth changes
# the thickness for the run; a drawing with feet and inches gets the inch sizes.
_WALL_DEFAULTS = {"width": None}


def _wall_run_start(state, snap):
    _WALL_DEFAULTS["width"] = None


_INIT_HOOKS.append(_wall_run_start)


def _wall_imperial():
    return _S.format in (1, 3)


def _wall_default_width():
    return _WALL_DEFAULTS["width"] if _WALL_DEFAULTS["width"] is not None else (152.4 if _wall_imperial() else 150.0)


def _wall_default_height():
    return 2438.4 if _wall_imperial() else 2700.0


def _wall_of(h, call):
    # the wall a handle names, as the snapshot holds it (mm); an error for an object that isn't a wall
    if not isinstance(h, Handle):
        raise TypeError("vs.%s expects a handle to a wall, got %r" % (call, h))
    o = _obj(h, "a wall")
    w = o.get("wall")
    if w is None:
        raise TypeError("vs.%s: the object is not a wall" % call)
    return o, w


def _wall_height_of(w):
    return w["top"] - w["bottom"]


def _wall_add(x1, y1, x2, y2, thickness, bottom, top):
    # a plain wall on the active layer, in the class and group the drawing is building, as _add adds an object
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    cls = s.active_class
    s.ops.append(["wall", tmp, s.active_layer, [x1, y1, x2, y2], thickness, bottom, top, None if cls in (None, "None") else cls])
    half = thickness / 2.0
    o = {
        "id": tmp, "type": 68, "typeName": "wall", "layer": s.active_layer, "parent": s.pio,
        "cls": cls, "name": "", "sel": False, "attrs": dict(s.new_attrs), "shape": None, "records": {}, "sym": None,
        "wall": {"start": [x1, y1], "end": [x2, y2], "thickness": thickness, "bottom": bottom, "top": top, "style": None},
        "bbox": [min(x1, x2) - half, min(y1, y2) - half, max(x1, x2) + half, max(y1, y2) + half],
    }
    s.objs[tmp] = o
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    if s.groups:
        s.groups[-1].append(tmp)
    s.last_new = tmp
    return tmp


def Wall(*z):
    """A plain wall from p1 to p2, given as two points or as the four numbers p1X, p1Y, p2X, p2Y (Vectorscript)."""
    if len(z) == 2:
        (x1, y1), (x2, y2) = z
    elif len(z) == 4:
        x1, y1, x2, y2 = z
    else:
        raise TypeError("vs.Wall takes two points or four numbers")
    x1, y1, x2, y2 = _mm(x1), _mm(y1), _mm(x2), _mm(y2)
    width = _wall_default_width()
    height = _wall_default_height()
    if not (x1 != x2 or y1 != y2):
        raise ValueError("vs.Wall: a wall needs a length, and this one's ends are the same point")
    _wall_add(x1, y1, x2, y2, width, 0.0, height)
    return None


def WallWidth(wallHd):
    """The thickness of the wall, in the drawing's units."""
    _, w = _wall_of(wallHd, "WallWidth")
    return _un(w["thickness"])


def GetWallThickness(h):
    """(found, thickness): found is True for a wall; the thickness is 0 for anything else."""
    o = _obj(h, "a wall") if isinstance(h, Handle) and h._id in _S.objs else None
    w = o.get("wall") if o else None
    if w is None:
        return (False, 0.0)
    return (True, _un(w["thickness"]))


def GetWallWidth():
    """The default wall width the Wall call uses, in the drawing's units."""
    return _un(_wall_default_width())


def SetWallWidth(widthDistance):
    """Sets the default wall width for the rest of the run."""
    v = _mm(widthDistance)
    if v <= 0:
        raise ValueError("vs.SetWallWidth: the width must be more than 0, not %r" % widthDistance)
    _WALL_DEFAULTS["width"] = v
    return None


def WallHeight(wallHd):
    """(startHt, endHt): the wall's height at each end, in the drawing's units (a wall has one height here, so both are equal)."""
    _, w = _wall_of(wallHd, "WallHeight")
    ht = _un(_wall_height_of(w))
    return (ht, ht)


def GetWallOverallHeights(theWall):
    """(top, bottom): the wall's top and bottom above its layer, in the drawing's units."""
    _, w = _wall_of(theWall, "GetWallOverallHeights")
    return (_un(w["top"]), _un(w["bottom"]))


def GetWallCornerHeights(theWall):
    """(startTop, startBottom, endTop, endBottom): a wall has the same height at both ends here."""
    _, w = _wall_of(theWall, "GetWallCornerHeights")
    top, bottom = _un(w["top"]), _un(w["bottom"])
    return (top, bottom, top, bottom)


def _wall_set_heights(call, h, bottom, top):
    # a new bottom and top for a wall the drawing holds: the snapshot says so for the rest of the run
    o, w = _wall_of(h, call)
    if not (top > bottom):
        raise ValueError("vs.%s: the top of a wall is above its bottom" % call)
    _S.ops.append(["wallheights", o["id"], bottom, top])
    w["bottom"], w["top"] = bottom, top
    return None


def SetWallHeights(h, startHtDistance, endHtDistance):
    """Sets a wall's height from its bottom; both ends must give the same height, since Rodeo's walls have one height."""
    if float(startHtDistance) != float(endHtDistance):
        raise NotImplementedError("vs.SetWallHeights with two heights (a sloping wall) isn't available in Rodeo yet")
    _, w = _wall_of(h, "SetWallHeights")
    _wall_set_heights("SetWallHeights", h, w["bottom"], w["bottom"] + _mm(startHtDistance))
    return True


def HWallHeight(wallHd, startHeightDistance, endHeightDistance):
    if float(startHeightDistance) != float(endHeightDistance):
        raise NotImplementedError("vs.HWallHeight with two heights (a sloping wall) isn't available in Rodeo yet")
    _, w = _wall_of(wallHd, "HWallHeight")
    _wall_set_heights("HWallHeight", wallHd, w["bottom"], w["bottom"] + _mm(startHeightDistance))
    return None


def SetWallCornerHeights(theWall, startHeightTop, startHeightBottom, endHeightTop, endHeightBottom):
    """Sets a wall's top and bottom above its layer; both ends must agree, since Rodeo's walls have one height."""
    if (startHeightTop, startHeightBottom) != (endHeightTop, endHeightBottom):
        raise NotImplementedError("vs.SetWallCornerHeights with different heights at the ends isn't available in Rodeo yet")
    return _wall_set_heights("SetWallCornerHeights", theWall, _mm(startHeightBottom), _mm(startHeightTop))


def GetWallStyle(theWall):
    """The wall style's name, or "" for a plain wall (Rodeo's reading: the style the snapshot holds)."""
    _, w = _wall_of(theWall, "GetWallStyle")
    return w.get("style") or ""


def GetWallControlOffset():
    """The control line's offset from the middle of the wall: 0, since Rodeo's walls are drawn on their middle."""
    return 0.0


def SetWallControlOffset(offset):
    if float(offset) != 0:
        raise NotImplementedError("vs.SetWallControlOffset with an offset isn't available in Rodeo yet: walls are drawn on their control line")
    return None


def ReverseWallSides(theWall):
    """Swaps the wall's sides by reversing its direction: its ends swap, so its left and right change places."""
    o, w = _wall_of(theWall, "ReverseWallSides")
    _S.ops.append(["wallreverse", o["id"]])
    w["start"], w["end"] = w["end"], w["start"]
    return None


def JoinWalls(firstWall, secondWall, *rest):
    """Joins two walls like the Wall Join tool: joinModifier 1 T, 2 L, 3 X (auto, 4, isn't available). The points clarify
    which ends join: (firstWallPt, secondWallPt) as two points, or the four numbers as Vectorscript passes them, then
    joinModifier, capped and showAlerts. Rodeo can't report a join that fails before the run ends, so a join it
    refuses fails the whole run with the reason, and the call answers True."""
    if len(rest) == 7:
        p1, p2 = (rest[0], rest[1]), (rest[2], rest[3])
        modifier, capped, alerts = rest[4], rest[5], rest[6]
    elif len(rest) == 5:
        p1, p2, modifier, capped, alerts = rest[0], rest[1], rest[2], rest[3], rest[4]
    else:
        raise TypeError("vs.JoinWalls takes the two walls, two points, a join modifier and whether to cap it")
    kinds = {1: "T", 2: "L", 3: "X"}  # the appendix's codes; the alerts flag is not used (a refused join fails the run)
    if int(modifier) not in kinds:
        raise NotImplementedError("vs.JoinWalls with join modifier %r (automatic join) isn't available in Rodeo yet: use 1 (T), 2 (L) or 3 (X)" % modifier)
    _, _w1 = _wall_of(firstWall, "JoinWalls")
    _, _w2 = _wall_of(secondWall, "JoinWalls")
    _S.ops.append(["walljoin", _obj(firstWall, "a wall")["id"], _obj(secondWall, "a wall")["id"], kinds[int(modifier)],
                   [_mm(p1[0]), _mm(p1[1])], [_mm(p2[0]), _mm(p2[1])]])
    return True
`;
