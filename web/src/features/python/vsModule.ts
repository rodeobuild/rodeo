// The `vs` module a Python script imports, as Vectorworks gives it, over a copy of the open drawing
// that runner.ts takes when the script starts (lengths in millimetres there, in the drawing's units
// here). Each call reads or changes that copy at once, so the script sees its own changes, and
// records what it changed; runner.ts applies the record to the drawing when the script ends, as one
// undo step. Calls Rodeo doesn't have raise NotImplementedError naming them.

import { VS_PARTS } from "./vs/index.ts";

const VS_CORE = String.raw`
import json as _json
import math as _math
import unicodedata as _unicodedata

_S = None
# what the module's later parts add: each _INIT_HOOKS entry is called with (state, snapshot) as a run
# starts, each _RESULT_HOOKS entry with (state) as it ends, giving a dict merged into the result
_INIT_HOOKS = []
_RESULT_HOOKS = []


class Handle(object):
    """An object or layer of the drawing, as the script holds it."""

    __slots__ = ("_id",)

    def __init__(self, id=None):
        self._id = id

    def __eq__(self, other):
        if other is None:
            return self._id is None
        return isinstance(other, Handle) and other._id == self._id

    def __bool__(self):
        return self._id is not None

    __nonzero__ = __bool__

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash(self._id)

    def __repr__(self):
        return "<vs.Handle %s>" % self._id

    @property
    def type(self):
        return GetTypeN(self)

    @property
    def name(self):
        return GetLName(self) if _is_layer(self) else GetName(self)

    @name.setter
    def name(self, value):
        SetName(self, value)

    @property
    def next(self):
        return NextLayer(self) if _is_layer(self) else NextObj(self)

    @property
    def prev(self):
        return PrevLayer(self) if _is_layer(self) else PrevObj(self)

    @property
    def parent(self):
        return GetParent(self)

    @property
    def selected(self):
        return Selected(self)

    @selected.setter
    def selected(self, value):
        if value:
            SetSelect(self)
        else:
            SetDSelect(self)


class _State(object):
    def __init__(self, snap):
        u = snap["units"]
        self.U = float(u["mm"])
        self.unit_mark = u["mark"]
        self.area_mark = u["area"]
        self.format = u["format"]
        self.display = u["display"]
        self.layers = snap["layers"]
        self.layer_by_id = dict((l["id"], l) for l in self.layers)
        self.classes = dict((c["name"], c) for c in snap["classes"])
        self.class_names = [c["name"] for c in snap["classes"]]
        self.objs = {}
        self.kids = dict((l["id"], []) for l in self.layers)
        for o in snap["objects"]:
            o["sel"] = False
            self.objs[o["id"]] = o
            self.kids.setdefault(o["parent"] or o["layer"], []).append(o["id"])
        for i in snap["selection"]:
            if i in self.objs:
                self.objs[i]["sel"] = True
        self.active_layer = snap["activeLayer"]
        self.active_class = snap["activeClass"]
        self.palette = snap["palette"]
        self.symbols = dict((s["index"], s["name"]) for s in snap["symbols"])
        self.symbol_boxes = dict((s["index"], s.get("bbox")) for s in snap["symbols"])
        # the Symbol tool's symbol as the script leaves it (SetActSymbol, Symbol), by name index
        self.active_symbol = snap.get("activeSymbol")
        self.symbol_changed = False
        self.formats = dict((f["name"], f["format"]) for f in snap["formats"])
        self.new_attrs = dict(snap["newAttrs"])
        # what a new object takes from the drawing where the Attributes palette sets nothing
        self.template_attrs = snap.get("templateAttrs") or {}
        self.class_mode = snap.get("classMode")
        self.layer_mode = snap.get("layerMode")
        self.text_paper_mm = float(snap["textPaperMm"])
        self.jspi = bool(snap["jspi"])
        self.ops = []
        self.seq = 0
        self.last_new = None
        self.pen = (0.0, 0.0)
        self.relative = False
        self.closed = True
        self.poly = None
        self.poly3d = None
        self.groups = []
        self.attrs = {}
        self.attr_stack = []
        self.text_pts = None
        self.text_h = 1
        self.text_v = 1
        # the font (a name), face (Bold 1, Italic 2, Underline 4) and angle CreateText gives new texts
        self.text_font = None
        self.text_face = None
        self.text_angle = None
        self.fonts = list(snap.get("fonts") or [])
        # the document's attributes, text settings and tool as the script leaves them, for after the run:
        # whether FillPat and the rest were called, the text settings set (pts, h, v), the SetTool tool
        self.attrs_set = False
        self.text_set = {}
        self.tool = None
        self.sel_changed = False
        self.layer_changed = False
        self.class_changed = False
        self.messages = []
        self.alerts = []
        self.cancelled = False
        # the plug-in running, if any: its parameters by key, and the object it draws (whose
        # drawing Vectorworks clears before the script runs; runner.ts leaves it out)
        p = snap.get("plugin")
        self.plugin = p
        self.params = dict((_pkey(name), _typed(t, v)) for name, t, v in p["params"]) if p else {}
        self.pio = p.get("object") if p else None
        if self.pio:
            self.kids[self.pio] = []
        # what the script sets up for the Object Info palette, and whether it asked to be run again
        self.ui = {"props": {}, "widgets": [], "states": {}}
        self.reset = False
        # layout dialogs the script has made (CreateLayout...), by id
        self.dialogs = {}


def _init(snapshot_json):
    global _S
    snap = _json.loads(snapshot_json)
    _S = _State(snap)
    for hook in _INIT_HOOKS:
        hook(_S, snap)


def _result():
    s = _S
    sel = [i for i, o in s.objs.items() if o["sel"]] if s.sel_changed else None
    out = {
        "ops": s.ops,
        "selection": sel,
        "activeLayer": s.active_layer if s.layer_changed else None,
        "activeClass": s.active_class if s.class_changed else None,
        "messages": s.messages,
        "alerts": s.alerts,
        "drawing": s.kids.get(s.pio, []) if s.pio else None,
        "ui": s.ui if s.plugin else None,
        "reset": s.reset,
        "attrs": s.attrs if s.attrs_set and not s.plugin else None,
        "text": s.text_set if s.text_set and not s.plugin else None,
        "tool": s.tool,
        "classMode": s.class_mode,
        "layerMode": s.layer_mode,
        "activeSymbol": s.active_symbol if s.symbol_changed else None,
    }
    for hook in _RESULT_HOOKS:
        out.update(hook(s) or {})
    return _json.dumps(out)


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    if name[:1] in "Pp" and _S is not None and _pkey(name[1:]) in _S.params:
        return _S.params[_pkey(name[1:])]
    raise NotImplementedError("vs.%s isn't available in Rodeo yet" % name)


# ---- arguments and units ---------------------------------------------------------------------

def _flat(args):
    out = []
    for a in args:
        if isinstance(a, (tuple, list)):
            out.extend(_flat(a))
        else:
            out.append(a)
    return out


def _nums(args, n, what):
    v = _flat(args)
    if len(v) < n:
        raise TypeError("vs.%s takes %d numbers here, got %d" % (what, n, len(v)))
    return [float(x) for x in v[:n]]


def _mm(v):
    return float(v) * _S.U


def _un(v):
    return v / _S.U


def _pt_out(p):
    return (_un(p[0]), _un(p[1]))


def _pen_point(x, y):
    """A point from the script in millimetres: an offset from the pen while Relative is on."""
    if _S.relative:
        return (_S.pen[0] + _mm(x), _S.pen[1] + _mm(y))
    return (_mm(x), _mm(y))


# ---- handles ---------------------------------------------------------------------------------

def _is_layer(h):
    return isinstance(h, Handle) and h._id in _S.layer_by_id


def _obj(h, what="the object"):
    if not isinstance(h, Handle):
        raise TypeError("expected a handle to %s, got %r" % (what, h))
    o = _S.objs.get(h._id)
    if o is None:
        raise ValueError("%r is not an object of the drawing (deleted, or a layer)" % h)
    return o


def _layer(h):
    if not _is_layer(h):
        raise TypeError("expected a handle to a layer, got %r" % (h,))
    return _S.layer_by_id[h._id]


def _h(id):
    return Handle(id) if id is not None else None


def _container(o):
    return o["parent"] or o["layer"]


def _siblings(o):
    return _S.kids.get(_container(o), [])


def _walk(container, deep):
    for i in list(_S.kids.get(container, [])):
        o = _S.objs.get(i)
        if o is None:
            continue
        yield o
        if deep and o["type"] == 11:
            for c in _walk(i, True):
                yield c


def _visible(o):
    l = _S.layer_by_id.get(o["layer"])
    if l is None or l["vis"] == "hidden":
        return False
    c = _S.classes.get(o["cls"])
    return c is None or c["vis"] != "hidden"


# ---- geometry (millimetres) ------------------------------------------------------------------

def _bounds(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def _shape_box(g):
    k = g.get("kind")
    if k == "arc":
        c = g["center"]
        return [c[0] - g["rx"], c[1] - g["ry"], c[0] + g["rx"], c[1] + g["ry"]]
    if g.get("pts"):
        return _bounds(g["pts"])
    if g.get("at"):
        a = g["at"]
        return [a[0], a[1], a[0], a[1]]
    return None


def _box(o):
    if o["type"] == 11:
        boxes = [_box(c) for c in _walk(o["id"], False)]
        boxes = [b for b in boxes if b]
        if boxes:
            return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return o.get("bbox")


def _apply(m, p):
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]


def _transform_copy(o, m):
    """The copy's geometry moved by the affine m (a, b, c, d, e, f), children too."""
    g = o.get("shape")
    if g:
        if g.get("pts"):
            g["pts"] = [_apply(m, p) for p in g["pts"]]
        if g.get("verts"):
            g["verts"] = [_apply(m, v[:2]) + v[2:] for v in g["verts"]]
        if g.get("center"):
            g["center"] = _apply(m, g["center"])
            sx = _math.hypot(m[0], m[1])
            sy = _math.hypot(m[2], m[3])
            g["rx"] *= sx
            g["ry"] *= sy
        if g.get("at"):
            g["at"] = _apply(m, g["at"])
    if o.get("ins") is not None:
        o["ins"] = _apply(m, o["ins"])
        o["turned"] = (float(o.get("turned") or 0) + _math.degrees(_math.atan2(m[1], m[0]))) % 360
    b = o.get("bbox")
    if b:
        corners = [_apply(m, p) for p in ([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]])]
        o["bbox"] = _bounds(corners)
    if g:
        nb = _shape_box(g)
        if nb:
            o["bbox"] = nb
    for c in _walk(o["id"], False):
        _transform_copy(c, m)


def _xform(ids, m):
    ids = [i for i in ids if i in _S.objs]
    if not ids:
        return
    for i in ids:
        _transform_copy(_S.objs[i], m)
    _S.ops.append(["xform", ids, {"a": m[0], "b": m[1], "c": m[2], "d": m[3], "e": m[4], "f": m[5]}])


def _rotation(cx, cy, deg):
    t = _math.radians(deg)
    c = _math.cos(t)
    s = _math.sin(t)
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]


def _path_length(pts, closed):
    n = len(pts)
    total = 0.0
    for i in range(n - 1 if not closed else n):
        a = pts[i]
        b = pts[(i + 1) % n]
        total += _math.hypot(b[0] - a[0], b[1] - a[1])
    return total


def _arc_length(g):
    rx, ry = g["rx"], g["ry"]
    sweep = abs(g["sweep"])
    if abs(rx - ry) < 1e-9:
        return rx * _math.radians(sweep)
    h = ((rx - ry) / (rx + ry)) ** 2
    full = _math.pi * (rx + ry) * (1 + 3 * h / (10 + _math.sqrt(4 - 3 * h)))
    return full * sweep / 360.0


# ---- adding objects --------------------------------------------------------------------------

_TYPE_OF_KIND = {"line": 2, "rect": 3, "polygon": 5, "arc": 6, "text": 10, "roundrect": 13, "locus": 17, "polyline": 21, "poly3d": 25}


def _add(shape, copy, extra=None):
    """Adds a new object on the active layer (in the group being built), with the class and attributes for new objects."""
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    attrs = dict(s.attrs)
    full = dict(s.new_attrs)
    full.update(attrs)
    op = ["add", tmp, s.active_layer, shape, s.active_class, (attrs if s.plugin else full) or None]
    if extra:
        op.append(extra)
    s.ops.append(op)
    o = {
        "id": tmp, "type": _TYPE_OF_KIND[shape["kind"]], "layer": s.active_layer, "parent": s.pio,
        "cls": s.active_class, "name": "", "sel": False, "attrs": full, "shape": copy, "records": {}, "sym": None,
    }
    o["bbox"] = _shape_box(copy)
    s.objs[tmp] = o
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    return tmp


def _pt(p):
    return {"x": p[0], "y": p[1]}


def _add_rect(x0, y0, x1, y1):
    pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return _add({"kind": "rect", "x0": x0, "y0": y0, "x1": x1, "y1": y1}, {"kind": "rect", "pts": pts, "closed": True})


def _add_arc(cx, cy, rx, ry, start, sweep):
    shape = {"kind": "arc", "center": _pt((cx, cy)), "radius": rx, "startAngle": start, "sweepAngle": sweep}
    if abs(rx - ry) > 1e-9:
        shape["radiusY"] = ry
    return _add(shape, {"kind": "arc", "center": [cx, cy], "rx": rx, "ry": ry, "start": start, "sweep": sweep})


def _add_line(a, b):
    return _add({"kind": "line", "a": _pt(a), "b": _pt(b)}, {"kind": "line", "pts": [list(a), list(b)]})


def _add_poly(pts, closed):
    pts = [list(p) for p in pts]
    if len(pts) < 2:
        raise ValueError("a polygon needs at least two vertices")
    return _add({"kind": "polygon", "points": [_pt(p) for p in pts], "closed": closed}, {"kind": "polygon", "pts": pts, "closed": closed})


def _add_poly3d(pts):
    """A 3D polygon through pts (x, y, z in millimetres), open or closed as the next polygon is."""
    if len(pts) < 2:
        raise ValueError("a 3D polygon needs at least two vertices")
    closed = _S.closed
    flat = [c for p in pts for c in p]
    # the copy keeps the heights too (pts3), for the 3D calls that read the object's drawn points
    return _add({"kind": "poly3d", "points": flat, "closed": closed}, {"kind": "polygon", "pts": [[p[0], p[1]] for p in pts], "pts3": [list(p) for p in pts], "closed": closed})


_VERTEX_KIND = {0: "corner", 1: "bezier", 2: "cubic", 3: "arc", 4: "through"}
_VERTEX_CODE = dict((v, k) for k, v in _VERTEX_KIND.items())


def Rect(*args):
    x0, y0, x1, y1 = _nums(args, 4, "Rect")
    _add_rect(min(_mm(x0), _mm(x1)), min(_mm(y0), _mm(y1)), max(_mm(x0), _mm(x1)), max(_mm(y0), _mm(y1)))


def RRect(*args):
    x0, y0, x1, y1, dx, dy = _nums(args, 6, "RRect")
    a, b = min(_mm(x0), _mm(x1)), min(_mm(y0), _mm(y1))
    c, d = max(_mm(x0), _mm(x1)), max(_mm(y0), _mm(y1))
    rx, ry = abs(_mm(dx)) / 2, abs(_mm(dy)) / 2
    pts = [[a, b], [c, b], [c, d], [a, d]]
    _add({"kind": "roundrect", "x0": a, "y0": b, "x1": c, "y1": d, "rx": rx, "ry": ry}, {"kind": "roundrect", "pts": pts, "closed": True})


def Oval(*args):
    x0, y0, x1, y1 = [_mm(v) for v in _nums(args, 4, "Oval")]
    _add_arc((x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2, 0.0, 360.0)


def Arc(*args):
    x0, y0, x1, y1, start, sweep = _nums(args, 6, "Arc")
    x0, y0, x1, y1 = _mm(x0), _mm(y0), _mm(x1), _mm(y1)
    _add_arc((x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2, start, sweep)


def ArcByCenter(*args):
    x, y, r, start, sweep = _nums(args, 5, "ArcByCenter")
    _add_arc(_mm(x), _mm(y), abs(_mm(r)), abs(_mm(r)), start, sweep)


def Locus(*args):
    x, y = _nums(args, 2, "Locus")
    p = _pen_point(x, y)
    _add({"kind": "locus", "at": _pt(p)}, {"kind": "locus", "pts": [list(p)]})


def MoveTo(*args):
    x, y = _nums(args, 2, "MoveTo")
    p = _pen_point(x, y)
    if _S.poly is not None:
        _S.poly.append([p[0], p[1], "corner", 0.0])
    _S.pen = p


def Move(*args):
    dx, dy = _nums(args, 2, "Move")
    _S.pen = (_S.pen[0] + _mm(dx), _S.pen[1] + _mm(dy))
    if _S.poly is not None:
        _S.poly.append([_S.pen[0], _S.pen[1], "corner", 0.0])


def LineTo(*args):
    x, y = _nums(args, 2, "LineTo")
    p = _pen_point(x, y)
    if _S.poly is not None:
        _S.poly.append([p[0], p[1], "corner", 0.0])
    else:
        _add_line(_S.pen, p)
    _S.pen = p


def Line(*args):
    dx, dy = _nums(args, 2, "Line")
    p = (_S.pen[0] + _mm(dx), _S.pen[1] + _mm(dy))
    _add_line(_S.pen, p)
    _S.pen = p


def Relative():
    _S.relative = True


def Absolute():
    _S.relative = False


def ClosePoly():
    _S.closed = True


def OpenPoly():
    _S.closed = False


def Poly(*args):
    v = [float(x) for x in _flat(args)]
    if len(v) % 2 or len(v) < 4:
        raise TypeError("vs.Poly takes pairs of numbers, at least two points")
    pts = []
    for i in range(0, len(v), 2):
        p = _pen_point(v[i], v[i + 1])
        pts.append(p)
        if _S.relative:
            _S.pen = p
    _add_poly(pts, _S.closed)


def BeginPoly():
    _S.poly = []


def Poly3D(*args):
    v = [_mm(x) for x in _flat(args)]
    if len(v) % 3 or len(v) < 6:
        raise TypeError("vs.Poly3D takes x, y, z triples, at least two points")
    _add_poly3d([v[i:i + 3] for i in range(0, len(v), 3)])


def BeginPoly3D():
    _S.poly3d = []


def Add3DPt(*args):
    if _S.poly3d is None:
        raise RuntimeError("vs.Add3DPt adds a vertex between vs.BeginPoly3D() and vs.EndPoly3D()")
    v = _flat(args)
    if len(v) < 3:
        raise TypeError("vs.Add3DPt takes x, y and z")
    _S.poly3d.append([_mm(v[0]), _mm(v[1]), _mm(v[2])])


def EndPoly3D():
    pts = _S.poly3d or []
    _S.poly3d = None
    if len(pts) < 2:
        raise ValueError("vs.EndPoly3D needs at least two vertices since vs.BeginPoly3D()")
    _add_poly3d(pts)


def _vertex(args, kind, what):
    if _S.poly is None:
        raise RuntimeError("vs.%s adds a vertex between vs.BeginPoly() and vs.EndPoly()" % what)
    v = _flat(args)
    x, y = float(v[0]), float(v[1])
    r = _mm(v[2]) if len(v) > 2 else 0.0
    p = _pen_point(x, y)
    _S.poly.append([p[0], p[1], kind, abs(r)])
    _S.pen = p


def AddPoint(*args):
    _vertex(args, "corner", "AddPoint")


def ArcTo(*args):
    _vertex(args, "arc", "ArcTo")


def CurveTo(*args):
    _vertex(args, "bezier", "CurveTo")


def CurveThrough(*args):
    _vertex(args, "cubic", "CurveThrough")


def EndPoly():
    verts = _S.poly or []
    _S.poly = None
    if len(verts) < 2:
        raise ValueError("vs.EndPoly needs at least two vertices since vs.BeginPoly()")
    closed = _S.closed
    if all(v[2] == "corner" for v in verts):
        _add_poly([v[:2] for v in verts], closed)
        return
    shape = {
        "kind": "polyline", "points": [_pt(v) for v in verts], "closed": closed,
        "vertices": [v[2] for v in verts], "radii": [v[3] for v in verts],
    }
    _add(shape, {"kind": "polyline", "pts": [v[:2] for v in verts], "verts": [list(v) for v in verts], "closed": closed})


def TextOrigin(*args):
    x, y = _nums(args, 2, "TextOrigin")
    _S.pen = _pen_point(x, y)


def TextSize(size):
    _S.text_pts = float(size) if float(size) > 0 else 12.0
    _S.text_set["pts"] = _S.text_pts


def TextJust(justify):
    j = int(justify)
    _S.text_h = j if j in (1, 2, 3) else 1
    _S.text_set["h"] = _S.text_h


def TextVerticalAlign(align):
    a = int(align)
    _S.text_v = a if 1 <= a <= 5 else 1
    _S.text_set["v"] = _S.text_v


def CreateText(text):
    scale = _S.layer_by_id[_S.active_layer]["scale"] or 1
    paper = _S.text_pts * 25.4 / 72 if _S.text_pts is not None else _S.text_paper_mm
    at = _S.pen
    copy = {"kind": "text", "at": list(at), "text": str(text), "size": paper * scale, "h": _S.text_h, "v": _S.text_v}
    tmp = _add(
        {"kind": "text", "at": _pt(at), "text": str(text), "height": paper * scale, "hAlign": _S.text_h, "vAlign": _S.text_v},
        copy,
    )
    style = {}
    if _S.text_font is not None:
        style["font"] = copy["font"] = _S.text_font
    if _S.text_face is not None:
        style.update(_face(_S.text_face))
        copy.update(_face(_S.text_face))
    if _S.text_angle:
        style["angle"] = copy["angle"] = _S.text_angle
    if style:
        _S.ops.append(["textstyle", [tmp], style, "origin"])


def BeginGroup():
    _S.groups.append([])


def EndGroup():
    if not _S.groups:
        raise RuntimeError("vs.EndGroup without vs.BeginGroup")
    members = _S.groups.pop()
    if not members:
        return
    _group(members)


def _group(members):
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    first = s.objs[members[0]]
    layer = first["layer"]
    g = {"id": tmp, "type": 11, "layer": layer, "parent": first["parent"], "cls": s.active_class, "name": "", "sel": False,
         "attrs": None, "shape": None, "records": {}, "sym": None, "bbox": None}
    container = first["parent"] or layer
    sibs = s.kids.setdefault(container, [])
    at = max(sibs.index(m) for m in members if m in sibs) if any(m in sibs for m in members) else len(sibs)
    for m in members:
        o = s.objs[m]
        old = s.kids.get(_container(o), [])
        if m in old:
            old.remove(m)
        o["parent"] = tmp
    at = min(at, len(sibs))
    sibs.insert(at, tmp)
    s.kids[tmp] = list(members)
    s.objs[tmp] = g
    g["bbox"] = _box(g)
    s.ops.append(["group", tmp, list(members)])
    if s.groups:
        s.groups[-1] = [i for i in s.groups[-1] if i not in members] + [tmp]
    s.last_new = tmp
    return tmp


# ---- walking the drawing ---------------------------------------------------------------------

def LNewObj():
    return _h(_S.last_new)


def ActLayer():
    return Handle(_S.active_layer)


def FLayer():
    return _h(_S.layers[0]["id"] if _S.layers else None)


def LLayer():
    return _h(_S.layers[-1]["id"] if _S.layers else None)


def _layer_step(h, d):
    ids = [l["id"] for l in _S.layers]
    i = ids.index(_layer(h)["id"]) + d
    return _h(ids[i]) if 0 <= i < len(ids) else None


def NextLayer(h):
    return _layer_step(h, 1)


def PrevLayer(h):
    return _layer_step(h, -1)


def GetLayerByName(name):
    for l in _S.layers:
        if l["name"] == name:
            return Handle(l["id"])
    return None


def _first(container, selected=False, last=False):
    ids = _S.kids.get(container, [])
    seq = reversed(ids) if last else ids
    for i in seq:
        if not selected or _S.objs[i]["sel"]:
            return Handle(i)
    return None


def FActLayer():
    return _first(_S.active_layer)


def LActLayer():
    return _first(_S.active_layer, last=True)


def FSActLayer():
    return _first(_S.active_layer, selected=True)


def LSActLayer():
    return _first(_S.active_layer, selected=True, last=True)


def FObject():
    return _first(_S.layers[0]["id"]) if _S.layers else None


def LObject():
    return _first(_S.layers[0]["id"], last=True) if _S.layers else None


def FInLayer(h):
    return _first(_layer(h)["id"])


def FSObject(h):
    return _first(_layer(h)["id"], selected=True)


def FInGroup(h):
    return _first(_obj(h, "a group")["id"])


def _step(h, d, selected=False):
    if _is_layer(h):
        return _layer_step(h, d)
    o = _obj(h)
    sibs = _siblings(o)
    i = sibs.index(o["id"]) + d
    while 0 <= i < len(sibs):
        if not selected or _S.objs[sibs[i]]["sel"]:
            return Handle(sibs[i])
        i += d
    return None


def NextObj(h):
    # Vectorworks answers None for a nil handle: scripts loop with "while h != None"
    if h is None:
        return None
    return _step(h, 1)


def PrevObj(h):
    if h is None:
        return None
    return _step(h, -1)


def NextSObj(h):
    return _step(h, 1, selected=True)


def PrevSObj(h):
    return _step(h, -1, selected=True)


def GetParent(h):
    if h is None:
        return None
    o = _obj(h)
    return Handle(o["parent"] or o["layer"])


def GetLayer(h):
    if h is None:
        return None
    return Handle(_obj(h)["layer"])


def GetObject(name):
    if not name:
        return None
    for o in _S.objs.values():
        if o.get("name") == name:
            return Handle(o["id"])
    return GetLayerByName(name)


def NumObj(h):
    return len(_S.kids.get(_layer(h)["id"], []))


def NumSObj(h):
    return sum(1 for i in _S.kids.get(_layer(h)["id"], []) if _S.objs[i]["sel"])


# ---- reading objects -------------------------------------------------------------------------

def GetTypeN(h):
    if _is_layer(h):
        return 31
    if _is_record(h):
        return 47
    return _obj(h)["type"]


GetType = GetTypeN


def GetName(h):
    if h is None:
        return ""
    if _is_record(h):
        return _S.plugin["name"]
    if _is_layer(h):
        return _layer(h)["name"]
    return _obj(h).get("name") or ""


def GetLName(h):
    return _layer(h)["name"]


def GetClass(h):
    if h is None:
        return ""
    return _obj(h)["cls"]


def GetBBox(h):
    b = _box(_obj(h))
    if not b:
        return ((0.0, 0.0), (0.0, 0.0))
    return ((_un(b[0]), _un(b[3])), (_un(b[2]), _un(b[1])))


def HCenter(h):
    o = _obj(h)
    g = o.get("shape") or {}
    if g.get("kind") == "arc":
        return _pt_out(g["center"])
    b = _box(o)
    if not b:
        return (0.0, 0.0)
    return (_un((b[0] + b[2]) / 2), _un((b[1] + b[3]) / 2))


def HWidth(h):
    b = _box(_obj(h))
    return _un(b[2] - b[0]) if b else 0.0


def HHeight(h):
    b = _box(_obj(h))
    return _un(b[3] - b[1]) if b else 0.0


def _area_mm(o):
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        sweep = min(abs(g["sweep"]), 360.0)
        return _math.pi * g["rx"] * g["ry"] * sweep / 360.0
    if k in ("rect", "roundrect", "polygon", "polyline") and (g.get("closed") or k in ("rect", "roundrect")):
        pts = g["pts"]
        a = 0.0
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            a += p[0] * q[1] - q[0] * p[1]
        return abs(a) / 2
    if o["type"] == 11:
        return sum(_area_mm(c) for c in _walk(o["id"], False))
    return 0.0


def HArea(h):
    return _area_mm(_obj(h)) / (_S.U * _S.U)


def HPerim(h):
    o = _obj(h)
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        return _un(_arc_length(g))
    if g.get("pts"):
        return _un(_path_length(g["pts"], g.get("closed") or k in ("rect", "roundrect")))
    return 0.0


def HLength(h):
    o = _obj(h)
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        return _un(_arc_length(g))
    if g.get("pts") and k in ("line", "polygon", "polyline"):
        return _un(_path_length(g["pts"], bool(g.get("closed"))))
    return 0.0


def _seg(h, i):
    g = _obj(h, "a line").get("shape") or {}
    if g.get("kind") != "line":
        raise TypeError("vs.GetSegPt%d takes a line" % (i + 1))
    return _pt_out(g["pts"][i])


def GetSegPt1(h):
    return _seg(h, 0)


def GetSegPt2(h):
    return _seg(h, 1)


def _verts(h):
    g = _obj(h, "a polygon or polyline").get("shape") or {}
    if g.get("verts"):
        return g["verts"]
    if g.get("kind") in ("polygon", "rect"):
        return [p + ["corner", 0.0] for p in g["pts"]]
    raise TypeError("expected a polygon or polyline")


def GetVertNum(h):
    return len(_verts(h))


def GetPolyPt(h, index):
    v = _verts(h)[int(index) - 1]
    return _pt_out(v)


def GetPolylineVertex(h, index):
    v = _verts(h)[int(index) - 1]
    return (_pt_out(v), _VERTEX_CODE.get(v[2], 0), _un(v[3]))


def GetText(h):
    g = _obj(h, "a text object").get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("vs.GetText takes a text object")
    return g.get("text", "")


def GetTextLength(h):
    return len(GetText(h))


def GetLocPt(h):
    g = _obj(h, "a locus").get("shape") or {}
    if g.get("kind") != "locus":
        raise TypeError("vs.GetLocPt takes a locus")
    return _pt_out(g["pts"][0])


def GetSymName(h):
    o = _obj(h, "a symbol")
    return _S.symbols.get(o.get("sym"), "")


def GetRField(h, record, field):
    o = _obj(h)
    v = (o.get("records") or {}).get(record, {}).get(field)
    return "" if v is None else str(v)


def Selected(h):
    return bool(_obj(h)["sel"])


# ---- attributes ------------------------------------------------------------------------------

def _rgb16(index):
    for p in _S.palette:
        if p[0] == index:
            return (p[1] * 257, p[2] * 257, p[3] * 257)
    return (0, 0, 0)


def _index_of(args):
    v = _flat(args)
    if len(v) == 1:
        return int(v[0])
    if len(v) != 3:
        raise TypeError("a colour is (red, green, blue), each 0 to 65535, or a colour index")
    r, g, b = [float(x) / 257.0 for x in v]
    best, dist = 0, None
    for p in _S.palette:
        d = (p[1] - r) ** 2 + (p[2] - g) ** 2 + (p[3] - b) ** 2
        if dist is None or d < dist:
            best, dist = p[0], d
    return best


def RGBToColorIndex(*args):
    return _index_of(args)


def ColorIndexToRGB(index):
    return _rgb16(int(index))


def _default(key, v):
    _S.attrs[key] = v
    _S.attrs_set = True


def FillPat(n):
    _default("fillPattern", int(n))


def PenPat(n):
    _default("lineStyle", int(n))


def PenSize(mils):
    _default("lineWeight", int(mils))


def FillFore(*args):
    _default("fillFore", _index_of(args))


def FillBack(*args):
    _default("fillBack", _index_of(args))


def PenFore(*args):
    _default("penFore", _index_of(args))


def PenBack(*args):
    _default("penBack", _index_of(args))


def SetDefaultOpacityN(fillOpacity, penOpacity):
    _default("fillOpacity", max(0, min(100, int(fillOpacity))))
    _default("penOpacity", max(0, min(100, int(penOpacity))))


def SetDefaultOpacity(opacity):
    SetDefaultOpacityN(opacity, opacity)


def Opacity(opacity):
    SetDefaultOpacityN(opacity, opacity)


def SetTool(theTool):
    _S.tool = int(theTool)


def PushAttrs():
    _S.attr_stack.append((dict(_S.attrs), _S.text_pts, _S.text_h, _S.text_v, dict(_S.text_set)))


def PopAttrs():
    if _S.attr_stack:
        _S.attrs, _S.text_pts, _S.text_h, _S.text_v, _S.text_set = _S.attr_stack.pop()


def _set_attrs(h, attrs):
    o = _obj(h)
    if o.get("attrs") is None:
        raise TypeError("%r has no attributes of its own" % h)
    o["attrs"].update(attrs)
    _S.ops.append(["attrs", [o["id"]], attrs])


def SetFPat(h, n):
    _set_attrs(h, {"fillPattern": int(n)})


def SetLW(h, mils):
    _set_attrs(h, {"lineWeight": int(mils)})


def SetFillFore(h, *color):
    _set_attrs(h, {"fillFore": _index_of(color)})


def SetFillBack(h, *color):
    _set_attrs(h, {"fillBack": _index_of(color)})


def SetPenFore(h, *color):
    _set_attrs(h, {"penFore": _index_of(color)})


def SetPenBack(h, *color):
    _set_attrs(h, {"penBack": _index_of(color)})


def SetOpacity(h, opacity):
    v = max(0, min(100, int(opacity)))
    _set_attrs(h, {"fillOpacity": v, "penOpacity": v})


def SetOpacityN(h, fillOpacity, penOpacity):
    _set_attrs(h, {"fillOpacity": max(0, min(100, int(fillOpacity))), "penOpacity": max(0, min(100, int(penOpacity)))})


def _by_class(h, group, on=True):
    o = _obj(h)
    if o.get("attrs") is None:
        raise TypeError("%r has no attributes of its own" % h)
    groups = o.setdefault("byClass", [])
    if on and group not in groups:
        groups.append(group)
    elif not on and group in groups:
        groups.remove(group)
    _S.ops.append(["byclass", [o["id"]], group, bool(on)])


# Rodeo keeps a fill's pattern and colours by class together, as the file does
def SetFPatByClass(h):
    _by_class(h, "fill")


def SetFillColorByClass(h):
    _by_class(h, "fill")


def SetLSByClass(h):
    _by_class(h, "lineStyle")


def SetLWByClass(h):
    _by_class(h, "lineWeight")


def SetPenColorByClass(h):
    _by_class(h, "penColor")


def SetOpacityByClass(h):
    _by_class(h, "opacity")


def _attr(h, key):
    a = _obj(h).get("attrs")
    if a is None:
        raise TypeError("%r has no attributes of its own" % h)
    return a.get(key, 0)


def GetFPat(h):
    return _attr(h, "fillPattern")


def GetLW(h):
    return _attr(h, "lineWeight")


def GetOpacity(h):
    return _attr(h, "fillOpacity")


def GetFillFore(h):
    return _rgb16(_attr(h, "fillFore"))


def GetFillBack(h):
    return _rgb16(_attr(h, "fillBack"))


def GetPenFore(h):
    return _rgb16(_attr(h, "penFore"))


def GetPenBack(h):
    return _rgb16(_attr(h, "penBack"))


# ---- changing objects ------------------------------------------------------------------------

def SetName(h, name):
    if _is_layer(h):
        # a layer is renamed in the drawing: the layer's own name, which no other layer may have
        l = _layer(h)
        name = str(name)
        if name and any(x is not l and x["name"] == name for x in _S.layers):
            raise ValueError("another layer is already named %r" % name)
        l["name"] = name
        _S.ops.append(["layername", l["id"], name])
        return
    o = _obj(h)
    name = str(name)
    if name and any(x is not o and x.get("name") == name for x in _S.objs.values()):
        raise ValueError("another object is already named %r" % name)
    o["name"] = name
    _S.ops.append(["name", o["id"], name])


def SetClass(h, name):
    o = _obj(h)
    name = str(name)
    _ensure_class(name)
    o["cls"] = name
    _S.ops.append(["class", [o["id"]], name])


def SetClassN(h, name, children=False):
    SetClass(h, name)
    if children:
        for o in _walk(_obj(h)["id"], True):
            SetClass(Handle(o["id"]), name)


def SetText(h, text):
    o = _obj(h, "a text object")
    g = o.get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("vs.SetText takes a text object")
    g["text"] = str(text)
    _S.ops.append(["text", o["id"], str(text)])


def SetRField(h, record, field, value):
    o = _obj(h)
    fmt = _S.formats.get(record)
    if fmt is None:
        raise ValueError("the drawing has no record format named %r" % record)
    o.setdefault("records", {}).setdefault(record, {})[field] = str(value)
    _S.ops.append(["record", o["id"], fmt, field, str(value)])


def HMove(h, *args):
    dx, dy = _nums(args, 2, "HMove")
    _xform([_obj(h)["id"]], [1, 0, 0, 1, _mm(dx), _mm(dy)])


def HRotate(h, *args):
    cx, cy, angle = _nums(args, 3, "HRotate")
    _xform([_obj(h)["id"]], _rotation(_mm(cx), _mm(cy), angle))


def HScale2D(h, cx, cy, sx, sy, scaleText=True):
    cx, cy, sx, sy = _mm(cx), _mm(cy), float(sx), float(sy)
    if sx == 0 or sy == 0:
        raise ValueError("vs.HScale2D can't scale to nothing")
    _xform([_obj(h)["id"]], [sx, 0, 0, sy, cx * (1 - sx), cy * (1 - sy)])


def Mirror(h, dup, *args):
    x1, y1, x2, y2 = [_mm(v) for v in _nums(args, 4, "Mirror")]
    dx, dy = x2 - x1, y2 - y1
    n = dx * dx + dy * dy
    if n == 0:
        raise ValueError("vs.Mirror needs two different points on the axis")
    a = (dx * dx - dy * dy) / n
    b = 2 * dx * dy / n
    m = [a, b, b, -a, x1 - a * x1 - b * y1, y1 - b * x1 + a * y1]
    target = HDuplicate(h, 0, 0) if dup else h
    _xform([target._id], m)
    return target


def _selected_top(all_layers=False):
    out = []
    layers = [l["id"] for l in _S.layers] if all_layers else [_S.active_layer]
    for lid in layers:
        out.extend(i for i in _S.kids.get(lid, []) if _S.objs[i]["sel"])
    return out


def MoveObjs(*args):
    v = _flat(args)
    dx, dy = _mm(v[0]), _mm(v[1])
    all_layers = bool(v[2]) if len(v) > 2 else False
    all_objects = bool(v[3]) if len(v) > 3 else False
    layers = [l["id"] for l in _S.layers] if all_layers else [_S.active_layer]
    ids = []
    for lid in layers:
        ids.extend(i for i in _S.kids.get(lid, []) if all_objects or _S.objs[i]["sel"])
    _xform(ids, [1, 0, 0, 1, dx, dy])


def Rotate(angle):
    ids = _selected_top()
    if not ids:
        return
    loci = [i for i in ids if _S.objs[i]["type"] == 17]
    if len(loci) == 1:
        cx, cy = _S.objs[loci[0]]["shape"]["pts"][0]
    else:
        boxes = [b for b in (_box(_S.objs[i]) for i in ids) if b]
        if not boxes:
            return
        cx = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2
        cy = (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2
    _xform(ids, _rotation(cx, cy, float(angle)))


def _duplicate(ids, dx, dy):
    s = _S
    tmps = []
    for i in ids:
        s.seq += 1
        tmp = "new:%d" % s.seq
        tmps.append(tmp)
    s.ops.append(["dup", tmps, list(ids), dx, dy])
    for i, tmp in zip(ids, tmps):
        _copy_object(s.objs[i], tmp, None)
        _transform_copy(s.objs[tmp], [1, 0, 0, 1, dx, dy])
        s.last_new = tmp
    return tmps


def _copy_object(o, new_id, parent):
    s = _S
    c = _json.loads(_json.dumps(o))
    c["id"] = new_id
    c["sel"] = False
    c["name"] = ""
    if parent is not None:
        c["parent"] = parent
    s.objs[new_id] = c
    sibs = s.kids.setdefault(_container(c), [])
    if parent is None and o["id"] in sibs:
        sibs.insert(sibs.index(o["id"]) + 1, new_id)
    else:
        sibs.append(new_id)
    for k in list(s.kids.get(o["id"], [])):
        s.seq += 1
        _copy_object(s.objs[k], "copy:%d" % s.seq, new_id)


def HDuplicate(h, *args):
    dx, dy = _nums(args, 2, "HDuplicate")
    return Handle(_duplicate([_obj(h)["id"]], _mm(dx), _mm(dy))[0])


def Duplicate(*args):
    dx, dy = _nums(args, 2, "Duplicate")
    ids = _selected_top()
    if not ids:
        return
    tmps = _duplicate(ids, _mm(dx), _mm(dy))
    for i in ids:
        _S.objs[i]["sel"] = False
    for t in tmps:
        _S.objs[t]["sel"] = True
    _S.sel_changed = True


def _remove(ids):
    s = _S
    gone = []
    def drop(i):
        o = s.objs.pop(i, None)
        if o is None:
            return
        gone.append(i)
        sibs = s.kids.get(_container(o), [])
        if i in sibs:
            sibs.remove(i)
        for k in list(s.kids.pop(i, [])):
            drop(k)
    for i in ids:
        drop(i)
    if s.last_new in gone:
        s.last_new = None
    return gone


def DelObject(h):
    o = _obj(h)
    _S.ops.append(["delete", [o["id"]]])
    _remove([o["id"]])


def DeleteObjs():
    ids = _selected_top()
    if ids:
        _S.ops.append(["delete", ids])
        _remove(ids)


def _arrange(h, how):
    o = _obj(h)
    sibs = _siblings(o)
    i = sibs.index(o["id"])
    sibs.pop(i)
    if how == "front":
        sibs.append(o["id"])
    elif how == "back":
        sibs.insert(0, o["id"])
    elif how == "forward":
        sibs.insert(min(i + 1, len(sibs)), o["id"])
    else:
        sibs.insert(max(i - 1, 0), o["id"])
    _S.ops.append(["arrange", [o["id"]], how])


def HMoveForward(h, toFront):
    _arrange(h, "front" if toFront else "forward")


def HMoveBackward(h, toBack):
    _arrange(h, "back" if toBack else "backward")


def Group():
    ids = _selected_top()
    if not ids:
        return
    tmp = _group(ids)
    for i in ids:
        _S.objs[i]["sel"] = False
    _S.objs[tmp]["sel"] = True
    _S.sel_changed = True


def Ungroup():
    s = _S
    groups = [i for i in _selected_top() if s.objs[i]["type"] == 11]
    if not groups:
        return
    s.ops.append(["ungroup", groups])
    for gid in groups:
        g = s.objs.pop(gid)
        sibs = s.kids.get(_container(g), [])
        at = sibs.index(gid)
        sibs.pop(at)
        members = s.kids.pop(gid, [])
        for k, m in enumerate(members):
            s.objs[m]["parent"] = g["parent"]
            s.objs[m]["sel"] = True
            sibs.insert(at + k, m)
    s.sel_changed = True


# ---- selection -------------------------------------------------------------------------------

def SetSelect(h):
    _obj(h)["sel"] = True
    _S.sel_changed = True


def SetDSelect(h):
    _obj(h)["sel"] = False
    _S.sel_changed = True


def DSelectAll():
    for o in _S.objs.values():
        o["sel"] = False
    _S.sel_changed = True


def SelectAll():
    for i in _S.kids.get(_S.active_layer, []):
        o = _S.objs[i]
        if _visible(o):
            o["sel"] = True
    _S.sel_changed = True


# ---- layers and classes ----------------------------------------------------------------------

def Layer(name):
    s = _S
    name = str(name)
    for l in s.layers:
        if l["name"] == name:
            s.active_layer = l["id"]
            s.layer_changed = True
            return
    s.seq += 1
    tmp = "layer:%d" % s.seq
    scale = s.layer_by_id[s.active_layer]["scale"] if s.active_layer in s.layer_by_id else 1
    l = {"id": tmp, "name": name, "kind": "design", "scale": scale, "vis": "visible", "elev": 0.0}
    s.layers.append(l)
    s.layer_by_id[tmp] = l
    s.kids[tmp] = []
    s.ops.append(["layer", tmp, name, "design", scale])
    s.active_layer = tmp
    s.layer_changed = True


def _ensure_class(name):
    if name not in _S.classes:
        _S.classes[name] = {"name": name, "vis": "visible"}
        _S.class_names.append(name)
        _S.ops.append(["newclass", name])


def NameClass(name):
    name = str(name)
    _ensure_class(name)
    _S.active_class = name
    _S.class_changed = True


def ActiveClass():
    return _S.active_class


def ClassNum():
    return len(_S.class_names)


def ClassList(index):
    i = int(index)
    return _S.class_names[i - 1] if 1 <= i <= len(_S.class_names) else ""


def _class_vis(name, vis):
    name = str(name)
    if name not in _S.classes:
        raise ValueError("the drawing has no class named %r" % name)
    _S.classes[name]["vis"] = vis
    _S.ops.append(["classvis", name, vis])


def ShowClass(name):
    _class_vis(name, "visible")


def HideClass(name):
    _class_vis(name, "hidden")


def GrayClass(name):
    _class_vis(name, "grayed")


# ---- search criteria -------------------------------------------------------------------------

_TYPE_NAMES = {
    "LINE": 2, "RECT": 3, "OVAL": 4, "POLY": 5, "ARC": 6, "FHAND": 8, "LOCUS3D": 9, "TEXT": 10, "GROUP": 11, "RRECT": 13,
    "BITMAP": 14, "SYMBOL": 15, "LOCUS": 17, "SPRDSHEET": 18, "POLYLINE": 21, "PICT": 22, "XTRD": 24, "POLY3D": 25,
    "LAYERLINK": 29, "SWEEP": 34, "MXTRD": 38, "MESH": 40, "DIMENSION": 63, "WALL": 68, "SLAB": 71, "LIGHT": 81,
    "ROOF": 83, "CSGSOLID": 84, "PLUGINOBJECT": 86, "ROOFELEMENT": 87, "SOLID": 95, "NURBSCURVE": 111,
    "NURBSSURFACE": 113, "VIEWPORT": 122,
}
_SCOPE_WORDS = ("INSYMBOL", "INOBJECT", "INVIEWPORT", "NOTINDLVP", "NOTINREFDLVP", "INWALL")
# the flags a bare word tests (SEL, VSEL, V), and the attribute codes the snapshot holds for each object
_FLAG_WORDS = ("SEL", "VSEL", "V")
_ATTR_CODES = {"FB": "fillBack", "FF": "fillFore", "FP": "fillPattern", "PB": "penBack", "PF": "penFore", "PP": "penPattern", "OPA": "opacity"}


def _tokens(text):
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch in "()&|[],":
            out.append(ch)
            i += 1
        elif ch in "<>":
            two = text[i:i + 2]
            if two in ("<>", "<=", ">="):
                out.append(two)
                i += 2
            else:
                out.append(ch)
                i += 1
        elif ch == ".":
            out.append(".")
            i += 1
        elif ch == "=":
            out.append("=")
            i += 1
        elif ch in "'\"":
            j = text.find(ch, i + 1)
            if j < 0:
                raise ValueError("criteria: a quote isn't closed in %r" % text)
            out.append(("str", text[i + 1:j]))
            i = j + 1
        else:
            j = i
            while j < len(text) and not text[j].isspace() and text[j] not in "()&|[],=<>'\"":
                # a dot ends a word, unless the word is a number and a digit follows (1.5)
                if text[j] == "." and not (text[i:j].lstrip("+-").isdigit() and text[j + 1:j + 2].isdigit()):
                    break
                j += 1
            out.append(("word", text[i:j]))
            i = j
    return out


def _criteria(text):
    toks = _tokens(str(text))
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def take():
        t = peek()
        pos[0] += 1
        return t

    def value():
        t = take()
        if isinstance(t, tuple):
            return t[1]
        raise ValueError("criteria: expected a value in %r" % text)

    def expr():
        left = term()
        while _op(peek(), "|", "OR"):
            take()
            right = term()
            left = (lambda a, b: lambda o: a(o) or b(o))(left, right)
        return left

    def term():
        left = factor()
        while _op(peek(), "&", "AND"):
            take()
            right = factor()
            left = (lambda a, b: lambda o: a(o) and b(o))(left, right)
        return left

    def factor():
        t = peek()
        if t == "(":
            take()
            f = expr()
            if take() != ")":
                raise ValueError("criteria: a bracket isn't closed in %r" % text)
            return f
        if isinstance(t, tuple) and t[1].upper() == "NOT":
            take()
            f = factor()
            return lambda o: not f(o)
        return atom()

    def atom():
        t = take()
        if not isinstance(t, tuple):
            raise ValueError("criteria: unexpected %r in %r" % (t, text))
        if peek() == ".":
            # a record's field: 'Record Name'.'Field Name' <op> value
            take()
            f = take()
            if not isinstance(f, tuple):
                raise ValueError("criteria: a record's field name is expected in %r" % text)
            op = take()
            if op not in _FIELD_OPS:
                raise ValueError("criteria: %s needs = <> < > <= or >= after its field in %r" % (t[1], text))
            return _field_test(t[1], f[1], op, value())
        word = t[1].upper()
        if word == "ALL" or word in _SCOPE_WORDS:
            return lambda o: True
        nxt = peek()
        if word in _FLAG_WORDS and not (nxt in ("=", "<>") or (isinstance(nxt, tuple) and nxt[1].upper() == "IN")):
            # a bare flag: ((SEL)) is the selected objects, the same as SEL=TRUE
            return _criterion(word, "TRUE", text)
        if isinstance(nxt, tuple) and nxt[1].upper() == "IN":
            take()
            if take() != "[":
                raise ValueError("criteria: %s IN takes a list in [ ] in %r" % (word, text))
            names = [value()]
            while peek() == ",":
                take()
                names.append(value())
            if take() != "]":
                raise ValueError("criteria: a list isn't closed in %r" % text)
            tests = [_criterion(word, v, text) for v in names]
            return lambda o: any(f(o) for f in tests)
        op = take()
        if op not in ("=", "<>"):
            raise ValueError("criteria: %s needs = or <> in %r" % (word, text))
        test = _criterion(word, value(), text)
        return test if op == "=" else (lambda o: not test(o))

    f = expr()
    if peek() is not None:
        raise ValueError("criteria: unexpected %r in %r" % (peek(), text))
    return f


_FIELD_OPS = ("=", "<>", "<", ">", "<=", ">=")
# unit marks a criteria number may end with; the number is compared without them
_UNIT_MARKS = ("mm", "cm", "yd", "ft", "in", "m", "'", '"', "\u00b0", "%")


def _field_number(v):
    # the number a value reads as, or None (a text that isn't one). A unit mark after it is dropped.
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    for mark in _UNIT_MARKS:
        if s.lower().endswith(mark) and len(s) > len(mark):
            s = s[: -len(mark)].strip()
            break
    if not s or s[0] not in "+-.0123456789":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _field_cmp(a, b, op):
    # Rodeo's reading: numbers compare as numbers when both sides read as numbers; otherwise the texts
    # compare ignoring case (an empty field is ""). Vectorworks' own rule may differ for mixed values.
    na, nb = _field_number(a), _field_number(b)
    if na is not None and nb is not None:
        x, y = na, nb
    else:
        x = "" if a is None else str(a).casefold()
        y = "" if b is None else str(b).casefold()
    return {"=": x == y, "<>": x != y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y}[op]


def _ci_key(d, name):
    # the key of d that matches name ignoring case (record names, as field names here), or None
    want = str(name).casefold()
    for k in d:
        if str(k).casefold() == want:
            return k
    return None


def _field_test(rec, fld, op, v):
    """'Record'.'Field' <op> value. An object matches only if it has the record and the field and the
    comparison holds; one without the record never matches, not even for <> or ''. Record and field names
    match ignoring case (Rodeo's reading)."""
    def test(o):
        recs = o.get("records") or {}
        rk = _ci_key(recs, rec)
        if rk is None:
            return False
        fields = recs[rk] or {}
        fk = _ci_key(fields, fld)
        if fk is None:
            return False
        return _field_cmp(fields[fk], v, op)
    return test


def _op(t, sym, word):
    # & or AND, | or OR, as the criteria write them
    return t == sym or (isinstance(t, tuple) and t[0] == "word" and t[1].upper() == word)


def _attr_of(o, key):
    a = o.get("attrs")
    return a.get(key, 0) if a is not None else None


def _criterion(word, v, text):
    truth = str(v).upper() in ("TRUE", "1")
    if word == "SEL":
        return lambda o: bool(o["sel"]) == truth
    if word == "V":
        return lambda o: _visible(o) == truth
    if word == "R":
        return lambda o: v in (o.get("records") or {})
    if word in _ATTR_CODES:
        key = _ATTR_CODES[word]
        n = int(v)
        return lambda o: _attr_of(o, key) == n
    if word == "VSEL":
        return lambda o: (bool(o["sel"]) and _visible(o)) == truth
    if word == "T":
        code = int(v) if str(v).isdigit() else _TYPE_NAMES.get(str(v).upper())
        if code is None:
            raise ValueError("criteria: unknown object type %r" % v)
        if code == 4:
            return lambda o: o["type"] == 4 or (o["type"] == 6 and abs((o.get("shape") or {}).get("sweep", 0)) >= 360)
        return lambda o: o["type"] == code
    if word == "C":
        return lambda o: o["cls"] == v
    if word == "L":
        return lambda o: _S.layer_by_id.get(o["layer"], {}).get("name") == v
    if word == "N":
        return lambda o: (o.get("name") or "") == v
    if word == "PON":
        return lambda o: o.get("typeName") == v
    if word == "S":
        return lambda o: _S.symbols.get(o.get("sym")) == v
    raise NotImplementedError("criteria %s isn't available in Rodeo yet (in %r)" % (word, text))


def _all_objects():
    for l in _S.layers:
        for o in _walk(l["id"], True):
            yield o


def ForEachObject(callback, c):
    test = _criteria(c)
    for o in [o for o in _all_objects() if test(o)]:
        if o["id"] in _S.objs:
            callback(Handle(o["id"]))


def Count(c):
    test = _criteria(c)
    return sum(1 for o in _all_objects() if test(o))


def _select_matching(c, on):
    test = _criteria(c)
    for l in _S.layers:
        for o in _walk(l["id"], False):
            if test(o):
                o["sel"] = on
    _S.sel_changed = True


def SelectObj(c):
    _select_matching(c, True)


def DSelectObj(c):
    _select_matching(c, False)


def ForEachObjectInLayer(actionFunc, objOptions, travOptions, layerOptions):
    lo = int(layerOptions)
    if lo == 0:
        layers = [_S.active_layer]
    elif lo == 2:
        layers = [l["id"] for l in _S.layers if l["vis"] != "hidden"]
    else:
        layers = [l["id"] for l in _S.layers]
    oo = int(objOptions)
    deep = int(travOptions) in (1, 2)
    found = []
    for lid in layers:
        for o in _walk(lid, deep):
            if oo & 2 and not o["sel"]:
                continue
            if oo & 1 and not _visible(o):
                continue
            found.append(o["id"])
    for i in found:
        if i in _S.objs and actionFunc(Handle(i)):
            break


# ---- the user --------------------------------------------------------------------------------

def _host(kind, *args):
    if not _S.jspi:
        raise RuntimeError("vs.%s waits for an answer, which needs a browser that can pause a script (Chrome or Edge)" % kind)
    from pyodide.ffi import run_sync
    import _rodeo
    return run_sync(_rodeo.ask(kind, _json.dumps(args)))


def Message(*z):
    text = "".join(str(x) for x in z)
    _S.messages.append(text)


def ClrMessage():
    pass


def SysBeep():
    pass


def AlrtDialog(message):
    if _S.jspi:
        _host("AlrtDialog", str(message))
    else:
        _S.alerts.append(str(message))


def _answer(kind, request, default):
    got = _json.loads(_host(kind, str(request), str(default)))
    _S.cancelled = got is None
    return got


def StrDialog(request, default=""):
    v = _answer("StrDialog", request, default)
    return "" if v is None else str(v)


def IntDialog(request, default="0"):
    v = _answer("IntDialog", request, default)
    return 0 if v is None else int(v)


def RealDialog(request, default="0"):
    v = _answer("RealDialog", request, default)
    return 0.0 if v is None else float(v)


def YNDialog(s):
    v = _answer("YNDialog", s, "")
    return bool(v)


def DidCancel():
    return _S.cancelled


def _pick(kind):
    """Points the user clicks in the drawing (mm); Esc ends the script, keeping what it did."""
    got = _json.loads(_host(kind, _S.messages[-1] if _S.messages else ""))
    if got is None:
        raise SystemExit(0)
    return [_pt_out(p) for p in got]


def GetPt(callback=None):
    p = _pick("GetPt")[0]
    if callback is None:
        return p
    callback(p)


def GetLine(callback=None):
    a, b = _pick("GetLine")
    if callback is None:
        return (a, b)
    callback(a, b)


def GetRect(callback=None):
    a, b = _pick("GetRect")
    if callback is None:
        return (a, b)
    callback(a, b)


# ---- layout dialogs --------------------------------------------------------------------------
# A dialog the script lays out (CreateLayout, its controls, SetFirstLayoutItem, SetBelowItem,
# SetRightItem...) is kept here as it is built. RunLayoutDialog shows it in the editor and calls the
# script's handler: with SetupDialogC first, then with each control clicked or changed (and a
# choice's index), until OK (1) or Cancel (2) closes it, then with SetdownDialogC. The handler reads
# and sets this copy, which each event brings up to date with the editor's controls.

_SETUP_DIALOG = 12255
_SETDOWN_DIALOG = 12256
_OK = 1
_CANCEL = 2
# CreateEditReal's kinds that are lengths in the drawing's units: a dimension, an x or a y coordinate
_EDIT_LENGTHS = (3, 4, 5)


def _dialog(dialog):
    d = _S.dialogs.get(int(dialog))
    if d is None:
        raise ValueError("there's no dialog %r (CreateLayout makes one)" % (dialog,))
    return d


def _item(dialog, item):
    d = _dialog(dialog)
    c = d["items"].get(int(item))
    if c is None:
        raise ValueError("dialog %s has no item %r" % (d["id"], item))
    return c


def _width(chars):
    try:
        w = float(chars)
    except (TypeError, ValueError):
        return None
    return w if w > 0 else None


def _layout(title, ok, cancel):
    did = len(_S.dialogs) + 1
    _S.dialogs[did] = {"id": did, "title": str(title), "first": None, "focus": None, "items": {
        _OK: {"id": _OK, "kind": "ok", "text": str(ok) or "OK", "enabled": True, "visible": True},
        _CANCEL: {"id": _CANCEL, "kind": "cancel", "text": str(cancel), "enabled": True, "visible": bool(cancel)},
    }}
    return did


def CreateLayout(title, hasHelp=False, defaultButton="OK", cancelButton="Cancel"):
    return _layout(title, defaultButton, cancelButton)


def CreateResizableLayout(title, hasHelp, defaultButton, cancelButton, widthResizable=False, heightResizable=False):
    return _layout(title, defaultButton, cancelButton)


def _control(dialog, item, kind, **more):
    c = {"id": int(item), "kind": kind, "text": "", "enabled": True, "visible": True}
    c.update(more)
    _dialog(dialog)["items"][int(item)] = c


def CreateStaticText(dialog, item, text, width=-1):
    _control(dialog, item, "static", text=str(text), width=_width(width))


def CreateEditText(dialog, item, text, width=20):
    _control(dialog, item, "edit", text=str(text), width=_width(width))


def CreateEditTextBox(dialog, item, text, width=20, height=4):
    _control(dialog, item, "edit", text=str(text), width=_width(width), lines=max(1, int(height)))


def CreateEditReal(dialog, item, kind, value, width=10):
    _control(dialog, item, "real", edit=int(kind), value=float(value), raw=None, width=_width(width))


def CreateEditInteger(dialog, item, value, width=10):
    _control(dialog, item, "int", value=int(value), raw=None, width=_width(width))


def CreateCheckBox(dialog, item, text):
    _control(dialog, item, "check", text=str(text), value=False)


def CreateThreeStateCheckBox(dialog, item, text):
    _control(dialog, item, "check3", text=str(text), value=0)


def CreateRadioButton(dialog, item, text):
    _control(dialog, item, "radio", text=str(text), value=False)


def CreatePushButton(dialog, item, text):
    _control(dialog, item, "button", text=str(text))


def CreatePullDownMenu(dialog, item, width=20):
    _control(dialog, item, "popup", choices=[], sel=[], width=_width(width))


def CreateClassPullDownMenu(dialog, item, width=20):
    _control(dialog, item, "popup", choices=list(_S.class_names), sel=[], width=_width(width))


def CreateLayerPullDownMenu(dialog, item, width=20):
    names = [l["name"] for l in _S.layers if l.get("kind") == "design"]
    _control(dialog, item, "popup", choices=names, sel=[], width=_width(width))


def CreateListBox(dialog, item, width=20, height=8):
    _control(dialog, item, "list", choices=[], sel=[], width=_width(width), lines=max(1, int(height)), multi=False)


def CreateListBoxN(dialog, item, width, height, multiple):
    _control(dialog, item, "list", choices=[], sel=[], width=_width(width), lines=max(1, int(height)), multi=bool(multiple))


def CreateColorPopup(dialog, item, width=-1):
    _control(dialog, item, "color", value=0, width=_width(width))


def CreateGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "group", text=str(text), frame=bool(hasFrame), first=None)


def CreateCheckBoxGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "checkgroup", text=str(text), frame=bool(hasFrame), first=None, value=False)


def CreateRadioButtonGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "radiogroup", text=str(text), frame=bool(hasFrame), first=None, value=False)


def CreateTabControl(dialog, item):
    _control(dialog, item, "tabs", panes=[], value=None)


def CreateTabPane(dialog, tabs, group):
    t = _item(dialog, tabs)
    t["panes"].append(int(group))
    if t["value"] is None:
        t["value"] = int(group)


def SelectTabPane(dialog, tabs, pane):
    _item(dialog, tabs)["value"] = int(pane)


def CreateSeparator(dialog, item, length=20):
    _control(dialog, item, "sep", width=_width(length))


def CreateImageControl(dialog, item, width=0, height=0, *image):
    """An image from the plug-in's resource file, which Rodeo doesn't read: an empty frame of the size given, in pixels."""
    _control(dialog, item, "frame", text="", pw=_px(width), ph=_px(height))


CreateImageControl2 = CreateImageControl


def SetFirstLayoutItem(dialog, item):
    _dialog(dialog)["first"] = int(item)


def _place(dialog, src, dst, where, indent, space):
    _item(dialog, src)[where] = int(dst)
    c = _item(dialog, dst)
    c["indent"] = float(indent)
    c["space"] = float(space)


def SetBelowItem(dialog, src, below, indent=0, space=0):
    _place(dialog, src, below, "below", indent, space)


def SetRightItem(dialog, src, right, indent=0, space=0):
    _place(dialog, src, right, "right", indent, space)


def SetFirstGroupItem(dialog, group, item):
    _item(dialog, group)["first"] = int(item)


def VerifyLayout(dialog):
    _dialog(dialog)
    return True


def _choice_text(c):
    sel = c.get("sel") or []
    choices = c.get("choices") or []
    return choices[sel[0]] if sel and 0 <= sel[0] < len(choices) else ""


def GetItemText(dialog, item):
    c = _item(dialog, item)
    if c["kind"] in ("real", "int"):
        if c.get("raw") is not None:
            return c["raw"]
        return "" if c["value"] is None else "%g" % c["value"]
    if c["kind"] in ("popup", "list"):
        return _choice_text(c)
    return c.get("text", "")


def SetItemText(dialog, item, text):
    c = _item(dialog, item)
    if c["kind"] in ("real", "int"):
        try:
            c["value"] = float(text) if c["kind"] == "real" else int(text)
            c["raw"] = None
        except (TypeError, ValueError):
            c["value"] = None
            c["raw"] = str(text)
    else:
        c["text"] = str(text)


def GetEditReal(dialog, item, kind=1):
    v = _item(dialog, item).get("value")
    return (False, 0.0) if v is None else (True, float(v))


def SetEditReal(dialog, item, kind, value):
    c = _item(dialog, item)
    c["value"] = float(value)
    c["raw"] = None


def GetEditInteger(dialog, item):
    v = _item(dialog, item).get("value")
    return (False, 0) if v is None else (True, int(v))


def SetEditInteger(dialog, item, value):
    c = _item(dialog, item)
    c["value"] = int(value)
    c["raw"] = None


def GetBooleanItem(dialog, item):
    return bool(_item(dialog, item).get("value"))


def SetBooleanItem(dialog, item, state):
    _item(dialog, item)["value"] = bool(state)


def GetThreeStateCheckBoxState(dialog, item):
    return int(_item(dialog, item).get("value") or 0)


def SetThreeStateCheckBoxState(dialog, item, state):
    _item(dialog, item)["value"] = int(state)


def AddChoice(dialog, item, text, index=-1):
    c = _item(dialog, item)
    choices = c.setdefault("choices", [])
    i = int(index)
    if i < 0 or i >= len(choices):
        choices.append(str(text))
    else:
        choices.insert(i, str(text))
        c["sel"] = [s + 1 if s >= i else s for s in c.get("sel", [])]
    # a pull-down menu always shows a choice: its first until one is chosen
    if c["kind"] == "popup" and not c.get("sel"):
        c["sel"] = [0]


InsertChoice = AddChoice


def RemoveChoice(dialog, item, index):
    c = _item(dialog, item)
    i = int(index)
    if 0 <= i < len(c.get("choices", [])):
        del c["choices"][i]
        c["sel"] = [s - 1 if s > i else s for s in c.get("sel", []) if s != i]


def RemoveAllChoices(dialog, item):
    c = _item(dialog, item)
    c["choices"] = []
    c["sel"] = []


DeleteAllItems = RemoveAllChoices


def GetChoiceCount(dialog, item):
    return len(_item(dialog, item).get("choices", []))


def GetChoiceText(dialog, item, index):
    choices = _item(dialog, item).get("choices", [])
    i = int(index)
    return choices[i] if 0 <= i < len(choices) else ""


def GetChoiceIndex(dialog, item, text):
    choices = _item(dialog, item).get("choices", [])
    return choices.index(str(text)) if str(text) in choices else -1


def GetSelectedChoiceInfo(dialog, item, at=0):
    """The first chosen at or after index at (a list's choices are walked this way), and its text; -1 when none."""
    c = _item(dialog, item)
    after = sorted(s for s in c.get("sel", []) if s >= int(at))
    if not after:
        return (-1, "")
    return (after[0], c["choices"][after[0]])


def GetSelectedChoiceIndex(dialog, item, at=0):
    return GetSelectedChoiceInfo(dialog, item, at)[0]


def SelectChoice(dialog, item, index, select=True):
    c = _item(dialog, item)
    i = int(index)
    if not select:
        c["sel"] = [s for s in c.get("sel", []) if s != i]
    elif c.get("multi"):
        c["sel"] = sorted(set(c.get("sel", [])) | set([i]))
    else:
        c["sel"] = [i]


def GetColorChoice(dialog, item):
    return int(_item(dialog, item).get("value") or 0)


def SetColorChoice(dialog, item, color):
    _item(dialog, item)["value"] = int(color)


def EnableItem(dialog, item, enable):
    _item(dialog, item)["enabled"] = bool(enable)


def ShowItem(dialog, item, show):
    _item(dialog, item)["visible"] = bool(show)


def SetTextEditable(dialog, item, editable):
    _item(dialog, item)["readonly"] = not bool(editable)


def SetFocusOnItem(dialog, item):
    _dialog(dialog)["focus"] = int(item)


def _set_tip(dialog, item, text):
    # a tip for an item the dialog doesn't have yet is kept and shown once the item is there (Vectorworks
    # takes no error for it), see _dialog_json
    d = _dialog(dialog)
    c = d["items"].get(int(item))
    if c is None:
        d.setdefault("tips", {})[int(item)] = str(text)
    else:
        c["tip"] = str(text)


def SetHelpText(dialog, item, text):
    _set_tip(dialog, item, text)


def SetItemToolTipText(dialog, item, text, *more):
    _set_tip(dialog, item, text)


def _dialog_json(d):
    for i, text in d.get("tips", {}).items():
        if i in d["items"]:
            d["items"][i]["tip"] = text
    items = []
    for c in d["items"].values():
        c = dict(c)
        # lengths go to the editor in millimetres
        if c["kind"] == "real" and c.get("edit") in _EDIT_LENGTHS and c.get("value") is not None:
            c["value"] = _mm(c["value"])
        if c["kind"] == "tree":
            # the editor gets the items in order, each with its parent, and keeps no ids it doesn't need
            c["tree"] = _tree_spec(c)
            c.pop("nodes", None)
            c.pop("roots", None)
        items.append(c)
    return _json.dumps({"id": d["id"], "title": d["title"], "first": d["first"], "focus": d["focus"], "items": items})


def _dialog_values(d, values):
    """The editor's controls as they are when an event comes: what each holds."""
    for key, v in values.items():
        c = d["items"].get(int(key))
        if c is None:
            continue
        if c["kind"] == "lb":
            _lb_values(c, v)
            continue
        if c["kind"] == "tree":
            _tree_values(c, v)
            continue
        if "text" in v:
            c["text"] = str(v["text"])
        if "raw" in v:
            c["raw"] = v["raw"]
        if "sel" in v:
            c["sel"] = [int(s) for s in v["sel"]]
        if "value" in v:
            x = v["value"]
            if x is not None and c["kind"] == "real":
                x = _un(float(x)) if c.get("edit") in _EDIT_LENGTHS else float(x)
            elif x is not None and c["kind"] in ("int", "check3", "color", "tabs", "slider"):
                x = int(x)
            elif x is not None and c["kind"] in ("check", "radio", "checkgroup", "radiogroup"):
                x = bool(x)
            c["value"] = x


def _handle(handler, item, data):
    """The script's handler called for an event: the item it leaves (a Vectorscript handler's VAR item, or what a Python one returns)."""
    if handler is None:
        return item
    r = handler(item, data)
    return r if isinstance(r, int) and not isinstance(r, bool) else item


def RunLayoutDialog(dialog, handler=None):
    d = _dialog(dialog)
    if not _S.jspi:
        raise RuntimeError("vs.RunLayoutDialog shows a dialog the script waits on, which needs a browser that can pause a script (Chrome or Edge)")
    _handle(handler, _SETUP_DIALOG, 0)
    try:
        while True:
            got = _json.loads(_host("Dialog", _dialog_json(d))) or {}
            _dialog_values(d, got.get("values") or {})
            d["active"] = got.get("focus")
            item = _handle(handler, int(got.get("item", _CANCEL)), int(got.get("data", 0)))
            if item in (_OK, _CANCEL):
                break
        _handle(handler, _SETDOWN_DIALOG, 0)
    finally:
        _host("DialogClose", d["id"])
    return item


def _px(v):
    """A size in pixels a script gave, or None when it gave none (or a size no more than 0)."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def CreateControl(dialog, item, kind, name, data):
    """The extended controls: kind 3 is a slider from 0 to data, the picture-like kinds an empty frame."""
    k = int(kind)
    if k == 3:
        _control(dialog, item, "slider", text=str(name), max=max(0, int(data)), value=0, live=False)
    elif k in (1, 2, 26):
        _control(dialog, item, "frame", text=str(name), pw=None, ph=None)
    elif k == 10:
        _control(dialog, item, "popup", choices=[], sel=[], width=None)
    else:
        raise NotImplementedError("vs.CreateControl's control kind %s isn't available in Rodeo yet" % (k,))


def SetSliderLiveUpdate(dialog, item, liveUpdate):
    """A slider reports each move while it is dragged, not only its release."""
    c = _item(dialog, item)
    if c["kind"] != "slider":
        raise ValueError("item %r of dialog %s isn't a slider" % (item, _dialog(dialog)["id"]))
    c["live"] = bool(liveUpdate)


def GetControlData(dialog, item):
    """A slider's position, or an image's resource ID as SetControlData gave it."""
    c = _item(dialog, item)
    if c["kind"] == "slider":
        return int(c.get("value") or 0)
    if c["kind"] == "frame":
        return int(c.get("image") or 0)
    raise NotImplementedError("vs.GetControlData isn't available in Rodeo yet for this kind of control")


def SetControlData(dialog, item, data):
    """A slider's position (kept within its range), or an image's resource ID (drawn as an empty frame)."""
    c = _item(dialog, item)
    if c["kind"] == "slider":
        c["value"] = min(max(0, int(data)), int(c.get("max") or 0))
    elif c["kind"] == "frame":
        c["image"] = int(data)
    else:
        raise NotImplementedError("vs.SetControlData isn't available in Rodeo yet for this kind of control")


def GetActiveEditItem(dialog):
    """The control holding the keyboard focus when the last event came (0 when none)."""
    return int(_dialog(dialog).get("active") or 0)


# List browsers: a table of columns and rows, each cell keeping its text and what is set on it. Rows
# and columns are numbered from 0. The editor draws the table and reports selections, checks, sorts
# and events; what it doesn't draw (images, owner-drawn cells, patterns, markers, line styles...) is
# kept on the cell all the same, so the Get calls return what the script set.

_LB_EVENT_SELECT = -4
_LB_EVENT_CHECK = -2
_LB_EVENT_DOUBLE = -5
_LB_EVENT_SORT = -10


def _lb(dialog, item):
    c = _item(dialog, item)
    if c["kind"] != "lb":
        raise ValueError("item %r of dialog %s isn't a list browser" % (item, _dialog(dialog)["id"]))
    return c


def _lb_row(c, index):
    i = int(index)
    if not 0 <= i < len(c["rows"]):
        raise ValueError("the list browser has no item %r (its items are 0 to %d)" % (index, len(c["rows"]) - 1))
    return c["rows"][i]


def _lb_column(c, index):
    i = int(index)
    if not 0 <= i < len(c["cols"]):
        raise ValueError("the list browser has no column %r (its columns are 0 to %d)" % (index, len(c["cols"]) - 1))
    return i


def _lb_cell(c, row, sub):
    return _lb_row(c, row)["cells"][_lb_column(c, sub)]


def _lb_new_cell():
    return {"text": "", "num": None, "image": 0, "check": 0, "just": None, "style": 0, "tcolor": None, "fill": None, "fillb": None, "data": 0, "attr": {}}


def _lb_new_col(header, width):
    w = _width(width)
    return {"header": str(header), "width": w if w else 10, "ctype": 1, "dtype": 0, "etype": 0, "hjust": 1, "tip": "", "subtip": "", "tracking": True, "radio": False, "image": 0, "owner": 0, "data": []}


def _lb_attr(c, row, sub, name, value):
    _lb_cell(c, row, sub)["attr"][name] = value


def _lb_get(c, row, sub, name, default):
    return _lb_cell(c, row, sub)["attr"].get(name, default)


def _lb_sort_key(cell):
    return (0, cell["num"], "") if cell.get("num") is not None else (1, 0, cell["text"].lower())


def _lb_sort(c, col, ascending):
    """Puts the rows in order by a column; the selection follows its rows. Rodeo's reading: a sort is stable, so equal rows keep their order."""
    chosen = [c["rows"][i] for i in c["sel"] if 0 <= i < len(c["rows"])]
    c["rows"].sort(key=lambda r: _lb_sort_key(r["cells"][col]), reverse=not ascending)
    c["sel"] = sorted(i for i, r in enumerate(c["rows"]) if any(r is x for x in chosen))
    c["sort"] = [col, bool(ascending)]


def CreateLB(dialog, item, width=20, height=8):
    _control(dialog, item, "lb", cols=[], rows=[], sel=[], multi=True, single=False, sorting=False, sort=None,
             colLines=False, hdr=True, readonly=False, dragdrop=False, hier=False, hiercol=-1, lines=max(1, int(height)),
             width=_width(width), event=None, tabs=[])


def InsertLBColumn(dialog, item, columnIndex, headerString, width):
    c = _lb(dialog, item)
    i = int(columnIndex)
    if not 0 <= i <= len(c["cols"]):
        i = len(c["cols"])
    c["cols"].insert(i, _lb_new_col(headerString, width))
    for r in c["rows"]:
        cell = _lb_new_cell()
        if i == 0 and r.get("lead") is not None:
            cell["text"] = r["lead"]
        r["cells"].insert(i, cell)
    if c["hiercol"] >= i:
        c["hiercol"] += 1
    return i


def DeleteLBColumn(dialog, item, columnIndex):
    c = _lb(dialog, item)
    i = _lb_column(c, columnIndex)
    del c["cols"][i]
    for r in c["rows"]:
        del r["cells"][i]
    if c.get("sort") and c["sort"][0] == i:
        c["sort"] = None


def GetNumLBColumns(dialog, item):
    return len(_lb(dialog, item)["cols"])


def InsertLBItem(dialog, item, itemIndex, itemString):
    c = _lb(dialog, item)
    i = int(itemIndex)
    if not 0 <= i <= len(c["rows"]):
        i = len(c["rows"])
    row = {"cells": [_lb_new_cell() for _ in c["cols"]], "lead": str(itemString)}
    if c["cols"]:
        row["cells"][0]["text"] = str(itemString)
    c["rows"].insert(i, row)
    c["sel"] = [s + 1 if s >= i else s for s in c["sel"]]
    return i


def DeleteLBItem(dialog, item, itemIndex):
    c = _lb(dialog, item)
    _lb_row(c, itemIndex)
    i = int(itemIndex)
    del c["rows"][i]
    c["sel"] = [s - 1 if s > i else s for s in c["sel"] if s != i]


def DeleteAllLBItems(dialog, item):
    c = _lb(dialog, item)
    c["rows"] = []
    c["sel"] = []


def GetNumLBItems(dialog, item):
    return len(_lb(dialog, item)["rows"])


def SetLBItemInfo(dialog, item, itemIndex, subItemIndex, itemString, imageIndex):
    """In a check or radio column the image index is the state: non-zero is on (Rodeo's reading; the reference doesn't name the on image)."""
    c = _lb(dialog, item)
    cell = _lb_cell(c, itemIndex, subItemIndex)
    cell["text"] = str(itemString)
    cell["num"] = None
    cell["image"] = int(imageIndex)
    if c["cols"][_lb_column(c, subItemIndex)]["ctype"] in (2, 3):
        cell["check"] = 1 if int(imageIndex) else 0
    return True


def GetLBItemInfo(dialog, item, itemIndex, subItemIndex):
    c = _lb(dialog, item)
    cell = _lb_cell(c, itemIndex, subItemIndex)
    image = cell["check"] if c["cols"][_lb_column(c, subItemIndex)]["ctype"] in (2, 3) else cell["image"]
    return (True, cell["text"], image)


def SetLBNumericItemInfo(dialog, item, itemIndex, subItemIndex, itemString, itemNumVal, imageIndex):
    cell = _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)
    cell["text"] = str(itemString)
    cell["num"] = float(itemNumVal)
    cell["image"] = int(imageIndex)
    return True


def SetLBSelection(dialog, item, firstItemIndex, lastItemIndex, select):
    c = _lb(dialog, item)
    lo, hi = sorted((int(firstItemIndex), int(lastItemIndex)))
    _lb_row(c, lo)
    _lb_row(c, hi)
    span = range(lo, hi + 1)
    if not select:
        c["sel"] = [s for s in c["sel"] if s not in span]
    elif c["single"]:
        c["sel"] = [lo]
    else:
        c["sel"] = sorted(set(c["sel"]) | set(span))
    return True


def GetNumSelectedLBItems(dialog, item):
    return len(_lb(dialog, item)["sel"])


def IsLBItemSelected(dialog, item, itemIndex):
    return int(itemIndex) in _lb(dialog, item)["sel"]


def EnableLB(dialog, item, enable):
    _item(dialog, item)["enabled"] = bool(enable)


def EnableLBSingleLineSelection(dialog, item, enable):
    c = _lb(dialog, item)
    c["single"] = bool(enable)
    if c["single"]:
        c["sel"] = c["sel"][:1]
    return True


def EnableLBSorting(dialog, item, enableSorting):
    _lb(dialog, item)["sorting"] = bool(enableSorting)


def IsLBSortingEnabled(dialog, item):
    return bool(_lb(dialog, item)["sorting"])


def SetLBSortColumn(dialog, item, columnIndex, isAscending):
    c = _lb(dialog, item)
    _lb_sort(c, _lb_column(c, columnIndex), bool(isAscending))


def GetLBSortColumn(dialog, item):
    c = _lb(dialog, item)
    return c["sort"][0] if c["sort"] else -1


def GetLBColumnSortState(dialog, item, columnIndex):
    """0 when the column isn't sorted, -1 when its items run 1 to n, 1 when they run n to 1."""
    c = _lb(dialog, item)
    i = _lb_column(c, columnIndex)
    if not c["sort"] or c["sort"][0] != i:
        return 0
    return -1 if c["sort"][1] else 1


def EnableLBColumnLines(dialog, item, enableColumnLines):
    _lb(dialog, item)["colLines"] = bool(enableColumnLines)


def AreLBColumnLinesEnabled(dialog, item):
    return bool(_lb(dialog, item)["colLines"])


def EnableLBRadioColumnLines(dialog, item, columnIndex, enableRadioColumnLines):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["radio"] = bool(enableRadioColumnLines)


def AreLBRadioColumnLinesEnabled(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return bool(c["cols"][_lb_column(c, columnIndex)]["radio"])


def SetLBColumnWidth(dialog, item, fromColumn, toColumn, width):
    c = _lb(dialog, item)
    lo, hi = sorted((int(fromColumn), int(toColumn)))
    _lb_column(c, lo)
    _lb_column(c, hi)
    for i in range(lo, hi + 1):
        c["cols"][i]["width"] = max(1, int(width))
    return True


def GetLBColumnWidth(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return (True, c["cols"][_lb_column(c, columnIndex)]["width"])


def SetLBControlType(dialog, item, columnIndex, controlType):
    """Rodeo draws 2 (radio) and 3 (multi state) as toggles; the other types are drawn as plain text."""
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["ctype"] = int(controlType)
    return True


def GetLBControlType(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return c["cols"][_lb_column(c, columnIndex)]["ctype"]


def SetLBItemDisplayType(dialog, item, columnIndex, displayType):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["dtype"] = int(displayType)
    return True


def GetLBItemDisplayType(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return c["cols"][_lb_column(c, columnIndex)]["dtype"]


def SetLBEditDisplayType(dialog, item, columnIndex, displayType):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["etype"] = int(displayType)
    return True


def GetLBEditDisplayType(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return c["cols"][_lb_column(c, columnIndex)]["etype"]


def SetLBColumnHeaderJust(dialog, item, columnIndex, justification):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["hjust"] = int(justification)
    return True


def GetLBColumnHeaderJust(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return (True, c["cols"][_lb_column(c, columnIndex)]["hjust"])


def SetLBColumnHeaderToolTip(dialog, item, columnIndex, toolTipPrimaryText, toolTipSubText):
    c = _lb(dialog, item)
    col = c["cols"][_lb_column(c, columnIndex)]
    col["tip"] = str(toolTipPrimaryText)
    col["subtip"] = str(toolTipSubText)
    return True


def GetLBColumnHeaderToolTip(dialog, item, columnIndex):
    c = _lb(dialog, item)
    col = c["cols"][_lb_column(c, columnIndex)]
    return (True, col["tip"], col["subtip"])


def SetLBItemTextJust(dialog, item, itemIndex, subItemIndex, justification):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["just"] = int(justification)
    return True


def GetLBItemTextJust(dialog, item, itemIndex, subItemIndex):
    cell = _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)
    return (True, cell["just"] if cell["just"] is not None else 1)


def SetLBItemTextStyle(dialog, item, itemIndex, subItemIndex, textStyle):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["style"] = int(textStyle)
    return True


def GetLBItemTextStyle(dialog, item, itemIndex, subItemIndex):
    return (True, _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["style"])


def SetLBItemTextColor(dialog, item, itemIndex, subItemIndex, redIndex, greenIndex, blueIndex):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["tcolor"] = [int(redIndex), int(greenIndex), int(blueIndex)]
    return True


def SetLBItemTextColorN(dialog, item, itemIndex, subItemIndex, tint):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "tint", int(tint))
    return True


def GetLBItemTextColor(dialog, item, itemIndex, subItemIndex):
    v = _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["tcolor"] or [0, 0, 0]
    return (True, v[0], v[1], v[2])


def SetLBItemFillForeColor(dialog, item, itemIndex, subItemIndex, redIndex, greenIndex, blueIndex):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["fill"] = [int(redIndex), int(greenIndex), int(blueIndex)]
    return True


def GetLBItemFillForeColor(dialog, item, itemIndex, subItemIndex):
    v = _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["fill"] or [255, 255, 255]
    return (True, v[0], v[1], v[2])


def SetLBItemFillBackColor(dialog, item, itemIndex, subItemIndex, redIndex, greenIndex, blueIndex):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["fillb"] = [int(redIndex), int(greenIndex), int(blueIndex)]
    return True


def GetLBItemFillBackColor(dialog, item, itemIndex, subItemIndex):
    v = _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["fillb"] or [255, 255, 255]
    return (True, v[0], v[1], v[2])


def SetLBItemPenForeColor(dialog, item, itemIndex, subItemIndex, redIndex, greenIndex, blueIndex):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "penFore", [int(redIndex), int(greenIndex), int(blueIndex)])
    return True


def GetLBItemPenForeColor(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "penFore", [0, 0, 0])
    return (True, v[0], v[1], v[2])


def SetLBItemPenBackColor(dialog, item, itemIndex, subItemIndex, redIndex, greenIndex, blueIndex):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "penBack", [int(redIndex), int(greenIndex), int(blueIndex)])
    return True


def GetLBItemPenBackColor(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "penBack", [255, 255, 255])
    return (True, v[0], v[1], v[2])


def SetLBItemDashStyle(dialog, item, itemIndex, subItemIndex, styleIndex, lineWeight):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "dash", [int(styleIndex), float(lineWeight)])
    return True


def GetLBItemDashStyle(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "dash", [0, 0.0])
    return (True, v[0], v[1])


def SetLBItemLineType(dialog, item, itemIndex, subItemIndex, lineType, lineWeight):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "line", [int(lineType), float(lineWeight)])
    return True


def GetLBItemLineType(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "line", [0, 0.0])
    return (True, v[0], v[1])


def SetLBItemMkrChoice(dialog, item, itemIndex, subItemIndex, style, angle, size, width, thicknessBasis, thickness):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "marker", [int(style), int(angle), float(size), float(width), int(thicknessBasis), float(thickness)])
    return True


def GetLBItemMkrChoice(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "marker", [0, 0, 0.0, 0.0, 0, 0.0])
    return (True, v[0], v[1], v[2], v[3], v[4], v[5])


def SetLBItemMkrByClass(dialog, item, itemIndex, subItemIndex, isByClass):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "markerByClass", bool(isByClass))
    return True


def GetLBItemMkrByClass(dialog, item, itemIndex, subItemIndex):
    return (True, bool(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "markerByClass", False)))


def ShowLBItemMkrByClass(dialog, item, itemIndex, subItemIndex, showByClass):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "showMarkerByClass", bool(showByClass))


def ShowLBItemMkrEditLst(dialog, item, itemIndex, subItemIndex, showEditList):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "showMarkerEdit", bool(showEditList))


def ShowLBItemByClassOpt(dialog, item, itemIndex, subItemIndex, isByClassShown):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "showByClass", bool(isByClassShown))


def SetLBItemByClass(dialog, item, itemIndex, subItemIndex, isByClass):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "byClass", bool(isByClass))
    return True


def GetLBItemByClass(dialog, item, itemIndex, subItemIndex):
    return bool(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "byClass", False))


def SetLBItemPatternIndex(dialog, item, itemIndex, subItemIndex, patIndex):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "pattern", int(patIndex))
    return True


def GetLBItemPatternIndex(dialog, item, itemIndex, subItemIndex):
    return (True, int(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "pattern", 0)))


def SetLBItemGradientOrImageRefNumber(dialog, item, itemIndex, subItemIndex, refNumber):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "ref", int(refNumber))
    return True


def GetLBItemGradientOrImageRefNumber(dialog, item, itemIndex, subItemIndex):
    return (True, int(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "ref", 0)))


def SetLBItemHatchRefNum(dialog, item, itemIndex, subItemIndex, refNumber):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "hatch", int(refNumber))
    return True


def GetLBItemHatchRefNum(dialog, item, itemIndex, subItemIndex):
    return (True, int(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "hatch", 0)))


def SetLBItemTileRefNum(dialog, item, itemIndex, subItemIndex, refNumber):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "tile", int(refNumber))
    return True


def GetLBItemTileRefNum(dialog, item, itemIndex, subItemIndex):
    return (True, int(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "tile", 0)))


def SetLBMultImageIndexes(dialog, item, itemIndex, subItemIndex, imageIndex0, imageIndex1, imageIndex2):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "images", [int(imageIndex0), int(imageIndex1), int(imageIndex2)])
    return True


def GetLBMultImageIndexes(dialog, item, itemIndex, subItemIndex):
    v = _lb_get(_lb(dialog, item), itemIndex, subItemIndex, "images", [0, 0, 0])
    return (True, v[0], v[1], v[2])


def SetLBColumnImage(dialog, item, columnIndex, imageIndex):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["image"] = int(imageIndex)
    return True


def SetLBColumnOwnerDrawnType(dialog, item, itemIndex, subItemIndex, ownerDrawnType):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "owner", int(ownerDrawnType))
    return True


def GetLBColumnOwnerDrawnType(dialog, item, itemIndex, subItemIndex):
    return (True, int(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "owner", 0)))


def SetLBItemInteracType(dialog, item, itemIndex, subItemIndex, interactionType):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "interaction", int(interactionType))
    return True


def SetLBItemReadOnly(dialog, item, itemIndex, subItemIndex, readOnly):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["attr"]["readOnly"] = bool(readOnly)


def IsLBItemReadOnly(dialog, item, itemIndex, subItemIndex):
    return bool(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "readOnly", False))


def SetLBReadOnly(dialog, item, readOnly):
    _lb(dialog, item)["readonly"] = bool(readOnly)


def IsLBReadOnly(dialog, item):
    return bool(_lb(dialog, item)["readonly"])


def SetLBResOnlyCurDoc(dialog, item, itemIndex, subItemIndex, onlyCurrentDoc):
    _lb_attr(_lb(dialog, item), itemIndex, subItemIndex, "resOnlyCurDoc", bool(onlyCurrentDoc))


def IsLBResOnlyCurDoc(dialog, item, itemIndex, subItemIndex):
    return bool(_lb_get(_lb(dialog, item), itemIndex, subItemIndex, "resOnlyCurDoc", False))


def SetLBItemData(dialog, item, itemIndex, subItemIndex, userData):
    _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["data"] = int(userData)


def GetLBItemData(dialog, item, itemIndex, subItemIndex):
    return _lb_cell(_lb(dialog, item), itemIndex, subItemIndex)["data"]


def SetLBItemUsingColumnDataItem(dialog, item, itemIndex, subItemIndex, columnDataItemIndex):
    """The cell takes the text and data of one of its column's data items."""
    c = _lb(dialog, item)
    cell = _lb_cell(c, itemIndex, subItemIndex)
    data = c["cols"][_lb_column(c, subItemIndex)]["data"]
    k = int(columnDataItemIndex)
    if not 0 <= k < len(data):
        raise ValueError("the column has no data item %r" % (columnDataItemIndex,))
    cell["text"] = data[k]["text"]
    cell["data"] = data[k]["data"]
    return True


def EnsureLBItemIsVisible(dialog, item, index):
    """Rodeo's list doesn't scroll from a script: the row is checked and the list is left where it is."""
    _lb_row(_lb(dialog, item), index)
    return True


def RefreshLB(dialog, item):
    _lb(dialog, item)
    return True


def SetFocusOnLB(dialog, item):
    _dialog(dialog)["focus"] = int(item)


def GetLBEventInfo(dialog, item):
    """The last event the list sent: its type (a kMessage constant), row and column; False when none came yet."""
    e = _lb(dialog, item).get("event")
    if not e:
        return (False, 0, -1, -1)
    return (True, e["type"], e["row"], e["col"])


def InsertLBColumnDataItem(dialog, item, columnIndex, itemString, imageOn, imageOff, itemData):
    c = _lb(dialog, item)
    data = c["cols"][_lb_column(c, columnIndex)]["data"]
    data.append({"text": str(itemString), "on": int(imageOn), "off": int(imageOff), "data": int(itemData)})
    return len(data) - 1


def GetNumLBColumnDataItems(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return len(c["cols"][_lb_column(c, columnIndex)]["data"])


def FindLBColumnDataItem(dialog, item, columnIndex, itemString):
    c = _lb(dialog, item)
    data = c["cols"][_lb_column(c, columnIndex)]["data"]
    for k, d in enumerate(data):
        if d["text"] == str(itemString):
            return (True, k)
    return (False, -1)


def FindLBColumnItem(dialog, item, columnIndex, itemString):
    c = _lb(dialog, item)
    i = _lb_column(c, columnIndex)
    for k, r in enumerate(c["rows"]):
        if r["cells"][i]["text"] == str(itemString):
            return (True, k)
    return (False, -1)


def GetLBColumnDataItemInfo(dialog, item, columnIndex, columnDataItemIndex):
    c = _lb(dialog, item)
    data = c["cols"][_lb_column(c, columnIndex)]["data"]
    k = int(columnDataItemIndex)
    if not 0 <= k < len(data):
        return (False, "", 0, 0, 0)
    d = data[k]
    return (True, d["text"], d["on"], d["off"], d["data"])


def RemoveLBColumnDataItem(dialog, item, columnIndex, columnDataItemIndex):
    c = _lb(dialog, item)
    data = c["cols"][_lb_column(c, columnIndex)]["data"]
    k = int(columnDataItemIndex)
    if not 0 <= k < len(data):
        return False
    del data[k]
    return True


def RemoveAllLBColumnDataItems(dialog, item, columnIndex):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["data"] = []


def EnableLBHierDisplay(dialog, item, enableHierDisplay):
    _lb(dialog, item)["hier"] = bool(enableHierDisplay)


def IsLBDisplayHier(dialog, item):
    return bool(_lb(dialog, item)["hier"])


def SetLBHierDispColumn(dialog, item, columnID):
    c = _lb(dialog, item)
    c["hiercol"] = _lb_column(c, columnID)


def CollapseAllLBItems(dialog, item):
    _lb(dialog, item)


def ExpandAllLBItems(dialog, item):
    _lb(dialog, item)


def HierLBItemOpened(dialog, item, itemIndex, recursive):
    """Rodeo's list has no containers to open: nothing is redisplayed."""
    _lb_row(_lb(dialog, item), itemIndex)
    return 0


def HierLBItemClosed(dialog, item, itemIndex, recursive):
    _lb_row(_lb(dialog, item), itemIndex)
    return 0


def HierLBItemIsClosed(dialog, item, itemIndex):
    _lb_row(_lb(dialog, item), itemIndex)
    return False


def HierLBItemIsContain(dialog, item, itemIndex):
    _lb_row(_lb(dialog, item), itemIndex)
    return False


def EnableLBClickAllDataChange(dialog, item, enable):
    _lb(dialog, item)["clickAll"] = bool(enable)


def EnableLBColumnTracking(dialog, item, columnIndex, enableColumnTracking):
    c = _lb(dialog, item)
    c["cols"][_lb_column(c, columnIndex)]["tracking"] = bool(enableColumnTracking)


def IsLBColumnTrackingEnabled(dialog, item, columnIndex):
    c = _lb(dialog, item)
    return bool(c["cols"][_lb_column(c, columnIndex)]["tracking"])


def EnableLBDragAndDrop(dialog, item, enable):
    _lb(dialog, item)["dragdrop"] = bool(enable)


def EnableLBDropOnIndices(dialog, item, startIndex, endIndex, enable):
    _lb(dialog, item)["dropOn"] = [int(startIndex), int(endIndex), bool(enable)]


def EnableLBExternalSort(dialog, item, enable):
    _lb(dialog, item)["externalSort"] = bool(enable)


def EnableLBUpdates(dialog, item, enableUpdates):
    _lb(dialog, item)["updates"] = bool(enableUpdates)


def SetLBDragDropColumn(dialog, item, columnIndex):
    c = _lb(dialog, item)
    c["dragCol"] = _lb_column(c, columnIndex)
    return True


def ShowLBHeader(dialog, item, show):
    _lb(dialog, item)["hdr"] = bool(show)


def SetLBOrigNameClLevel(dialog, item, originalName, level1Closed, level2Closed, level3Closed):
    raise NotImplementedError("vs.SetLBOrigNameClLevel isn't available in Rodeo yet (it needs the class names of the Vectorworks document)")


def GetLBOrigNameClLevel(dialog, item, originalName):
    raise NotImplementedError("vs.GetLBOrigNameClLevel isn't available in Rodeo yet (it needs the class names of the Vectorworks document)")


def AddLBOriginalName(dialog, item, originalName):
    raise NotImplementedError("vs.AddLBOriginalName isn't available in Rodeo yet (it needs the class names of the Vectorworks document)")


def GetLBItemOrigName(dialog, item, itemIndex):
    raise NotImplementedError("vs.GetLBItemOrigName isn't available in Rodeo yet (it needs the class names of the Vectorworks document)")


def GetLBHeaderTextWidth(className, allowForSortIcon):
    raise NotImplementedError("vs.GetLBHeaderTextWidth isn't available in Rodeo yet (it needs the font's measures)")


def AddLBImage(dialog, item, resourceType, resourceID):
    raise NotImplementedError("vs.AddLBImage isn't available in Rodeo yet (images come from the Vectorworks resource files, which Rodeo doesn't read)")


def AddListBrowserImage(dialog, controlID, imageSpecifier):
    raise NotImplementedError("vs.AddListBrowserImage isn't available in Rodeo yet (images come from the Vectorworks resource files, which Rodeo doesn't read)")


def SetLBImageIndexes(dialog, item, itemIndex, subItemIndex, imageSpecifier0, imageSpecifier1, imageSpecifier2):
    raise NotImplementedError("vs.SetLBImageIndexes isn't available in Rodeo yet (images come from the Vectorworks resource files, which Rodeo doesn't read)")


def SetListBoxTabStops(dialog, item, tabStops):
    """Tab stops of a list box: kept on the item; the editor doesn't lay text out at them."""
    _item(dialog, item)["tabs"] = list(tabStops) if isinstance(tabStops, (list, tuple)) else [tabStops]


def AddListBoxTabStop(dialog, item, tabStop):
    _item(dialog, item).setdefault("tabs", []).append(tabStop)


def RemoveListBoxTabStop(dialog, item):
    _item(dialog, item)["tabs"] = []


def ShowByClassChoice(dialog, item):
    raise NotImplementedError("vs.ShowByClassChoice isn't available in Rodeo yet (class choices need the document's classes)")


def IsClassChoiceSelected(dialog, item):
    raise NotImplementedError("vs.IsClassChoiceSelected isn't available in Rodeo yet (class choices need the document's classes)")


def SelectClassChoice(dialog, item, select):
    raise NotImplementedError("vs.SelectClassChoice isn't available in Rodeo yet (class choices need the document's classes)")


def _lb_values(c, v):
    """A list browser's values as the editor sends them: its selection, its check boxes, a sort the user asked for, and the event."""
    n = len(c["rows"])
    if "sel" in v:
        c["sel"] = sorted(set(int(s) for s in v["sel"] if 0 <= int(s) < n))
    for key, on in (v.get("checks") or {}).items():
        r, k = [int(x) for x in key.split(",")]
        if r < n and k < len(c["cols"]):
            c["rows"][r]["cells"][k]["check"] = 1 if on else 0
    want = v.get("sort")
    # a sort the user asked for is done here, once: the rows then come back in that order
    if c["sorting"] and want is not None and list(want) != list(c["sort"] or []):
        col = int(want[0])
        if 0 <= col < len(c["cols"]):
            _lb_sort(c, col, bool(want[1]))
    c["event"] = v.get("event")


# Tree controls: items with a parent (0 at the top) and children in order; the editor gets them
# depth first. Item ids are numbered from 1 as the script inserts them.

def _tree(dialog, item):
    c = _item(dialog, item)
    if c["kind"] != "tree":
        raise ValueError("item %r of dialog %s isn't a tree control" % (item, _dialog(dialog)["id"]))
    return c


def _tree_node(c, item_id):
    n = c["nodes"].get(int(item_id))
    if n is None:
        raise ValueError("the tree control has no item %r" % (item_id,))
    return n


def _tree_spec(c):
    out = []

    def walk(ids):
        for i in ids:
            n = c["nodes"][i]
            out.append([i, n["text"], n["parent"], bool(n["kids"])])
            walk(n["kids"])

    walk(c["roots"])
    return out


def _tree_values(c, v):
    if "sel" in v:
        c["sel"] = [int(s) for s in v["sel"] if int(s) in c["nodes"]][:1]
    if "open" in v:
        c["open"] = [int(i) for i in v["open"] if int(i) in c["nodes"]]
    c["event"] = v.get("event")


def _tree_drop(c, i):
    for k in c["nodes"][i]["kids"]:
        _tree_drop(c, k)
    del c["nodes"][i]


def CreateTreeControl(dialog, item, width, height):
    _control(dialog, item, "tree", nodes={}, roots=[], sel=[], open=[], next=1, width=_width(width), lines=max(1, int(height)), event=None)


def InsertTreeControlItem(dialog, item, label, parent, after):
    """A new item under parent (-1 for the top level), after the sibling named by after (0 for first). Returns its id."""
    c = _tree(dialog, item)
    top = int(parent) <= 0
    siblings = c["roots"] if top else _tree_node(c, parent)["kids"]
    a = int(after)
    if a <= 0:
        pos = 0
    elif a in siblings:
        pos = siblings.index(a) + 1
    else:
        raise ValueError("tree item %r isn't under the same parent as the new item" % (after,))
    i = c["next"]
    c["next"] += 1
    c["nodes"][i] = {"text": str(label), "parent": 0 if top else int(parent), "kids": [], "data": 0}
    siblings.insert(pos, i)
    return i


def RemoveTreeControlItem(dialog, item, itemID):
    c = _tree(dialog, item)
    i = int(itemID)
    n = _tree_node(c, i)
    parent_kids = c["roots"] if n["parent"] == 0 else c["nodes"][n["parent"]]["kids"]
    parent_kids.remove(i)
    _tree_drop(c, i)
    c["sel"] = [s for s in c["sel"] if s in c["nodes"]]
    c["open"] = [s for s in c["open"] if s in c["nodes"]]
    return True


def SelectTreeControlItem(dialog, item, itemID):
    c = _tree(dialog, item)
    _tree_node(c, itemID)
    c["sel"] = [int(itemID)]


def GetTreeControlSelectedItem(dialog, item):
    c = _tree(dialog, item)
    return (True, c["sel"][0]) if c["sel"] else (False, 0)


def GetTreeControlTextSelectedItem(dialog, item):
    c = _tree(dialog, item)
    return (True, c["nodes"][c["sel"][0]]["text"]) if c["sel"] else (False, "")


def GetTreeControlItemText(dialog, item, itemID):
    return (True, _tree_node(_tree(dialog, item), itemID)["text"])


def GetTreeControlItemData(dialog, item, itemID):
    return _tree_node(_tree(dialog, item), itemID)["data"]


def SetTreeControlItemData(dialog, item, itemID, userData):
    _tree_node(_tree(dialog, item), itemID)["data"] = int(userData)


def ExpandTreeControlItem(dialog, item, itemID, expand):
    c = _tree(dialog, item)
    i = int(itemID)
    _tree_node(c, i)
    c["open"] = [s for s in c["open"] if s != i] + ([i] if expand else [])


# Popups that list names: a pull-down search, an enhanced pull-down, thumbnails and the image popups
# (zero-based for GetImagePopupObject, one-based for the selected item and the removals, as the
# reference gives them).

def CreatePullDownSearch(dialog, item, width):
    _control(dialog, item, "popup", choices=[], sel=[], width=_width(width), ids=[])


def InsertPulldownSearch(dialog, item, itemIDStr, itemDisplayName, itemTooltip, itemImageSpec, shouldUpdate):
    c = _item(dialog, item)
    AddChoice(dialog, item, itemDisplayName)
    c.setdefault("ids", []).append(str(itemIDStr))
    return True


def CreateEnhancedPullDownMenu(dialog, item, width, showIcon):
    _control(dialog, item, "popup", choices=[], sel=[], width=_width(width), enhanced=bool(showIcon))


def InsertEnhancedPullDownMenuItem(dialog, item, name, iconID):
    AddChoice(dialog, item, name)
    return len(_item(dialog, item)["choices"]) - 1


InsertEnhanPullDownMenuItem = InsertEnhancedPullDownMenuItem


def RemoveEnhancedPullDownMenuItemRange(dialog, item, start, end):
    for k in range(int(end), int(start) - 1, -1):
        RemoveChoice(dialog, item, k)


def ShowEnhancedPullDownMenuGroupIcon(dialog, item, show):
    """Pure display: the editor's pop-up has no group icon to show."""
    _item(dialog, item)


def NotifyPullDownClicked(dialog, item):
    """Pure display: a pop-up that is clicked opens by itself in the editor."""
    _item(dialog, item)


def CreateThumbnailPopup(dialog, item):
    _control(dialog, item, "popup", choices=[], sel=[], width=None)


def CreateCustThumbPopup(dialog, item, sizeType):
    _control(dialog, item, "popup", choices=[], sel=[], width=None)


def UpdateThumbnailPreview(dialog, item):
    """Pure display: the editor's pop-up shows names, not previews."""
    _item(dialog, item)


def CreateResourcePopup(dialog, item, width):
    _control(dialog, item, "popup", choices=[], sel=[], width=_width(width))


def InsertImagePopupResource(dialog, item, listID, index):
    raise NotImplementedError("vs.InsertImagePopupResource isn't available in Rodeo yet (resource lists come from the Vectorworks resource files, which Rodeo doesn't read)")


def InsertImagePopupObjectItem(dialog, item, objectName):
    AddChoice(dialog, item, objectName)
    return len(_item(dialog, item)["choices"]) - 1


def InsertImagePopupSeparator(dialog, item, label):
    """A separator is kept as a choice of its own, marked; the editor shows it as an ordinary entry."""
    AddChoice(dialog, item, label)
    c = _item(dialog, item)
    k = len(c["choices"]) - 1
    c.setdefault("seps", []).append(k)
    return k


def GetImagePopupObject(dialog, item, itemIndex):
    choices = _item(dialog, item).get("choices", [])
    i = int(itemIndex)
    return choices[i] if 0 <= i < len(choices) else ""


def GetImagePopupObjectItemIndex(dialog, item, objectName):
    """One-based, like the selected item (the reference gives both one-based); 0 when no such item."""
    choices = _item(dialog, item).get("choices", [])
    return choices.index(str(objectName)) + 1 if str(objectName) in choices else 0


def GetImagePopupSelectedItem(dialog, item):
    sel = _item(dialog, item).get("sel") or []
    return sel[0] + 1 if sel else 0


def SetImagePopupSelectedItem(dialog, item, itemIndex):
    c = _item(dialog, item)
    i = int(itemIndex) - 1
    if not 0 <= i < len(c.get("choices", [])):
        raise ValueError("the image popup has no item %r (its items are 1 to %d)" % (itemIndex, len(c.get("choices", []))))
    c["sel"] = [i]


def GetNumImagePopupItems(dialog, item):
    return len(_item(dialog, item).get("choices", []))


def RemoveImagePopupItem(dialog, item, itemIndex):
    RemoveChoice(dialog, item, int(itemIndex) - 1)


def RemoveAllImagePopupItems(dialog, item):
    RemoveAllChoices(dialog, item)


GetPopUpChoiceIndex = GetChoiceIndex


def CreateLayerPDMenu(dialog, item, width):
    CreateLayerPullDownMenu(dialog, item, width)


def CreateDesignLayerPullDownMenu(dialog, item, width):
    CreateLayerPullDownMenu(dialog, item, width)


def CreateSheetLayerPullDownMenu(dialog, item, width):
    names = [l["name"] for l in _S.layers if l.get("kind") == "sheet"]
    _control(dialog, item, "popup", choices=names, sel=[], width=_width(width))


def CreateDataVisPDMenu(dialog, item, width, showDefaultStaticItems):
    raise NotImplementedError("vs.CreateDataVisPDMenu isn't available in Rodeo yet (data visualisation)")


def CreatePullDownMenuGroupBox(dialog, item, width, label, hasFrame):
    raise NotImplementedError("vs.CreatePullDownMenuGroupBox isn't available in Rodeo yet")


def InsertPropClassOrLayerItem(dialog, item, label, imageSpec):
    AddChoice(dialog, item, label)
    return True


def InsertProposedClassOrLayerItem(dialog, item, label, iconIndex):
    AddChoice(dialog, item, label)
    return True


# Popups that would list the drawing's line styles, weights, markers and patterns: the snapshot
# doesn't carry them yet, so these lists are empty. The chosen values are kept on the item.

def _value_popup(dialog, item, width=None):
    _control(dialog, item, "popup", choices=[], sel=[], width=width)


def CreateLineStylePopup(dialog, item):
    _value_popup(dialog, item)


def CreateLineWeightPopup(dialog, item):
    _value_popup(dialog, item)


def CreateLineAttributePopup(dialog, item):
    _value_popup(dialog, item)


def CreateMarkerPopup(dialog, item):
    _value_popup(dialog, item)


def CreatePatternPopup(dialog, item):
    _value_popup(dialog, item)


def GetLineStyleChoice(dialog, item):
    return int(_item(dialog, item).get("lineStyle", 0))


def SetLineStyleChoice(dialog, item, lineStyle):
    _item(dialog, item)["lineStyle"] = int(lineStyle)


def GetLineWeightChoice(dialog, item):
    return float(_item(dialog, item).get("lineWeight", 0.0))


def SetLineWeightChoice(dialog, item, lineWeight):
    _item(dialog, item)["lineWeight"] = float(lineWeight)


def GetLineAttributeData(dialog, item):
    c = _item(dialog, item)
    return (int(c.get("lineStyle", 0)), float(c.get("lineWeight", 0.0)))


def SetLineAttributeData(dialog, item, lineStyle, lineWeight):
    c = _item(dialog, item)
    c["lineStyle"] = int(lineStyle)
    c["lineWeight"] = float(lineWeight)


def GetLineTypeChoice(dialog, item):
    return int(_item(dialog, item).get("lineType", 0))


def SetLineTypeChoice(dialog, item, lineType):
    _item(dialog, item)["lineType"] = int(lineType)


def GetLineTypeAtIndex(dialog, item, index):
    raise NotImplementedError("vs.GetLineTypeAtIndex isn't available in Rodeo yet (the drawing's line types aren't read)")


def GetNumLineTypeItems(dialog, item):
    _item(dialog, item)
    return 0


def GetLineTypeAttriData(dialog, item):
    c = _item(dialog, item)
    return (int(c.get("lineType", 0)), float(c.get("lineWeight", 0.0)))


def SetLineTypeAttriData(dialog, item, lineType, lineWeight):
    c = _item(dialog, item)
    c["lineType"] = int(lineType)
    c["lineWeight"] = float(lineWeight)


def GetMarkerChoice(dialog, item):
    m = _item(dialog, item).get("marker", [0, 0, 0, 0.0])
    return (m[0], m[1], m[2], m[3])


def SetMarkerChoice(dialog, item, index, style, angle, size):
    _item(dialog, item)["marker"] = [int(index), int(style), int(angle), float(size)]


def GetMarkerValue(dialog, item):
    c = _item(dialog, item)
    m = c.get("markerValue", [0, 0, 0.0, 0.0, 0, 0.0])
    return tuple(m)


def SetMarkerValue(dialog, item, style, angle, length, width, basis, thickness):
    _item(dialog, item)["markerValue"] = [int(style), int(angle), float(length), float(width), int(basis), float(thickness)]


def GetMarkerPopupSelectedItem(dialog, item):
    m = _item(dialog, item).get("marker", [0, 0, 0, 0.0])
    return (m[0], m[1], m[2], m[3])


def GetPatternData(dialog, item):
    # the reference gives the colours as INTEGERs, kept as they were set (Rodeo's reading: 0 until set)
    c = _item(dialog, item)
    p = c.get("pattern", [0, 0, 0])
    return (int(p[0]), int(p[1]), int(p[2]))


def SetPatternData(dialog, item, patternIndex, foreColor, backColor):
    _item(dialog, item)["pattern"] = [int(patternIndex), int(foreColor), int(backColor)]


# Statics, buttons, frames and the rest of the controls that only change how they look.

def CreateCenteredStaticText(dialog, item, text, width=-1):
    _control(dialog, item, "static", text=str(text), width=_width(width), just="center")


def CreateRightStaticText(dialog, item, text, width=-1):
    _control(dialog, item, "static", text=str(text), width=_width(width), just="right")


def CreateStyledStatic(dialog, item, text, width=-1, style=0):
    """Style 0 is regular, 1 a caption, 2 bold and 3 a reduced size, as the reference gives them."""
    s = int(style)
    _control(dialog, item, "static", text=str(text), width=_width(width), bold=s == 2, tsize={1: "caption", 3: "reduced"}.get(s))


CreateStyledStaticText = CreateStyledStatic


def SetStaticTextStyle(dialog, item, style):
    """Bits: 1 bold, 2 italic, 4 underline; they combine."""
    c = _item(dialog, item)
    s = int(style)
    c["bold"] = bool(s & 1)
    c["italic"] = bool(s & 2)
    c["underline"] = bool(s & 4)


def SetStaticTextColor(dialog, item, red, green, blue):
    _item(dialog, item)["color"] = [int(red), int(green), int(blue)]


def SetStaticTextColorN(dialog, item, tint):
    _item(dialog, item)["tint"] = int(tint)


def SetItemClickable(dialog, item, clickable):
    _item(dialog, item)["clickable"] = bool(clickable)


def IsItemEnabled(dialog, item):
    return bool(_item(dialog, item)["enabled"])


def IsItemVisible(dialog, item):
    return bool(_item(dialog, item)["visible"])


def EnableTextEdit(dialog, item, editable):
    _item(dialog, item)["readonly"] = not bool(editable)


def CreateEditPassword(dialog, item, width):
    _control(dialog, item, "edit", text="", width=_width(width), pwd=True)


def CreateSearchEditBox(dialog, item, promptText, width):
    _control(dialog, item, "edit", text="", width=_width(width), prompt=str(promptText))


def CreateEditColorText(dialog, item, width, height):
    """The text's colour and style are not drawn: a plain text box of the size given."""
    _control(dialog, item, "edit", text="", width=_width(width), lines=max(1, int(height)))


def SetEditColorTextStyl(dialog, item, style):
    """Accepted and ignored: the editor draws the text box in its own style."""
    _item(dialog, item)


def CreateBorderlessBtn(dialog, item, label, iconResPath, isToggleButton):
    """The icon isn't drawn; the button shows its label, and a toggle keeps its pressed state."""
    _control(dialog, item, "button", text=str(label), toggle=bool(isToggleButton), value=False)


def CreateBorderlessMenu(dialog, item, label, iconResPath):
    """Drawn as a plain button: a menu opened from it isn't available in Rodeo yet."""
    _control(dialog, item, "button", text=str(label), toggle=False, value=False)


def CreateCheckBox2(dialog, item, text, iconResPath):
    CreateCheckBox(dialog, item, text)


def CreateRadioButton2(dialog, item, text, iconResPath):
    CreateRadioButton(dialog, item, text)


def CreateIconPushButton(dialog, item, iconID, width):
    raise NotImplementedError("vs.CreateIconPushButton isn't available in Rodeo yet (it is obsolete: use vs.CreateImagePushButton)")


def CreateImagePushButton(dialog, item, width, imageSpecifier):
    """An image button is a button labelled with its tooltip, since the image isn't drawn."""
    _control(dialog, item, "button", text="", toggle=False, value=False, width=_width(width), image=True)


def UpdateImagePushButton(dialog, item, imageSpecifier):
    _item(dialog, item)["image"] = True


def GetIconPushButtonState(dialog, item):
    return bool(_item(dialog, item).get("value"))


def SetIconPushButtonState(dialog, item, pressed):
    _item(dialog, item)["value"] = bool(pressed)


def UpdateImageControl2(dialog, item, imageSpecifier):
    _item(dialog, item)["image"] = str(imageSpecifier)


def UpdateImageControl3(dialog, item, imageFullPath):
    _item(dialog, item)["image"] = str(imageFullPath)


def SetImageControlPath(dialog, item, path):
    """The file isn't read: the frame stays empty."""
    _item(dialog, item)["path"] = str(path)


def SetImageControlHandle(dialog, item, hImage):
    raise NotImplementedError("vs.SetImageControlHandle isn't available in Rodeo yet (image handles aren't read)")


def CreateStandardIconControl(dialog, item, iconNumber):
    _control(dialog, item, "frame", text="", pw=None, ph=None)


def CreateCustomControl(dialog, item, width, height):
    """A custom area of the given pixel size: an empty frame, as Rodeo doesn't run the script's drawing."""
    _control(dialog, item, "frame", text="", pw=_px(width), ph=_px(height))


def CreateSymbolDisplayControl(dialog, item, symbolName, height, width, margin, renderMode, view):
    """The symbol isn't drawn: its name stands in the frame."""
    _control(dialog, item, "frame", text=str(symbolName), pw=_px(width), ph=_px(height))


def CreateSymDispCtrlN(dialog, item, symbolName, width, height, margin, view, renderMode, component, scaleByZoom):
    _control(dialog, item, "frame", text=str(symbolName), pw=_px(width), ph=_px(height))


def UpdateSymbolDisplayControl(dialog, item, symbolName, renderMode, view):
    _item(dialog, item)["text"] = str(symbolName)


def UpdateSymDispCtrlN(dialog, item, symbolName, view, renderMode, component, scaleByZoom):
    _item(dialog, item)["text"] = str(symbolName)


def CreateSwapControl(dialog, item):
    _control(dialog, item, "tabs", panes=[], value=None, swap=True)


CreateSwapPane = CreateTabPane


def DisplaySwapPane(dialog, swapControl, groupNumber):
    """groupNumber is 1-based: the n-th pane made with CreateSwapPane."""
    t = _item(dialog, swapControl)
    k = int(groupNumber) - 1
    if not 0 <= k < len(t["panes"]):
        raise ValueError("the swap control has no pane %r" % (groupNumber,))
    t["value"] = t["panes"][k]


def DisplayTabPane(dialog, tabControl, groupNumber):
    t = _item(dialog, tabControl)
    k = int(groupNumber) - 1
    if not 0 <= k < len(t["panes"]):
        raise ValueError("the tab control has no pane %r" % (groupNumber,))
    t["value"] = t["panes"][k]


def GetActivePane(dialog, tabControl):
    v = _item(dialog, tabControl).get("value")
    return int(v) if v is not None else 0


def SetControlText(dialog, item, text):
    SetItemText(dialog, item, text)


def GetMultilineText(dialog, item):
    return GetItemText(dialog, item)


def GetSelectionRange(dialog, item):
    raise NotImplementedError("vs.GetSelectionRange isn't available in Rodeo yet (the editor doesn't report the caret)")


def SetSelectionRange(dialog, item, startPos, endPos):
    """Accepted and ignored: the caret stays where the user has it."""
    _item(dialog, item)


def SelectEditText(dialog, item):
    """Accepted and ignored: the text isn't selected from a script."""
    _item(dialog, item)


def DeselectEditText(dialog, item):
    """Accepted and ignored: the text isn't selected from a script."""
    _item(dialog, item)


def RefreshItem(dialog, item):
    """Pure display: the editor redraws each control whenever the script's state changes."""
    _item(dialog, item)


def SetComponentIndeterminate(dialog, item, state):
    c = _item(dialog, item)
    if c["kind"] == "check3":
        c["value"] = 2 if state else 0
    return True


def SetComponentSize(dialog, item, width, height):
    """Accepted and ignored: a control keeps the size its creation gave it in the editor."""
    _item(dialog, item)


def AdjustComponentPixelPos(dialog, item, horizontal, vertical):
    """Accepted and ignored: controls are placed by the layout, not by pixel offsets."""
    _item(dialog, item)


def SetEdgeBinding(dialog, item, boundToLeft, boundToRight, boundToTop, boundToBottom):
    """Accepted and ignored: the dialog doesn't resize."""
    _item(dialog, item)


def SetProportionalBinding(dialog, item, leftProportional, rightProportional, topProportional, bottomProportional):
    """Accepted and ignored: the dialog doesn't resize."""
    _item(dialog, item)


def AlignItemEdge(dialog, item, whichEdge, alignID, alignMode):
    """Accepted and ignored: the dialog doesn't resize."""
    _item(dialog, item)


def GetComponentRect(dialog, item):
    raise NotImplementedError("vs.GetComponentRect isn't available in Rodeo yet (the editor's pixel positions aren't reported)")


def GetComponentTextWidth(dialog, item):
    raise NotImplementedError("vs.GetComponentTextWidth isn't available in Rodeo yet (the editor's text widths aren't reported)")


def GetDlgCtrlWidthStdCh(text):
    raise NotImplementedError("vs.GetDlgCtrlWidthStdCh isn't available in Rodeo yet (the editor's font measures aren't read)")


def SetLayoutDialogSize(dialog, width, height):
    """Accepted and ignored: the editor sizes the dialog to its controls."""
    _dialog(dialog)


def SetLayoutDialogPosition(dialog, left, top):
    """Accepted and ignored: the editor centres the dialog."""
    _dialog(dialog)


def GetLayoutDialogSize(dialog):
    raise NotImplementedError("vs.GetLayoutDialogSize isn't available in Rodeo yet (the editor's dialog size isn't reported)")


def GetLayoutDialogPosition(dialog):
    raise NotImplementedError("vs.GetLayoutDialogPosition isn't available in Rodeo yet (the editor's dialog position isn't reported)")


def SetLayoutOption(dialog, option, value):
    """Accepted and ignored: the layout options of Vectorworks have no counterpart in the editor."""
    _dialog(dialog)


def RunLayoutDialogN(dialog, handler=None, enableContextualHelp=False):
    return RunLayoutDialog(dialog, handler)


def RunNamedDialog(dialog, handler, univName):
    raise NotImplementedError("vs.RunNamedDialog isn't available in Rodeo yet (dialogs built from resources aren't read)")


def RunNamedDialogN(dialog, handler, univName, enableContextualHelp=False):
    raise NotImplementedError("vs.RunNamedDialogN isn't available in Rodeo yet (dialogs built from resources aren't read)")


def SetVSResourceFile(fileName):
    raise NotImplementedError("vs.SetVSResourceFile isn't available in Rodeo yet (resource files aren't read)")


def RegisterDialogForTimerEvents(dialog, milliseconds):
    raise NotImplementedError("vs.RegisterDialogForTimerEvents isn't available in Rodeo yet (dialogs don't get timer events)")


def DeregisterDialogFromTimerEvents(dialog):
    raise NotImplementedError("vs.DeregisterDialogFromTimerEvents isn't available in Rodeo yet (dialogs don't get timer events)")


def GetColorButton(dialog, item):
    raise NotImplementedError("vs.GetColorButton isn't available in Rodeo yet (colour buttons with RGB values; use vs.CreateColorPopup)")


def SetColorButton(dialog, item, red, green, blue):
    raise NotImplementedError("vs.SetColorButton isn't available in Rodeo yet (colour buttons with RGB values; use vs.CreateColorPopup)")


# ---- numbers, units and the window -----------------------------------------------------------

def Num2Str(decPlace, v):
    d = int(decPlace)
    if d < 0:
        return "%e" % float(v)
    return "%.*f" % (min(d, 9), float(v))


def Str2Num(s):
    try:
        return float(str(s).strip())
    except ValueError:
        return 0.0


def GetUnits():
    upi = 25.4 / _S.U
    return (_S.U, _S.display, _S.format, upi, _S.unit_mark, _S.area_mark)


def ReDraw():
    pass


def ReDrawAll():
    pass


def ResetObject(h):
    if isinstance(h, Handle) and _S.pio is not None and h._id == _S.pio:
        _S.reset = True


# ---- plug-ins ----------------------------------------------------------------------------------
# A plug-in's script runs with its parameters (P and the name, spaces as underscores, in any case)
# and, for an object, the object: what the script draws goes into it, in its own frame. Its event
# (vsoGetEventInfo) is Recalculate, which draws it, or one of those that set up and update its own
# Object Info layout (runner.ts runs those and applies nothing they draw): the widgets the script
# adds, their indents, which are greyed or hidden, and a button clicked.

_RECALCULATE = 3

def _pkey(name):
    # full-width letters and digits (a plug-in's parameter named ｃｌｓ3) fold to their ASCII forms first
    return _unicodedata.normalize("NFKC", str(name)).replace(" ", "_").lower()


def _typed(t, v):
    """A parameter's value as its type has it in a script: int, float, bool or str."""
    try:
        if t == "int":
            return int(v)
        if t == "real":
            return float(v)
    except (TypeError, ValueError):
        return 0 if t == "int" else 0.0
    if t == "bool":
        return v if isinstance(v, bool) else str(v).strip().lower() in ("true", "1", "yes")
    return "" if v is None else str(v)


def _param_type(name):
    """The type a parameter's value has (for the Vectorscript translator), or None when the plug-in has no such parameter."""
    if _S is None or _pkey(name) not in _S.params:
        return None
    v = _S.params[_pkey(name)]
    return "bool" if isinstance(v, bool) else "int" if isinstance(v, int) else "real" if isinstance(v, float) else "str"


def _param(name):
    return _S.params[_pkey(name)]


def _is_record(h):
    return isinstance(h, Handle) and _S.pio is not None and h._id == "rec:" + _S.pio


def GetCustomObjectInfo():
    s = _S
    if not s.pio:
        return (False, "", None, None, None)
    return (True, s.plugin["name"], Handle(s.pio), Handle("rec:" + s.pio), None)


def GetPluginInfo():
    s = _S
    if not s.plugin:
        return (False, "", None)
    return (True, s.plugin["name"], Handle("rec:" + s.pio) if s.pio else None)


def IsNewCustomObject(name):
    return bool(_S.plugin and _S.plugin.get("isNew"))


def vsoGetEventInfo():
    p = _S.plugin or {}
    return (int(p.get("event", _RECALCULATE)), int(p.get("eventData", 0)))


def SetObjPropVS(prop, value):
    _S.ui["props"][str(int(prop))] = bool(value)
    return True


def _widget(w):
    _S.ui["widgets"].append(w)
    return True


def vsoAddWidget(widget, kind, text=""):
    return _widget({"id": int(widget), "type": int(kind), "label": str(text), "level": 0})


def vsoAppendWidget(kind, widget, text="", data=0):
    return vsoAddWidget(widget, kind, text)


def vsoAddParamWidget(widget, param, text=""):
    return _widget({"id": int(widget), "param": str(param), "label": str(text), "level": 0})


def vsoInsertAllParams():
    """Every parameter, in order (runner.ts lists them): Vectorworks numbers them from 1."""
    return _widget({"all": True, "level": 0})


def vsoWidgetSetIndLvl(widget, level):
    for w in _S.ui["widgets"]:
        if w.get("id") == int(widget):
            w["level"] = int(level)
    return True


def _widget_state(widget, key, on):
    _S.ui["states"].setdefault(str(int(widget)), {})[key] = bool(on)
    return True


def vsoWidgetSetEnable(widget, enabled):
    return _widget_state(widget, "enabled", enabled)


def vsoWidgetSetVisible(widget, visible):
    return _widget_state(widget, "visible", visible)


def GetPluginString(index):
    """A string from the plug-in's resource file, which Rodeo doesn't have: empty."""
    return ""


def _accepted(*args):
    return True


for _n in ("SetObjPropCharVS", "SetObjPropRealVS", "SetPrefInt", "vsoSetEventResult", "vsoButtonGetResource",
           "SetObjectVariableBoolean", "SetObjectVariableInt", "SetObjectVariableReal", "SetObjectVariableString",
           "SetObjectVariableHandle", "SetObjectVariableLongInt",
           # a layout dialog's fine placing and sizing, which the editor's own layout does without
           "AlignItemEdge", "SetEdgeBinding", "SetProportionalBinding", "SetLayoutDialogSize", "SetLayoutDialogPosition",
           "SetHelpString"):
    globals()[_n] = _accepted
del _n


# ---- math, strings, vectors and 2D geometry (Vectorworks' Math, Strings and Graphic Calculation calls) ----

class _Vec(tuple):
    """A point or vector a vs call returns: a tuple, as Python gets it, with Vectorscript's VECTOR fields."""

    def __new__(cls, *xyz):
        t = tuple.__new__(cls, [float(v) for v in xyz])
        t.v_x, t.v_y = t[0], t[1]
        t.v_z = t[2] if len(t) > 2 else 0.0
        return t


def _vec(v):
    """A POINT or VECTOR argument as (x, y, z): a tuple or list, or a Vectorscript VECTOR."""
    if hasattr(v, "v_x"):
        return (float(v.v_x), float(v.v_y), float(getattr(v, "v_z", 0.0)))
    t = [float(x) for x in _flat([v])]
    return (t[0], t[1], t[2] if len(t) > 2 else 0.0)


def Abs(v):
    return abs(v)


def ArcCos(v):
    return _math.acos(float(v))


def ArcSin(v):
    return _math.asin(float(v))


def ArcTan(v):
    return _math.atan(float(v))


def Cos(v):
    return _math.cos(float(v))


def Sin(v):
    return _math.sin(float(v))


def Tan(v):
    return _math.tan(float(v))


def Deg2Rad(degreeValue):
    return _math.radians(float(degreeValue))


def Rad2Deg(radianValue):
    return _math.degrees(float(radianValue))


def Exp(v):
    return _math.exp(float(v))


def Ln(v):
    return _math.log(float(v))


def Max(val1, val2):
    return max(float(val1), float(val2))


def Min(val1, val2):
    return min(float(val1), float(val2))


def Random():
    import random
    return random.random()


def Round(v):
    """To the nearest whole number, a half away from zero, as Pascal rounds."""
    v = float(v)
    return int(_math.floor(abs(v) + 0.5)) * (1 if v >= 0 else -1)


def Trunc(v):
    return int(float(v))


def Sqr(v):
    return float(v) * float(v)


def Sqrt(v):
    return _math.sqrt(float(v))


def Chr(v):
    return chr(int(v))


def UniChr(v):
    return chr(int(v))


def Ord(v):
    return ord(str(v)[0]) if str(v) else 0


def Len(v):
    return len(str(v))


def Concat(*txt):
    return "".join(str(t) for t in txt)


def Copy(source, index, count):
    i = max(int(index), 1)
    return str(source)[i - 1:i - 1 + max(int(count), 0)]


def Delete(source, index, count):
    s, i = str(source), max(int(index), 1)
    return s[:i - 1] + s[i - 1 + max(int(count), 0):]


def Insert(source, dest, index):
    """Vectorscript's Insert(source, VAR dest, index): dest with source put in at index."""
    d, i = str(dest), max(int(index), 1)
    return d[:i - 1] + str(source) + d[i - 1:]


def Pos(subStr, str_):
    return str(str_).find(str(subStr)) + 1


def UprString(s):
    return str(s).upper()


def SubString(text, delimiter, index):
    """The index-th token of text split at any of delimiter's characters, or '' when there is none."""
    toks, cur, d = [], "", str(delimiter)
    for ch in str(text):
        if d and ch in d:
            toks.append(cur)
            cur = ""
        else:
            cur += ch
    toks.append(cur)
    i = int(index)
    return toks[i - 1] if 1 <= i <= len(toks) else ""


def Num2StrF(vDistance):
    """A length in the drawing's units as it shows them: feet and inches to a sixteenth, else to its decimal places."""
    v = float(vDistance)
    if _S.format == 3:
        inches = v * (_S.U / 25.4)
        sign = "-" if inches < 0 else ""
        n16 = int(round(abs(inches) * 16))
        ft, rest = divmod(n16, 192)
        whole, frac = divmod(rest, 16)
        part = ""
        if frac:
            den = 16
            while frac % 2 == 0:
                frac, den = frac // 2, den // 2
            part = " %d/%d" % (frac, den)
        return "%s%d'-%d%s\"" % (sign, ft, whole, part)
    if _S.format == 1:
        return ("%.3f" % v).rstrip("0").rstrip(".") + '"'
    return "%.*f" % (max(0, min(int(_S.display), 9)), v)


def Angle2Str(value):
    return ("%.2f" % float(value)).rstrip("0").rstrip(".") + "°"


def Str2Angle(str_):
    """Degrees from 45, 45° or degrees, minutes and seconds (45°30'15")."""
    import re
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", str(str_))]
    if not nums:
        return 0.0
    d = nums[0]
    rest = (nums[1] if len(nums) > 1 else 0.0) / 60.0 + (nums[2] if len(nums) > 2 else 0.0) / 3600.0
    return d - rest if d < 0 else d + rest


def Ang2Vec(angleR, Length):
    a, l = _math.radians(float(angleR)), float(Length)
    return _Vec(l * _math.cos(a), l * _math.sin(a), 0.0)


def Vec2Ang(Vect):
    x, y, z = _vec(Vect)
    if x == 0 and y == 0 and z == 0:
        return -90.0
    if z:
        return _math.degrees(_math.atan2(_math.hypot(y, z), x))
    return _math.degrees(_math.atan2(y, x))


def Norm(Vec):
    x, y, z = _vec(Vec)
    return _math.sqrt(x * x + y * y + z * z)


def UnitVec(Vect):
    x, y, z = _vec(Vect)
    n = _math.sqrt(x * x + y * y + z * z)
    return _Vec(x / n, y / n, z / n) if n else _Vec(0.0, 0.0, 0.0)


def Perp(Vec):
    """At the vector's angle less 90 degrees, as long, in the plan."""
    x, y, _ = _vec(Vec)
    return _Vec(y, -x, 0.0)


def DotProduct(v1, v2):
    a, b = _vec(v1), _vec(v2)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def CrossProduct(v1, v2):
    a, b = _vec(v1), _vec(v2)
    return _Vec(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def AngBVec(v1, v2):
    a, b = _vec(v1), _vec(v2)
    na, nb = Norm(a), Norm(b)
    if not na or not nb:
        return 0.0
    c = max(-1.0, min(1.0, DotProduct(a, b) / (na * nb)))
    return _math.degrees(_math.acos(c))


def Comp(v1, v2):
    """v1's part along v2, and its part square to v2."""
    a, b = _vec(v1), _vec(v2)
    bb = DotProduct(b, b)
    k = DotProduct(a, b) / bb if bb else 0.0
    along = (b[0] * k, b[1] * k, b[2] * k)
    return (_Vec(*along), _Vec(a[0] - along[0], a[1] - along[1], a[2] - along[2]))


def Distance(x1, y1, x2, y2):
    return _math.hypot(float(x2) - float(x1), float(y2) - float(y1))


def Distance3D(x1, y1, z1, x2, y2, z2):
    return _math.sqrt((float(x2) - float(x1)) ** 2 + (float(y2) - float(y1)) ** 2 + (float(z2) - float(z1)) ** 2)


def Eq(value1, value2, tolerance):
    return abs(float(value1) - float(value2)) <= float(tolerance)


def EqPercent(value1, value2, percent):
    a, b = float(value1), float(value2)
    return abs(a - b) <= max(abs(a), abs(b)) * float(percent) / 100.0


def EqPt(pt1, pt2, tolerance):
    a, b = _vec(pt1), _vec(pt2)
    return _math.hypot(a[0] - b[0], a[1] - b[1]) <= float(tolerance)


EqPt2D = EqPt


def EqPt3D(pt1, pt2, tolerance):
    a, b = _vec(pt1), _vec(pt2)
    return Distance3D(a[0], a[1], a[2], b[0], b[1], b[2]) <= float(tolerance)


def EqualPt(p1, p2):
    a, b = _vec(p1), _vec(p2)
    return abs(a[0] - b[0]) < 1e-12 and abs(a[1] - b[1]) < 1e-12


def _corners(p1, p2):
    a, b = _vec(p1), _vec(p2)
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))


def EqualRect(rectAp1, rectAp2, rectBp1, rectBp2):
    return all(abs(u - v) < 1e-12 for u, v in zip(_corners(rectAp1, rectAp2), _corners(rectBp1, rectBp2)))


def PtInRect(point, rect1, rect2):
    x, y, _ = _vec(point)
    x0, y0, x1, y1 = _corners(rect1, rect2)
    return x0 <= x <= x1 and y0 <= y <= y1


def UnionRect(p1, p2, p3, p4):
    """The box round two boxes, each by its top left and bottom right corners: (top left, bottom right)."""
    a, b = _corners(p1, p2), _corners(p3, p4)
    return (_Vec(min(a[0], b[0]), max(a[3], b[3])), _Vec(max(a[2], b[2]), min(a[1], b[1])))


def PtPerpLine(pt, begPt, endPt):
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    d = (b[0] - a[0], b[1] - a[1])
    dd = d[0] * d[0] + d[1] * d[1]
    k = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / dd if dd else 0.0
    return _Vec(a[0] + d[0] * k, a[1] + d[1] * k, 0.0)


def PtPerpLine3D(pt, pt0, pt1):
    p, a, b = _vec(pt), _vec(pt0), _vec(pt1)
    d = [b[i] - a[i] for i in range(3)]
    dd = sum(c * c for c in d)
    k = sum((p[i] - a[i]) * d[i] for i in range(3)) / dd if dd else 0.0
    return _Vec(*[a[i] + d[i] * k for i in range(3)])


def PtOnLine(pt, begPt, endPt, tolerance):
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    q = PtPerpLine(p, a, b)
    if _math.hypot(p[0] - q[0], p[1] - q[1]) > float(tolerance):
        return False
    t = float(tolerance)
    return min(a[0], b[0]) - t <= q[0] <= max(a[0], b[0]) + t and min(a[1], b[1]) - t <= q[1] <= max(a[1], b[1]) + t


def PtPerpCircle(pt, cenPt, radius):
    p, c = _vec(pt), _vec(cenPt)
    dx, dy = p[0] - c[0], p[1] - c[1]
    n = _math.hypot(dx, dy) or 1.0
    r = float(radius)
    return _Vec(c[0] + dx / n * r, c[1] + dy / n * r, 0.0)


def PtOnArc(pt, cenPt, radius, startAng, sweepAng, tolerance):
    p, c = _vec(pt), _vec(cenPt)
    if abs(_math.hypot(p[0] - c[0], p[1] - c[1]) - float(radius)) > float(tolerance):
        return False
    sweep = float(sweepAng)
    if abs(sweep) >= 360:
        return True
    a = (_math.degrees(_math.atan2(p[1] - c[1], p[0] - c[0])) - float(startAng)) % 360.0
    return a <= sweep if sweep >= 0 else (360.0 - a) <= -sweep or a == 0


def ThreePtCenter(pt1, pt2, pt3):
    a, b, c = _vec(pt1), _vec(pt2), _vec(pt3)
    d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    if not d:
        return _Vec(0.0, 0.0, 0.0)
    s = [p[0] * p[0] + p[1] * p[1] for p in (a, b, c)]
    x = (s[0] * (b[1] - c[1]) + s[1] * (c[1] - a[1]) + s[2] * (a[1] - b[1])) / d
    y = (s[0] * (c[0] - b[0]) + s[1] * (a[0] - c[0]) + s[2] * (b[0] - a[0])) / d
    return _Vec(x, y, 0.0)


def RelativeCoords(pt, begPt, endPt):
    """pt in the frame with its origin at begPt and its x axis toward endPt."""
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    ang = _math.atan2(b[1] - a[1], b[0] - a[0])
    dx, dy = p[0] - a[0], p[1] - a[1]
    c, s = _math.cos(ang), _math.sin(ang)
    return _Vec(dx * c + dy * s, -dx * s + dy * c)


def LineLineIntersection(l1start, l1end, l2start, l2end):
    """(parallel, the point on both segments, the point where the lines cross)."""
    a, b, c, d = _vec(l1start), _vec(l1end), _vec(l2start), _vec(l2end)
    r = (b[0] - a[0], b[1] - a[1])
    s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12:
        return (True, False, _Vec(0.0, 0.0))
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    eps = 1e-9
    return (False, -eps <= t <= 1 + eps and -eps <= u <= 1 + eps, _Vec(a[0] + r[0] * t, a[1] + r[1] * t))


def LineCircleIntersect(begPt, endPt, cenPt, radius):
    """Where the line through the two points meets the circle: (whether it does, the points)."""
    a, b, c = _vec(begPt), _vec(endPt), _vec(cenPt)
    d = (b[0] - a[0], b[1] - a[1])
    f = (a[0] - c[0], a[1] - c[1])
    A = d[0] * d[0] + d[1] * d[1]
    B = 2 * (f[0] * d[0] + f[1] * d[1])
    C = f[0] * f[0] + f[1] * f[1] - float(radius) ** 2
    disc = B * B - 4 * A * C
    if not A or disc < 0:
        return (False, _Vec(0.0, 0.0, 0.0), _Vec(0.0, 0.0, 0.0))
    q = _math.sqrt(disc)
    t1, t2 = (-B - q) / (2 * A), (-B + q) / (2 * A)
    return (True, _Vec(a[0] + d[0] * t1, a[1] + d[1] * t1, 0.0), _Vec(a[0] + d[0] * t2, a[1] + d[1] * t2, 0.0))


def CircleCircleInters(cenPt1, cenPt2, radius1, radius2):
    a, b = _vec(cenPt1), _vec(cenPt2)
    r1, r2 = float(radius1), float(radius2)
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = _math.hypot(dx, dy)
    if not d or d > r1 + r2 or d < abs(r1 - r2):
        return (False, _Vec(0.0, 0.0, 0.0), _Vec(0.0, 0.0, 0.0))
    k = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    hgt = _math.sqrt(max(r1 * r1 - k * k, 0.0))
    mx, my = a[0] + dx * k / d, a[1] + dy * k / d
    return (True, _Vec(mx + dy * hgt / d, my - dx * hgt / d, 0.0), _Vec(mx - dy * hgt / d, my + dx * hgt / d, 0.0))


def _outline(h):
    """A polygon's, polyline's or rectangle's corners in the drawing's units (a polyline's arcs as their corners)."""
    return [_pt_out(v) for v in _verts(h)]


def PtInPoly(p, h):
    x, y, _ = _vec(p)
    pts = _outline(h)
    inside = False
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        if PtOnLine((x, y), (x0, y0), (x1, y1), 1e-9):
            return True
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def Centroid(h):
    try:
        pts = _outline(h)
    except (TypeError, ValueError):
        return (False, 0.0, 0.0)
    a = cx = cy = 0.0
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if not a:
        return (False, 0.0, 0.0)
    return (True, cx / (3 * a), cy / (3 * a))


def _takes(spec):
    """Lets a call's POINT arguments (p in spec) come as a point or, as Vectorscript may pass them, as x and y."""
    def wrap(fn):
        def call(*args):
            out, i = [], 0
            for c in spec:
                if i >= len(args):
                    break
                a = args[i]
                if c == "p" and not isinstance(a, (tuple, list)) and not hasattr(a, "v_x") and i + 1 < len(args):
                    out.append((float(a), float(args[i + 1])))
                    i += 2
                else:
                    out.append(a)
                    i += 1
            return fn(*out)
        call.__name__ = fn.__name__
        call.__doc__ = fn.__doc__
        return call
    return wrap


for _n, _spec in (("EqPt", "ppr"), ("EqPt2D", "ppr"), ("EqualPt", "pp"), ("EqualRect", "pppp"), ("PtInRect", "ppp"),
                  ("UnionRect", "pppp"), ("PtPerpLine", "ppp"), ("PtOnLine", "pppr"), ("PtPerpCircle", "ppr"),
                  ("PtOnArc", "pprrrr"), ("ThreePtCenter", "ppp"), ("RelativeCoords", "ppp"),
                  ("LineLineIntersection", "pppp"), ("LineCircleIntersect", "pppr"), ("CircleCircleInters", "pprr"),
                  ("PtInPoly", "ph")):
    globals()[_n] = _takes(_spec)(globals()[_n])
del _n, _spec

# ---- classes, layers and the attributes new objects take (Vectorworks' Classes, Layers, Object and Document Attributes calls) ----

_VIS_NUM = {"visible": 0, "hidden": -1, "grayed": 2}
# Layer Options and Class Options as Vectorworks numbers them
_MODES = {"active-only": 1, "gray-others": 2, "show-others": 3, "show-snap-others": 4, "modify-others": 5, "gray-snap-others": 6}


def _mode_of(n):
    for k, v in _MODES.items():
        if v == int(n):
            return k
    raise ValueError("options go from 1 (Active Only) to 6 (Gray/Snap Others), not %r" % n)


def _class_rec(name):
    c = _S.classes.get(str(name))
    if c is None:
        raise ValueError("the drawing has no class named %r" % str(name))
    return c


def _cl_attr(name, key):
    a = _class_rec(name).get("attrs")
    return a.get(key, 0) if a else 0


def _set_cl(name, attrs):
    c = _class_rec(name)
    if c.get("attrs") is None:
        raise ValueError("class %r keeps no attributes Rodeo can change" % c["name"])
    c["attrs"].update(attrs)
    _S.ops.append(["classattrs", c["name"], attrs])


def GetCVis(className):
    c = _S.classes.get(str(className))
    return _VIS_NUM.get(c["vis"], 0) if c else 0


def RenameClass(className, newName):
    c = _class_rec(className)
    old, new = c["name"], str(newName)
    if new == old:
        return
    if old == "None":
        raise ValueError("the None class keeps its name")
    if not new or new in _S.classes:
        raise ValueError("there's already a class named %r" % new)
    _S.ops.append(["renameclass", old, new])
    c["name"] = new
    del _S.classes[old]
    _S.classes[new] = c
    _S.class_names[_S.class_names.index(old)] = new
    for o in _S.objs.values():
        if o.get("cls") == old:
            o["cls"] = new
    if _S.active_class == old:
        _S.active_class = new


def DelClass(className):
    name = _class_rec(className)["name"]
    if name == "None":
        raise ValueError("the None class can't be deleted")
    _S.ops.append(["delclass", name])
    del _S.classes[name]
    _S.class_names.remove(name)
    for o in _S.objs.values():
        if o.get("cls") == name:
            o["cls"] = "None"
    if _S.active_class == name:
        _S.active_class = "None"
        _S.class_changed = True


def GetClFPat(className):
    return _cl_attr(className, "fillPattern")


def SetClFPat(className, pattern):
    _set_cl(className, {"fillPattern": int(pattern)})


def GetClFillFore(className):
    return _rgb16(_cl_attr(className, "fillFore"))


def GetClFillBack(className):
    return _rgb16(_cl_attr(className, "fillBack"))


def GetClPenFore(className):
    return _rgb16(_cl_attr(className, "penFore"))


def GetClPenBack(className):
    return _rgb16(_cl_attr(className, "penBack"))


def SetClFillFore(className, *color):
    _set_cl(className, {"fillFore": _index_of(color)})


def SetClFillBack(className, *color):
    _set_cl(className, {"fillBack": _index_of(color)})


def SetClPenFore(className, *color):
    _set_cl(className, {"penFore": _index_of(color)})


def SetClPenBack(className, *color):
    _set_cl(className, {"penBack": _index_of(color)})


# Rodeo keeps one line style number, as the file does: 0 none, 2 solid, a negative one a dash style
def GetClLS(className):
    return _cl_attr(className, "lineStyle")


def SetClLS(className, lineStyle):
    _set_cl(className, {"lineStyle": int(lineStyle)})


GetClLSN = GetClLS
SetClLSN = SetClLS


def GetClLW(className):
    return _cl_attr(className, "lineWeight")


def SetClLW(className, lineWeight):
    _set_cl(className, {"lineWeight": int(lineWeight)})


def GetClOpacity(className):
    return _cl_attr(className, "fillOpacity")


def SetClOpacity(className, opacity):
    v = max(0, min(100, int(opacity)))
    _set_cl(className, {"fillOpacity": v, "penOpacity": v})


def GetClOpacityN(className):
    return (_cl_attr(className, "fillOpacity"), _cl_attr(className, "penOpacity"))


def SetCLOpacityN(className, penOpacity, fillOpacity):
    _set_cl(className, {"fillOpacity": max(0, min(100, int(fillOpacity))), "penOpacity": max(0, min(100, int(penOpacity)))})


def GetClTextStyleRef(className):
    return _class_rec(className).get("textStyle", 0)


def SetClTextStyleRef(className, textStyleRef):
    c = _class_rec(className)
    c["textStyle"] = int(textStyleRef)
    _S.ops.append(["classtextstyle", c["name"], int(textStyleRef)])


def GetClassOptions():
    return _MODES.get(_S.class_mode, 5)


def SetClassOptions(classOpts):
    _S.class_mode = _mode_of(classOpts)


def GetLayerOptions():
    return _MODES.get(_S.layer_mode, 5)


def SetLayerOptions(layerOpts):
    _S.layer_mode = _mode_of(layerOpts)


def NumLayers():
    return len(_S.layers)


def _act_layer():
    l = _S.layer_by_id.get(_S.active_layer)
    if l is None:
        raise ValueError("the drawing has no active layer")
    return l


def GetLVis(h):
    return _VIS_NUM.get(_layer(h)["vis"], 0)


def _layer_vis(vis):
    l = _act_layer()
    l["vis"] = vis
    _S.ops.append(["layervis", l["id"], vis])


def ShowLayer():
    _layer_vis("visible")


def HideLayer():
    _layer_vis("hidden")


def GrayLayer():
    _layer_vis("grayed")


def GetLScale(h):
    return _layer(h)["scale"] or 1


def SetLScale(h, scale):
    l = _layer(h)
    v = float(scale)
    if v <= 0:
        raise ValueError("a layer's scale is more than 0, not %r" % scale)
    l["scale"] = v
    _S.ops.append(["layerscale", l["id"], v])


def SetScale(actualSize):
    SetLScale(ActLayer(), actualSize)


def _design(l):
    if l["kind"] != "design":
        raise TypeError("layer %r is a sheet layer, which has no elevation" % l["name"])
    return l


def _set_elev(l, mm):
    _design(l)["elev"] = mm
    _S.ops.append(["layerelev", l["id"], mm])


# Rodeo keeps a design layer's elevation, not its thickness, which reads 0
def GetLayerElevation(h):
    # the base elevation in the drawing's units (kept in millimetres); the thickness is 0 (Rodeo keeps only the base)
    return (_un(float(_design(_layer(h)).get("elev") or 0)), 0.0)


def SetLayerElevation(h, baseElev, thickness):
    _set_elev(_layer(h), _mm(baseElev))


def GetZVals():
    return (_un(float(_design(_act_layer()).get("elev") or 0)), 0.0)


def SetZVals(zDistance, deltaZDistance):
    _set_elev(_act_layer(), _mm(zDistance))


def CreateLayer(layerName, layerType):
    s = _S
    name = str(layerName)
    if any(l["name"] == name for l in s.layers):
        raise ValueError("there's already a layer named %r" % name)
    kind = "sheet" if int(layerType) == 2 else "design"
    scale = 1 if kind == "sheet" else (s.layer_by_id[s.active_layer]["scale"] if s.active_layer in s.layer_by_id else 1)
    s.seq += 1
    tmp = "layer:%d" % s.seq
    l = {"id": tmp, "name": name, "kind": kind, "scale": scale, "vis": "visible", "elev": 0.0}
    s.layers.append(l)
    s.layer_by_id[tmp] = l
    s.kids[tmp] = []
    s.ops.append(["layer", tmp, name, kind, scale])
    return Handle(tmp)


def NumSelectedObjects():
    return sum(1 for o in _S.objs.values() if o["sel"])


def NumColors():
    return max([p[0] for p in _S.palette] or [0])


# an object's line style, opacity, and what it takes from its class
def GetLS(h):
    return _attr(h, "lineStyle")


def SetLS(h, lineStyle):
    _set_attrs(h, {"lineStyle": int(lineStyle)})


GetLSN = GetLS
SetLSN = SetLS


def GetOpacityN(h):
    a = _obj(h).get("attrs")
    if a is None:
        return (False, 0, 0)
    return (True, a.get("penOpacity", 100), a.get("fillOpacity", 100))


def _is_by_class(h, group):
    return group in (_obj(h).get("byClass") or [])


def IsFPatByClass(h):
    return _is_by_class(h, "fill")


def IsFillColorByClass(h):
    return _is_by_class(h, "fill")


def IsLSByClass(h):
    return _is_by_class(h, "lineStyle")


def IsLWByClass(h):
    return _is_by_class(h, "lineWeight")


def IsPenColorByClass(h):
    return _is_by_class(h, "penColor")


def GetOpacityByClass(h):
    return _is_by_class(h, "opacity")


def GetOpacityByClassN(h):
    b = _is_by_class(h, "opacity")
    return (b, b)


# Rodeo keeps an object's pen and fill opacity by class together
def SetOpacityByClassN(h, inIsPenOpacityByClass, inIsFillOpacityByClass):
    _by_class(h, "opacity", bool(inIsPenOpacityByClass) or bool(inIsFillOpacityByClass))


# the attributes new objects take: the script's, the Attributes palette's, or the drawing's
def _new_attr(key):
    for a in (_S.attrs, _S.new_attrs, _S.template_attrs):
        if key in a:
            return a[key]
    return 0


def FFillPat():
    return _new_attr("fillPattern")


def FPenPat():
    return _new_attr("lineStyle")


FPenPatN = FPenPat


def PenPatN(patNumber):
    PenPat(patNumber)


def FPenSize():
    return _new_attr("lineWeight")


def FFillFore():
    return _rgb16(_new_attr("fillFore"))


def FFillBack():
    return _rgb16(_new_attr("fillBack"))


def FPenFore():
    return _rgb16(_new_attr("penFore"))


def FPenBack():
    return _rgb16(_new_attr("penBack"))


def GetDefaultOpacity():
    return _new_attr("fillOpacity")


def GetDefaultOpacityN():
    return (_new_attr("penOpacity"), _new_attr("fillOpacity"))


def OpacityN(fillOpacity, penOpacity):
    SetDefaultOpacityN(fillOpacity, penOpacity)


# new objects never take their attributes from the class in Rodeo
def FFPatByClass():
    return False


FFillColorByClass = FLSByClass = FLWByClass = FPenColorByClass = FMarkerByClass = FFPatByClass



# ---- text objects (Vectorworks' Objects - Text calls) ----
# Rodeo styles a text as a whole: a call that takes a position or a run of characters reads or sets all of it.
# A restyled text keeps its origin, where its justification puts it, and the text shifts round it, except
# with SetTextJustN and SetTextVertAlignN, which keep the text where it is

_MM_PER_PT = 25.4 / 72


def _text_of(h):
    o = _obj(h, "a text object")
    g = o.get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("expected a text object, got %r" % h)
    return o, g


def _pt_mm(o):
    """A text's points in mm of the drawing: its point size times the layer scale."""
    return _MM_PER_PT * (_S.layer_by_id.get(o["layer"], {}).get("scale") or 1)


def _text_style(h, style, origin="origin"):
    o, g = _text_of(h)
    _S.ops.append(["textstyle", [o["id"]], style, origin])
    return o, g


def _face(bits):
    b = int(bits)
    return {"bold": bool(b & 1), "italic": bool(b & 2), "underline": bool(b & 4)}


def GetTextSize(TextHd, Position=0):
    o, g = _text_of(TextHd)
    return round(float(g.get("size") or 0) / _pt_mm(o), 3)


def SetTextSize(objectHd, Start, Count, Size):
    o, g = _text_of(objectHd)
    if float(Size) <= 0:
        raise ValueError("a text size is more than 0, not %r" % Size)
    g["size"] = float(Size) * _pt_mm(o)
    _text_style(objectHd, {"size": g["size"]})


def GetTextJust(TextHd):
    return _text_of(TextHd)[1].get("h") or 1


def SetTextJust(TextHd, JustFlag):
    j = int(JustFlag)
    if j not in (1, 2, 3):
        raise ValueError("Rodeo's texts justify 1 (left), 2 (centre) or 3 (right), not %r" % JustFlag)
    _text_style(TextHd, {"hAlign": j})[1]["h"] = j


def SetTextJustN(TextHd, JustFlag):
    j = int(JustFlag)
    if j not in (1, 2, 3):
        raise ValueError("Rodeo's texts justify 1 (left), 2 (centre) or 3 (right), not %r" % JustFlag)
    _text_style(TextHd, {"hAlign": j}, None)[1]["h"] = j


def GetTextVerticalAlign(TextHd):
    return _text_of(TextHd)[1].get("v") or 1


def SetTextVerticalAlign(TextHd, verticalAlignment):
    v = int(verticalAlignment)
    if not 1 <= v <= 5:
        raise ValueError("a vertical alignment goes from 1 (top) to 5 (bottom), not %r" % verticalAlignment)
    _text_style(TextHd, {"vAlign": v})[1]["v"] = v


def SetTextVertAlignN(TextHd, verticalAlignment):
    v = int(verticalAlignment)
    if not 1 <= v <= 5:
        raise ValueError("a vertical alignment goes from 1 (top) to 5 (bottom), not %r" % verticalAlignment)
    _text_style(TextHd, {"vAlign": v}, None)[1]["v"] = v


def GetFontID(fontName):
    name = str(fontName)
    for i, f in enumerate(_S.fonts):
        if f.lower() == name.lower():
            return i
    _S.fonts.append(name)
    return len(_S.fonts) - 1


def GetFontName(fontID):
    i = int(fontID)
    return _S.fonts[i] if 0 <= i < len(_S.fonts) else ""


def GetFontListSize():
    return len(_S.fonts)


def GetTextFont(objectHd, Position=0):
    name = _text_of(objectHd)[1].get("font")
    return GetFontID(name) if name else -1


def SetTextFont(objectHd, Start, Count, FontNum):
    name = GetFontName(FontNum)
    if not name:
        raise ValueError("no font has the number %r: GetFontID gives a font's" % FontNum)
    _text_style(objectHd, {"font": name})[1]["font"] = name


def GetTextStyle(TextHd, Position=0):
    g = _text_of(TextHd)[1]
    return (1 if g.get("bold") else 0) | (2 if g.get("italic") else 0) | (4 if g.get("underline") else 0)


def SetTextStyle(objectHd, Start, Count, Style):
    face = _face(Style)
    _text_style(objectHd, face)[1].update(face)


def GetTextOrientation(theText):
    g = _text_of(theText)[1]
    at = g.get("at") or [0, 0]
    return ((_un(at[0]), _un(at[1])), round(float(g.get("angle") or 0), 9), False)


def SetTextOrientation(theText, *args):
    v = _flat(args)
    if len(v) != 4:
        raise TypeError("vs.SetTextOrientation takes the text, its origin, its angle and whether it's mirrored")
    x, y, angle, mirrored = float(v[0]), float(v[1]), float(v[2]), v[3]
    if mirrored:
        raise ValueError("Rodeo doesn't mirror texts")
    at = [_mm(x), _mm(y)]
    g = _text_style(theText, {"angle": angle}, at)[1]
    g["angle"] = angle
    g["at"] = at


def GetTextStyleRef(objectId):
    return _text_of(objectId)[1].get("tstyle") or 0


def GetTextStyleRefN(objectId, position=0):
    return GetTextStyleRef(objectId)


def SetTextStyleRef(objectId, textStyleRef):
    _text_style(objectId, {"textStyle": int(textStyleRef)})[1]["tstyle"] = int(textStyleRef)


def SetTextStyleRefN(objectId, start, count, textStyleRef):
    SetTextStyleRef(objectId, textStyleRef)
    return True


# a text that follows its class's text style
def IsTextStyleByClassN(objectId, position=0):
    return GetTextStyleRef(objectId) == -2


def SetTextStyleByClassN(objectId, start=0, count=0):
    SetTextStyleRef(objectId, -2)
    return True


def TextFont(fontID):
    name = GetFontName(fontID)
    if not name:
        raise ValueError("no font has the number %r: GetFontID gives a font's" % fontID)
    _S.text_font = name


def TextFace(s):
    _S.text_face = int(s)


def TextRotate(Rotation):
    _S.text_angle = float(Rotation)



# ---- changing a shape by handle, and the selection (Vectorworks' Objects - Polys, Objects - 2D, General Edit calls) ----

def _poly_of(h, what):
    o = _obj(h, "a polygon or polyline")
    g = o.get("shape") or {}
    if g.get("kind") not in ("polygon", "polyline"):
        raise TypeError("vs.%s takes a polygon or polyline" % what)
    verts = [list(v) for v in g["verts"]] if g.get("verts") else [list(p) + ["corner", 0.0] for p in g["pts"]]
    return o, g, verts


def _put_poly(o, g, verts, closed, what):
    """A polygon or polyline's new vertices (x, y in mm, kind, radius in mm), in the copy and in the drawing."""
    if len(verts) < 2:
        raise ValueError("vs.%s would leave fewer than two vertices" % what)
    if g["kind"] == "polygon":
        if any(v[2] != "corner" for v in verts):
            raise TypeError("vs.%s: a polygon's vertices are corners; Rodeo can't make it a polyline here" % what)
        shape = {"kind": "polygon", "points": [_pt(v) for v in verts], "closed": closed}
        g.pop("verts", None)
    else:
        shape = {"kind": "polyline", "points": [_pt(v) for v in verts], "closed": closed,
                 "vertices": [v[2] for v in verts], "radii": [v[3] for v in verts]}
        g["verts"] = verts
    g["pts"] = [v[:2] for v in verts]
    g["closed"] = closed
    o["bbox"] = _shape_box(g)
    _S.ops.append(["geom", o["id"], shape])


def _vertex_at(verts, n, what):
    i = int(n) - 1
    if not 0 <= i < len(verts):
        raise IndexError("vs.%s: there's no vertex %r (1 to %d)" % (what, n, len(verts)))
    return i


def SetPolyPt(objectHd, index, *p):
    o, g, verts = _poly_of(objectHd, "SetPolyPt")
    x, y = _nums(p, 2, "SetPolyPt")
    i = _vertex_at(verts, index, "SetPolyPt")
    verts[i][0], verts[i][1] = _mm(x), _mm(y)
    _put_poly(o, g, verts, bool(g.get("closed")), "SetPolyPt")


def SetPolylineVertex(obj, vertexNum, *args):
    v = _flat(args)
    if len(v) < 4:
        raise TypeError("vs.SetPolylineVertex takes the vertex's point, type and radius")
    o, g, verts = _poly_of(obj, "SetPolylineVertex")
    i = _vertex_at(verts, vertexNum, "SetPolylineVertex")
    verts[i] = [_mm(v[0]), _mm(v[1]), _VERTEX_KIND.get(int(v[2]), "corner"), abs(_mm(v[3]))]
    _put_poly(o, g, verts, bool(g.get("closed")), "SetPolylineVertex")


def InsertVertex(objectHandle, x, y, beforeVertexNum, vertexType=0, arcRadius=0):
    o, g, verts = _poly_of(objectHandle, "InsertVertex")
    i = max(0, min(len(verts), int(beforeVertexNum) - 1))
    verts.insert(i, [_mm(x), _mm(y), _VERTEX_KIND.get(int(vertexType), "corner"), abs(_mm(arcRadius))])
    _put_poly(o, g, verts, bool(g.get("closed")), "InsertVertex")


def DelVertex(objectHd, vertexNum):
    o, g, verts = _poly_of(objectHd, "DelVertex")
    verts.pop(_vertex_at(verts, vertexNum, "DelVertex"))
    _put_poly(o, g, verts, bool(g.get("closed")), "DelVertex")


def IsPolyClosed(polyHandle):
    return bool(_poly_of(polyHandle, "IsPolyClosed")[1].get("closed"))


def SetPolyClosed(polyHandle, isClosed):
    o, g, verts = _poly_of(polyHandle, "SetPolyClosed")
    _put_poly(o, g, verts, bool(isClosed), "SetPolyClosed")


def Add2DVertex(*args):
    v = _flat(args)
    if len(v) < 3:
        raise TypeError("vs.Add2DVertex takes a point, a vertex type and a radius")
    _vertex([v[0], v[1], v[3] if len(v) > 3 else 0], _VERTEX_KIND.get(int(v[2]), "corner"), "Add2DVertex")


def _set_seg(h, i, p, what):
    o = _obj(h, "a line")
    g = o.get("shape") or {}
    if g.get("kind") != "line":
        raise TypeError("vs.%s takes a line" % what)
    x, y = _nums(p, 2, what)
    g["pts"][i] = [_mm(x), _mm(y)]
    a, b = g["pts"]
    o["bbox"] = _shape_box(g)
    _S.ops.append(["geom", o["id"], {"kind": "line", "a": _pt(a), "b": _pt(b)}])


def SetSegPt1(h, *p):
    _set_seg(h, 0, p, "SetSegPt1")


def SetSegPt2(h, *p):
    _set_seg(h, 1, p, "SetSegPt2")


def _arc_of(h, what):
    o = _obj(h, "an arc")
    g = o.get("shape") or {}
    if g.get("kind") != "arc" or g.get("center") is None:
        raise TypeError("vs.%s takes an arc" % what)
    return o, g


def GetArc(h):
    g = _arc_of(h, "GetArc")[1]
    return (float(g.get("start") or 0), float(g.get("sweep") or 0))


def SetArc(h, startAngle, arcAngle):
    o, g = _arc_of(h, "SetArc")
    g["start"], g["sweep"] = float(startAngle), float(arcAngle)
    shape = {"kind": "arc", "center": _pt(g["center"]), "radius": g["rx"], "startAngle": g["start"], "sweepAngle": g["sweep"]}
    if abs(g["ry"] - g["rx"]) > 1e-9:
        shape["radiusY"] = g["ry"]
    _S.ops.append(["geom", o["id"], shape])


def _rrect_of(h, what):
    o = _obj(h, "a rounded rectangle")
    g = o.get("shape") or {}
    if g.get("kind") != "roundrect" or not g.get("rr"):
        raise TypeError("vs.%s takes a rounded rectangle" % what)
    return o, g


def GetRRDiam(h):
    rx, ry = _rrect_of(h, "GetRRDiam")[1]["rr"]
    return (_un(2 * rx), _un(2 * ry))


def SetRRDiam(h, xDiam, yDiam):
    o, g = _rrect_of(h, "SetRRDiam")
    xs = [p[0] for p in g["pts"]]
    ys = [p[1] for p in g["pts"]]
    if len(set(round(x, 6) for x in xs)) > 2 or len(set(round(y, 6) for y in ys)) > 2:
        raise ValueError("vs.SetRRDiam: Rodeo changes the corners of a rounded rectangle that isn't turned")
    g["rr"] = [abs(_mm(xDiam)) / 2, abs(_mm(yDiam)) / 2]
    _S.ops.append(["geom", o["id"], {"kind": "roundrect", "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys), "rx": g["rr"][0], "ry": g["rr"][1]}])


def HAngle(h):
    g = _obj(h).get("shape") or {}
    k = g.get("kind")
    if k == "line" or (k in ("rect", "roundrect") and len(g.get("pts") or []) >= 2):
        (x0, y0), (x1, y1) = g["pts"][0], g["pts"][1]
        return _math.degrees(_math.atan2(y1 - y0, x1 - x0))
    if k == "text":
        return float(g.get("angle") or 0)
    return 0.0


def _selection_box():
    ids = _selected_top()
    boxes = [b for b in (_box(_S.objs[i]) for i in ids) if b]
    if not boxes:
        return ids, None
    return ids, ((min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2, (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2)


def FlipHor():
    ids, c = _selection_box()
    if c:
        _xform(ids, [-1, 0, 0, 1, 2 * c[0], 0])


def FlipVer():
    ids, c = _selection_box()
    if c:
        _xform(ids, [1, 0, 0, -1, 0, 2 * c[1]])


def Scale(scaleXR, scaleYR):
    sx, sy = float(scaleXR), float(scaleYR)
    if sx == 0 or sy == 0:
        raise ValueError("vs.Scale can't scale to nothing")
    ids, c = _selection_box()
    if c:
        _xform(ids, [sx, 0, 0, sy, c[0] * (1 - sx), c[1] * (1 - sy)])


def RotatePoint(*args):
    x, y, angle = _nums(args, 3, "RotatePoint")
    _xform(_selected_top(), _rotation(_mm(x), _mm(y), angle))


def _arrange_selection(how):
    for i in (_selected_top() if how in ("front", "backward") else list(reversed(_selected_top()))):
        _arrange(Handle(i), how)


def Forward():
    _arrange_selection("forward")


def Backward():
    _arrange_selection("backward")


def MoveFront():
    _arrange_selection("front")


def MoveBack():
    _arrange_selection("back")


def MirrorN(h, dup, *args):
    v = _flat(args)
    return Mirror(h, dup, *v[:4])


def CreateDuplicateObject(objectToDuplicate, containerHandle=None):
    o = _obj(objectToDuplicate)
    if containerHandle is not None and containerHandle._id != _container(o):
        raise ValueError("vs.CreateDuplicateObject: Rodeo duplicates into the object's own layer or group")
    return Handle(_duplicate([o["id"]], 0, 0)[0])



# ---- what objects matching search criteria measure (Vectorworks' Criteria calls) ----
# a sum, an average, or the extreme or last one, each as the function reference gives it; 0 when nothing matches

def _matches(c):
    test = _criteria(c)
    return [o for o in _all_objects() if test(o)]


def _sum_of(c, fn):
    return sum(fn(Handle(o["id"])) for o in _matches(c))


def _boxes(c):
    return [b for b in (_box(o) for o in _matches(c)) if b]


def Area(c):
    return _sum_of(c, HArea)


def Perim(c):
    return _sum_of(c, HPerim)


def Length(c):
    return _sum_of(c, HLength)


AreaN, PerimN, LengthN = Area, Perim, Length


def Width(c):
    return _sum_of(c, HWidth)


def Height(c):
    return _sum_of(c, HHeight)


def XCenter(c):
    return sum(_un((b[0] + b[2]) / 2) for b in _boxes(c))


def YCenter(c):
    return sum(_un((b[1] + b[3]) / 2) for b in _boxes(c))


def XCenterN(c):
    b = _boxes(c)
    return XCenter(c) / len(b) if b else 0.0


def YCenterN(c):
    b = _boxes(c)
    return YCenter(c) / len(b) if b else 0.0


def LeftBound(c):
    b = _boxes(c)
    return _un(b[-1][0]) if b else 0.0


def BotBound(c):
    b = _boxes(c)
    return _un(b[-1][1]) if b else 0.0


def RightBound(c):
    return sum(_un(b[2]) for b in _boxes(c))


def TopBound(c):
    return sum(_un(b[3]) for b in _boxes(c))


def LeftBoundN(c):
    b = _boxes(c)
    return _un(min(x[0] for x in b)) if b else 0.0


def BotBoundN(c):
    b = _boxes(c)
    return _un(min(x[1] for x in b)) if b else 0.0


def RightBoundN(c):
    b = _boxes(c)
    return _un(max(x[2] for x in b)) if b else 0.0


def TopBoundN(c):
    b = _boxes(c)
    return _un(max(x[3] for x in b)) if b else 0.0


def Angle(c):
    total = 0.0
    for o in _matches(c):
        g = o.get("shape") or {}
        if g.get("kind") == "line":
            total += HAngle(Handle(o["id"]))
        elif g.get("kind") == "arc":
            total += float(g.get("sweep") or 0)
    return total


def ObjectType(c):
    m = _matches(c)
    return m[-1]["type"] if m else 0


HAreaN = ObjArea = ObjAreaN = HArea
HPerimN = HPerim


def GetObjectUuid(h):
    """The object's id in the file, which Rodeo keeps as Vectorworks keeps its UUID; "" for one the script made."""
    i = _obj(h)["id"]
    return "" if ":" in i else i


def GetObjectByUuid(UUID):
    u = str(UUID)
    return Handle(u) if u in _S.objs else None


# areas and volumes as text: the drawing's area unit (Rodeo's square feet, or square metres), 2 places
_AREA_MM2 = {"sq ft": 92903.04, "ft²": 92903.04, "sq in": 645.16, "in²": 645.16, "sq m": 1e6, "m²": 1e6, "m2": 1e6,
             "cm²": 100.0, "sq cm": 100.0, "mm²": 1.0, "sq mm": 1.0, "sq km": 1e12, "km²": 1e12}
_VOLUME_MM3 = {"cu ft": 28316846.592, "ft³": 28316846.592, "cu in": 16387.064, "in³": 16387.064, "cu m": 1e9, "m³": 1e9,
               "m3": 1e9, "l": 1e6, "cm³": 1000.0, "mm³": 1.0, "cu yd": 764554857.984, "yd³": 764554857.984}


def _volume_mark():
    return "cu ft" if _S.area_mark == "sq ft" else "m³"


def _unit_text(v, mark, table):
    return ("%.2f" % (float(v) / table[mark])) + " " + mark


def _unit_value(text, mark, table):
    import re
    s = str(text).strip()
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)\s*(.*?)\s*$", s)
    if not m:
        return 0.0
    n = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower()
    return n * table.get(unit, table[mark])


def Area2Str(value):
    return _unit_text(value, _S.area_mark, _AREA_MM2)


def Str2Area(str_):
    return _unit_value(str_, _S.area_mark, _AREA_MM2)


def Volume2Str(value):
    return _unit_text(value, _volume_mark(), _VOLUME_MM3)


def Str2Volume(str_):
    return _unit_value(str_, _volume_mark(), _VOLUME_MM3)



# ---- symbols (Vectorworks' Objects - Symbols calls) ----

def _symbol_index(name):
    name = str(name)
    for i, n in _S.symbols.items():
        if n == name:
            return i
    raise ValueError("the drawing has no symbol named %r (this script expects it to be in the drawing)" % name)


def Symbol(symbolName, *args):
    x, y, angle = _nums(args, 3, "Symbol")
    s = _S
    index = _symbol_index(symbolName)
    at = [_mm(x), _mm(y)]
    s.seq += 1
    tmp = "new:%d" % s.seq
    s.ops.append(["symbol", tmp, s.active_layer, index, at, s.active_class])
    b = s.symbol_boxes.get(index)
    o = {"id": tmp, "type": 15, "layer": s.active_layer, "parent": s.pio, "cls": s.active_class, "name": "", "sel": False,
         "attrs": None, "shape": None, "records": {}, "sym": index, "ins": list(at), "turned": 0.0,
         "bbox": [b[0] + at[0], b[1] + at[1], b[2] + at[0], b[3] + at[1]] if b else None}
    s.objs[tmp] = o
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    if angle:
        _xform([tmp], _rotation(at[0], at[1], angle))
    # Vectorworks makes the symbol it placed the active one
    s.active_symbol = index
    s.symbol_changed = True


def _placed(h, what):
    o = _obj(h, "a symbol or plug-in object")
    if o.get("ins") is None:
        raise TypeError("vs.%s takes a symbol or plug-in object" % what)
    return o


def GetSymLoc(symHd):
    return _pt_out(_placed(symHd, "GetSymLoc")["ins"])


def GetSymRot(symHd):
    return round(float(_placed(symHd, "GetSymRot").get("turned") or 0), 9)


def SymDefNum():
    return len(_S.symbols)


def SetActSymbol(name):
    _S.active_symbol = _symbol_index(name)
    _S.symbol_changed = True


def SymbolToGroup(h, convertAction=0):
    o = _obj(h, "a symbol")
    if o["type"] != 15:
        raise TypeError("vs.SymbolToGroup takes a symbol")
    _S.ops.append(["togroup", o["id"]])
    o["type"] = 11
    o["sym"] = None
    o["ins"] = None
    # as in Vectorworks, LNewObj doesn't give the group
    _S.last_new = None

`;

/** The core alone, for the check of how the parts fit it. */
export const VS_CORE_SOURCE = VS_CORE;

/** The whole module: the core above, then the parts in vs/ (each a family of calls), in order. */
export const VS_SOURCE = [VS_CORE, ...VS_PARTS].join("\n");
