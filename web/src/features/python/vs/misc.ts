// (part of the vs module: see index.ts)

export const VS_MISC = String.raw`
# ---- alerts ---------------------------------------------------------------------------------
# An alert with choices is drawn in the editor (AlertChoice, miscSteps.ts) and the script waits for
# the button pressed. The codes are the ones the reference numbers the default button: 0 Cancel,
# 1 OK, 2 custom button A, 3 custom button B. The reference doesn't say what AlertQuestion returns,
# so Rodeo's reading is the code of the button pressed; Esc gives Cancel's code (OK's when there is none).

def _choose(title, text, advice, buttons, default, esc):
    got = _json.loads(_host("AlertChoice", title, str(text), str(advice or ""), _json.dumps(buttons), default, esc))
    return esc if got is None else int(got)


def AlertInform(text, advice, minorAlert):
    # the minor/major icon isn't drawn: the alert looks the same either way
    if not _S.jspi:
        _S.alerts.append(str(text))
        return None
    _choose("Script", text, advice, [{"code": 1, "label": "OK"}], 1, 1)
    return None


def AlertCritical(text, advice):
    # the critical icon isn't drawn: the alert looks like AlertInform's
    AlertInform(text, advice, False)
    return None


def AlertQuestion(question, advice, defaultButton, OKOverrideText, CancelOverrideText, customButtonAText, customButtonBText):
    buttons = [{"code": 0, "label": str(CancelOverrideText or "Cancel")}]
    if customButtonAText:
        buttons.append({"code": 2, "label": str(customButtonAText)})
    if customButtonBText:
        buttons.append({"code": 3, "label": str(customButtonBText)})
    buttons.append({"code": 1, "label": str(OKOverrideText or "OK")})
    codes = [b["code"] for b in buttons]
    default = int(defaultButton) if int(defaultButton) in codes else 1
    return _choose("Script", question, advice, buttons, default, 0)

# ---- progress dialogs -----------------------------------------------------------------------
# A browser worker can't repaint the editor while a script runs, so the progress dialog is accepted
# and not shown; the script's messages and meter go nowhere. ProgressDlgHasCancel answers False,
# since there is no dialog to cancel.

def ProgressDlgOpen(title, canCancel):
    return None


def ProgressDlgClose():
    return None


def ProgressDlgSetMeter(message):
    return None


def ProgressDlgSetTopMsg(message):
    return None


def ProgressDlgSetBotMsg(message):
    return None


def ProgressDlgStart(Percentage, LoopCount):
    return None


def ProgressDlgYield(count):
    return None


def ProgressDlgEnd():
    return None


def ProgressDlgHasCancel():
    return False

# ---- line markers ---------------------------------------------------------------------------
# A line, arc, polygon or polyline's markers at its first point (start) and last point (end). The
# styles Rodeo draws are arrow 0, dot 2 and slash 3 (the codes a file keeps: Rodeo's reading, the
# reference's comments on the codes aren't on its page). Thickness basis and thickness are accepted
# and kept nowhere: Rodeo's markers have no thickness of their own. A dot's width is its size.

_MARKER_STYLES = {0: "arrow", 2: "dot", 3: "slash"}
_MARKER_CODES = {"arrow": 0, "dot": 2, "slash": 3}
_MARKED_TYPES = (2, 5, 6, 21)


def _marked(h):
    o = _obj(h, "the object")
    if o["type"] not in _MARKED_TYPES:
        raise ValueError("%r can't have markers: only lines, arcs, polygons and polylines can" % (h,))
    return o


def _set_marker(h, end, style, angle, size, width, visibility):
    o = _marked(h)
    if not visibility:
        marker = None
    else:
        kind = _MARKER_STYLES.get(int(style))
        if kind is None:
            raise ValueError("vs marker style %r isn't one Rodeo draws (0 arrow, 2 dot, 3 slash)" % (style,))
        a = int(angle)
        if not 0 <= a <= 90:
            raise ValueError("a marker's angle is 0 to 90 degrees, got %r" % (angle,))
        sz = float(size)
        if not sz > 0:
            raise ValueError("a marker's size must be more than 0, got %r" % (size,))
        marker = {"style": kind, "size": sz, "angle": float(a), "width": sz if kind == "dot" else 0.0}
    _S.ops.append(["markers", o["id"], end, marker])
    marks = dict(o.get("markers") or {})
    marks[end] = marker
    o["markers"] = marks
    return True


def _get_marker(h, end):
    o = _marked(h)
    m = (o.get("markers") or {}).get(end)
    if not m:
        return (True, 0, 0, 0.0, 0.0, 0, 0.0, False)
    return (True, _MARKER_CODES[m["style"]], int(m["angle"]), float(m["size"]), float(m["width"]), 0, 0.0, True)


def SetObjBeginningMarker(obj, style, angle, size, width, thicknessBasis, thickness, visibility):
    return _set_marker(obj, "start", style, angle, size, width, visibility)


def SetObjEndMarker(obj, style, angle, size, width, thicknessBasis, thickness, visibility):
    return _set_marker(obj, "end", style, angle, size, width, visibility)


def GetObjBeginningMarker(obj):
    return _get_marker(obj, "start")


def GetObjEndMarker(obj):
    return _get_marker(obj, "end")

# ---- shapes ---------------------------------------------------------------------------------

def RectangleN(*args):
    # the origin and direction as two points, or as four numbers: the width runs from the origin
    # along the direction, the height turns counter-clockwise from it (Rodeo's reading) and makes a
    # closed polygon, not a rectangle object
    x, y, dx, dy, w, rh = _nums(args, 6, "RectangleN")
    n = _math.hypot(dx, dy)
    if not (n > 0 and w > 0 and rh > 0):
        raise ValueError("RectangleN needs a direction, and a width and height above 0")
    x, y, w, rh = _mm(x), _mm(y), _mm(w), _mm(rh)
    ux, uy = dx / n, dy / n
    vx, vy = -uy, ux
    p1 = (x + ux * w, y + uy * w)
    _add_poly([(x, y), p1, (p1[0] + vx * rh, p1[1] + vy * rh), (x + vx * rh, y + vy * rh)], True)
    return None


def Get2DPt(obj, index):
    # the vertex's place; an object with no vertices (a circle, a group) gives its centre, as the
    # reference says of groups
    o = _obj(obj, "the object")
    g = o.get("shape") or {}
    if g.get("pts"):
        pts = g["pts"]
        i = int(index)
        if not 1 <= i <= len(pts):
            raise ValueError("%r has %d vertices, not vertex %d" % (obj, len(pts), i))
        return _pt_out(pts[i - 1])
    c = g.get("center") or g.get("at")
    if c:
        return _pt_out(c)
    b = _box(o)
    if not b:
        raise ValueError("%r has no position" % (obj,))
    return _pt_out(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2))


def _segments(resolution):
    # the reference's magic numbers are 0, 8 ... 512 vertices a turn; 0 gives 32 here (Rodeo's reading)
    r = int(resolution)
    return 32 if r <= 0 else min(max(r, 8), 512)


def _curve_outline(o, resolution):
    """An object's outline in millimetres as (points, closed); curves are cut into the resolution's segments."""
    g = o.get("shape")
    k = g.get("kind") if g else None
    if k in ("polygon", "polyline", "rect", "line") and g.get("pts"):
        return [tuple(p) for p in g["pts"]], bool(g.get("closed", k == "rect"))
    if k == "arc":
        cx, cy = g["center"]
        n = _segments(resolution)
        full = abs(g["sweep"]) >= 360
        steps = n if full else n + 1
        pts = []
        for i in range(steps):
            t = _math.radians(g["start"] + g["sweep"] * i / float(n))
            pts.append((cx + g["rx"] * _math.cos(t), cy + g["ry"] * _math.sin(t)))
        return pts, full
    raise ValueError("vs.ConvertToPolygon can't convert %s objects in Rodeo yet" % (k or "this kind of"))


def _convert(h, resolution, polyline):
    # a new polygon (or polyline) beside the original (which stays): on its layer, in its class, with its attributes
    o = _obj(h, "the object")
    pts, closed = _curve_outline(o, resolution)
    saved = (_S.active_layer, _S.active_class)
    _S.active_layer, _S.active_class = o["layer"], o["cls"]
    try:
        if polyline:
            tmp = _add({"kind": "polyline", "points": [_pt(p) for p in pts], "closed": closed}, {"kind": "polygon", "pts": [list(p) for p in pts], "closed": closed})
        else:
            tmp = _add_poly(pts, closed)
    finally:
        _S.active_layer, _S.active_class = saved
    if o.get("attrs") is not None:
        _set_attrs(_h(tmp), o["attrs"])
    return _h(tmp)


def ConvertToPolygon(h, resolution):
    return _convert(h, resolution, False)


def ConvertToPolyline(h):
    # the reference: an enclosed shape becomes a polyline without polygonalizing; Rodeo keeps the same
    # vertices a polygon conversion would give (curves cut at 32 segments), so this is a guess for curves
    return _convert(h, 0, True)


def PointAlongPoly(h, dist):
    # a point the distance along the poly from its first vertex, and the unit tangent there; the
    # vectors are three numbers, the third 0 (the reference's note on tuples of VECTORs)
    o = _obj(h, "the poly")
    g = o.get("shape") or {}
    if not g.get("pts") or g.get("kind") not in ("polygon", "polyline", "rect", "line"):
        raise ValueError("%r isn't a polygon or polyline" % (h,))
    pts = [tuple(p) for p in g["pts"]]
    if g.get("closed") and len(pts) > 1:
        pts.append(pts[0])
    d = _mm(dist)
    none = (False, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    if d < 0:
        return none
    for a, b in zip(pts, pts[1:]):
        seg = _math.hypot(b[0] - a[0], b[1] - a[1])
        if seg == 0:
            continue
        if d <= seg:
            t = d / seg
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            return (True, (_un(p[0]), _un(p[1]), 0.0), ((b[0] - a[0]) / seg, (b[1] - a[1]) / seg, 0.0))
        d -= seg
    return none


def _resize(h, axis, value):
    # scales the object along one axis, keeping its lower or left edge where it is (Rodeo's reading:
    # the reference doesn't say which edge stays)
    o = _obj(h, "the object")
    b = _box(o)
    if not b:
        raise ValueError("%r has no size to set" % (h,))
    cur = (b[2] - b[0]) if axis == 0 else (b[3] - b[1])
    want = _mm(value)
    if not cur > 0:
        raise ValueError("%r has no size along that axis to scale" % (h,))
    if not want > 0:
        raise ValueError("the new size must be more than 0")
    f = want / cur
    if axis == 0:
        _xform([o["id"]], [f, 0, 0, 1, b[0] - f * b[0], 0])
    else:
        _xform([o["id"]], [1, 0, 0, f, 0, b[1] - f * b[1]])
    return None


def SetWidth(h, value):
    return _resize(h, 0, value)


def SetHeight(h, value):
    return _resize(h, 1, value)


def ResetBBox(h):
    # accepted: an object's box is worked out from its shape each time, so there is nothing to reset
    _obj(h, "the object")
    return None

# ---- menus, cursor and undo -----------------------------------------------------------------

_MENU_COMMANDS = {
    "group": Group,
    "ungroup": Ungroup,
    "select all": SelectAll,
    "deselect all": DSelectAll,
    "bring to front": MoveFront,
    "send to back": MoveBack,
    "send forward": Forward,
    "send backward": Backward,
    "flip horizontal": FlipHor,
    "flip vertical": FlipVer,
    "rotate left": lambda: Rotate(90),
    "rotate left 90": lambda: Rotate(90),
    "rotate right": lambda: Rotate(-90),
    "rotate right 90": lambda: Rotate(-90),
    "duplicate": lambda: Duplicate(0, 0),
    "clear": DeleteObjs,
}


def _menu_key(name):
    # case, spacing, a trailing ellipsis or "...", and the degree sign don't change which command it is
    k = " ".join(str(name).split()).lower().replace("\u00b0", "")
    for end in ("\u2026", "..."):
        if k.endswith(end):
            k = k[: -len(end)].rstrip()
    return " ".join(k.split())


def DoMenuTextByName(subMenu, index):
    fn = _MENU_COMMANDS.get(_menu_key(subMenu))
    if fn is None:
        raise NotImplementedError("vs.DoMenuTextByName: Rodeo has no menu command '%s' for scripts yet" % subMenu)
    fn()
    return None


def SetCursor(cursor):
    # accepted and ignored: the editor picks the cursor by its own rules (the arrow over controls, a hand over links)
    return None


def RedrawSelection():
    # accepted and ignored: the editor shows the selection after the run
    return None


def NameUndoEvent(eventName):
    # accepted and ignored: the whole run is already one undo step
    return None


def UndoOff():
    # accepted and ignored: the whole run is already one undo step
    return None


def Wait(seconds):
    import time
    time.sleep(max(0, int(seconds)))
    return None

# ---- utility --------------------------------------------------------------------------------

def ValidNumStr(s):
    try:
        v = float(str(s).strip())
    except ValueError:
        return (False, 0.0)
    if not _math.isfinite(v):
        return (False, 0.0)
    return (True, v)


def CreateUUID():
    import uuid
    return "{%s}" % str(uuid.uuid4()).upper()

# ---- dimensions -----------------------------------------------------------------------------
# The dimension is drawn with the drawing's own dimension style (its class and layer, as the
# editor's dimension tool draws one). The reference's dimType, arrow, textFlag and text offset are
# not read: Rodeo places the text by its own rules, and posAngle is not read either.

def LinearDim(*args):
    v = _nums(args, 9, "LinearDim")
    _S.ops.append(["lindim", _mm(v[0]), _mm(v[1]), _mm(v[2]), _mm(v[3]), _mm(v[4]), _S.active_layer, _S.active_class])
    return None


def AngularDim(*args):
    v = _nums(args, 10, "AngularDim")
    _S.ops.append(["angdim", _mm(v[0]), _mm(v[1]), _mm(v[2]), _mm(v[3]), _mm(v[4]), _mm(v[5]), _mm(v[6]), _S.active_class, _S.active_layer])
    return None


# ---- closed shapes: booleans and offsets ----------------------------------------------------
# Results are only made when the run ends, so a handle returned here is a stub the run can pass to
# later calls: its real id is filled in then (the same arrangement as the new objects of _add).

def _step_new(type_code):
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    s.objs[tmp] = {"id": tmp, "type": type_code, "layer": s.active_layer, "parent": None, "cls": s.active_class, "name": "", "sel": False, "attrs": None, "shape": {}, "records": {}, "sym": None, "bbox": None}
    s.kids.setdefault(s.active_layer, []).append(tmp)
    s.last_new = tmp
    return tmp


def _surf(op, s1, s2, returns):
    a = _obj(s1, "a surface")
    b = _obj(s2, "a surface")
    tmp = _step_new(5) if returns else None
    _S.ops.append(["surf", op, tmp, [a["id"], b["id"]]])
    return _h(tmp)


def AddSurface(s1, s2):
    # the reference: nil when the two surfaces don't overlap, and nothing is joined. Rodeo knows the boxes
    # of both, so surfaces whose boxes don't meet answer nil; surfaces whose boxes overlap but whose outlines
    # don't are still given a handle (the join step then leaves both as they are).
    a = _obj(s1, "a surface")
    b = _obj(s2, "a surface")
    ba, bb = _box(a), _box(b)
    if ba and bb and (ba[2] < bb[0] or bb[2] < ba[0] or ba[3] < bb[1] or bb[3] < ba[1]):
        return None
    return _surf("add", s1, s2, True)


def IntersectSurface(s1, s2):
    return _surf("isect", s1, s2, True)


def ClipSurface(s1, s2):
    _surf("clip", s1, s2, False)
    return None


def ClipSurfaceN(s1, s2):
    # the same clip; the new surface is the handle returned
    return _surf("clip", s1, s2, True)


def _offset(h, d, copies, smooth):
    o = _obj(h, "the object")
    tmp = _step_new(5)
    _S.ops.append(["offset", tmp, o["id"], _mm(d), int(copies), bool(smooth), False])
    return _h(tmp)


def OffsetPoly(h, offsetDistance, numberOfOffsets, consolidateVertices, sharpCorners, conversionRes, consolidationTolerance):
    # consolidation and the tolerance are not read: the offsets come out with their own vertices
    return _offset(h, offsetDistance, max(1, int(numberOfOffsets)), not sharpCorners)


def OffsetPolyN(h, offsetDistance, smoothCorners):
    return _offset(h, offsetDistance, 1, smoothCorners)


def OffsetPolyClosed(obj, offset, smoothCorners):
    return _offset(obj, offset, 1, smoothCorners)


def HUngroup(h):
    # takes apart a group on its layer, as Ungroup does for the selected group; a group inside
    # another group is refused (Rodeo's Ungroup only works on the top level)
    o = _obj(h, "the group")
    if o["type"] != 11:
        raise ValueError("HUngroup needs a group, not %r" % (h,))
    if o.get("parent"):
        raise NotImplementedError("vs.HUngroup on a group inside another group isn't supported yet")
    saved_layer = _S.active_layer
    saved_sel = dict((i, v["sel"]) for i, v in _S.objs.items())
    try:
        _S.active_layer = o["layer"]
        for v in _S.objs.values():
            v["sel"] = False
        o["sel"] = True
        Ungroup()
    finally:
        _S.active_layer = saved_layer
        for i, sel in saved_sel.items():
            if i in _S.objs:
                _S.objs[i]["sel"] = sel
    return None


def BeginGroupN(groupHandle):
    # a NIL handle starts a new group (as BeginGroup does); an existing group can't be reopened yet
    if groupHandle is not None:
        raise NotImplementedError("vs.BeginGroupN with an existing group isn't supported yet: pass nil for a new group")
    BeginGroup()
    return None


def IsObjectFromReferencedFile(h):
    # Rodeo doesn't load referenced files, so nothing it shows comes from one
    _obj(h, "the object")
    return False


# ---- the view, the screen and the origin ---------------------------------------------------

def _misc_init(state, snap):
    scr = snap.get("screen")
    state.screen = tuple(scr) if scr else None
    vc = snap.get("viewCenter")
    state.view_center = tuple(vc) if vc else None
    state.view_center_set = None


_INIT_HOOKS.append(_misc_init)


def _misc_result(state):
    # SetVCenter moves the editor's 2D view when the run ends
    vc = state.view_center_set
    return {"viewCenter": list(vc)} if vc else {}


_RESULT_HOOKS.append(_misc_result)


def GetScreen():
    x1, y1, x2, y2 = _S.screen or (0, 0, 1280, 800)
    return (int(x1), int(y1), int(x2), int(y2))


def GetVCenter():
    c = _S.view_center_set or _S.view_center or (0.0, 0.0)
    return (_un(c[0]), _un(c[1]))


def SetVCenter(x, y):
    _S.view_center_set = (_mm(x), _mm(y))
    return None


def GetOrigin():
    # the drawing's origin is always 0, 0 in Rodeo (it can't be moved)
    return (0.0, 0.0)


def GetOriginInDocUnits():
    return (0.0, 0.0)


def SetOrigin(x, y):
    if float(x) != 0 or float(y) != 0:
        raise NotImplementedError("vs.SetOrigin: Rodeo's drawing origin can't be moved; only 0, 0 is accepted")
    return None


def SetOriginAbsolute(x, y):
    if float(x) != 0 or float(y) != 0:
        raise NotImplementedError("vs.SetOriginAbsolute: Rodeo's drawing origin can't be moved; only 0, 0 is accepted")
    return None


def GetSheetLayerUserOrigin(layer):
    _layer(layer)
    return (True, 0.0, 0.0)


def GetKeyDown():
    # no key is held in a script's view of Rodeo (the reference's wait for a key is not supported)
    return 0


def KeyDown():
    return (False, 0)


# ---- dialogs ---------------------------------------------------------------------------------

def AngDialog(request, default="0"):
    return RealDialog(request, default)


def DistDialog(request, default="0"):
    return RealDialog(request, default)


def PtDialog(request, dx="0", dy="0"):
    # two prompts, x then y, each with the request's name for the axis
    x = RealDialog("%s: x" % request, dx)
    y = RealDialog("%s: y" % request, dy)
    return (x, y)


def AlertInformDontShowAgain(text, advice, minorAlert, arrOptions=None):
    return AlertInform(text, advice, minorAlert)


def AlertQuestionDontShowAgain(question, advice, defaultButton, OKOverrideText, CancelOverrideText, customButtonAText, customButtonBText, arrOptions=None):
    return AlertQuestion(question, advice, defaultButton, OKOverrideText, CancelOverrideText, customButtonAText, customButtonBText)


# ---- date ------------------------------------------------------------------------------------

def Date(dateFormat, infoFormat):
    # the reference's table: 0 full, 1 abbreviated, 2 short; the info 0 date, 1 date and time, 2 time
    import time
    shapes = {0: "%A, %B %d, %Y", 1: "%b %d, %Y", 2: "%m/%d/%y"}
    f = shapes.get(int(dateFormat), shapes[0])
    info = int(infoFormat)
    if info == 2:
        return time.strftime("%H:%M")
    if info == 1:
        return time.strftime(f + " %H:%M")
    return time.strftime(f)


# ---- 2D components and object lists ---------------------------------------------------------------

def Set2DComponentGroup(objectHandle, groupHandle, component):
    # Rodeo has no 2D components: the group drawn in this run stays part of the object's drawing (where
    # the component would have it shown), and the component number is only checked. A nil group deletes
    # the component's group in Vectorworks; here there is none to delete, so that is accepted too.
    if not 0 <= int(component) <= 10:
        raise ValueError("vs.Set2DComponentGroup: the 2D component must be 0 to 10, not %r" % (component,))
    if groupHandle is None:
        return True
    g = _obj(groupHandle, "a group")
    if not str(g["id"]).startswith("new:"):
        raise NotImplementedError("vs.Set2DComponentGroup of a group in the drawing isn't available in Rodeo yet")
    return True


def ForEachObjectInList(actionFunc, objOptions, travOptions, firstObj):
    # the list is the object given and the objects after it in its container (the stacking order, as
    # NextObj walks it); a nil list is every object of the active layer. Deep traversal goes into the
    # containers (walls, extrudes, sweeps). Rodeo's reading: a callback that returns True stops the walk,
    # as ForEachObjectInLayer's does.
    oo = int(objOptions)
    deep = int(travOptions) in (1, 2)
    if firstObj is None:
        found = list(_walk(_S.active_layer, deep))
    else:
        o = _obj(firstObj)
        sibs = _siblings(o)
        found = []
        for i in sibs[sibs.index(o["id"]):]:
            top = _S.objs.get(i)
            if top is None:
                continue
            found.append(top)
            if deep and top["type"] == 11:
                found.extend(_walk(i, True))
    for o in found:
        if oo & 2 and not o["sel"]:
            continue
        if oo & 1 and not _visible(o):
            continue
        # the unlocked option (4) keeps every object: the script's copy holds no locks (Rodeo's reading)
        if o["id"] in _S.objs and actionFunc(Handle(o["id"])):
            break

`;
