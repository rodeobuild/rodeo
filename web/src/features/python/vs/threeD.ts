// (part of the vs module: see index.ts)

// The 3D family of vs calls: extrudes, multiple extrudes, sweeps, meshes, solids, moves and turns, and
// the views and working plane a script sets. The steps that make and move 3D objects in the drawing are
// in threeDSteps.ts.

export const VS_3D = String.raw`
# ---- 3D: extrudes, multiple extrudes, sweeps, meshes, solids, moves and turns ------------------
# A 3D object a script makes is kept here as the script sees it: a box or points in the frame it was
# drawn in, and a turn and move (3x3 and mm) applied to them. A drawing's own 3D objects are read once
# per run through the Bounds3D and Points3D host answers (threeDSteps.ts) and moved the same way. Each
# change is also a step (xtrd, tomesh, move3d, rot3d...) that threeDSteps.ts applies to the drawing
# in the run's one undo step. Rodeo's readings are in each function's comment.

_I3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]


def _t3_init(state, snap):
    state.t3 = {
        # the Begin...End captures open, each {"kind", "mark" (the op count at its Begin), "x" its values}
        "stack": [],
        # what a 3D object is made of in its own frame: {"box": [x0, y0, z0, x1, y1, z1]} or {"pts": [[x, y, z]...]}
        "local": {},
        # the turn and move of a 3D object: id -> (3x3 rows, [x, y, z]) in mm
        "m": {},
        # the volume and surface area (mm3, mm2) of a solid the script made, where it is known
        "solid": {},
        # the view, projection and working plane the script set (kept as set; Rodeo draws none of them)
        "view": {"angles": [0.0, 0.0, 0.0], "dist": [0.0, 0.0, 0.0], "proj": 0, "render": 0, "matrices": {},
                 "plane": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "plane_n": [(0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0)]},
    }


_INIT_HOOKS.append(_t3_init)


def _t3_tmp():
    _S.seq += 1
    return "new:%d" % _S.seq


def _t3_ident():
    return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]


def _t3_mul(a, b):
    return [[a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] for j in range(3)] for i in range(3)]


def _t3_vec(a, v):
    return [a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2] for i in range(3)]


def _t3_tr(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]


def _t3_turn(axis, deg):
    """The turn by deg about an axis, counter-clockwise seen from the axis's tip (the right-hand rule)."""
    x, y, z = axis
    n = _math.sqrt(x * x + y * y + z * z)
    if n == 0:
        raise ValueError("a turn needs an axis")
    x, y, z = x / n, y / n, z / n
    t = _math.radians(deg)
    c, s, k = _math.cos(t), _math.sin(t), 1 - _math.cos(t)
    return [[k * x * x + c, k * x * y - s * z, k * x * z + s * y],
            [k * x * y + s * z, k * y * y + c, k * y * z - s * x],
            [k * x * z - s * y, k * y * z + s * x, k * z * z + c]]


def _t3_euler(xr, yr, zr):
    """The turns of Set3DRot's three angles (degrees): about x, then y, then z. Rodeo's reading of the order."""
    return _t3_mul(_t3_turn((0, 0, 1), zr), _t3_mul(_t3_turn((0, 1, 0), yr), _t3_turn((1, 0, 0), xr)))


def _t3_angles(a):
    """The x, y, z angles (degrees) _t3_euler turns by to make the turn a."""
    sy = max(-1.0, min(1.0, -a[2][0]))
    yr = _math.asin(sy)
    if abs(sy) < 1 - 1e-9:
        xr = _math.atan2(a[2][1], a[2][2])
        zr = _math.atan2(a[1][0], a[0][0])
    else:
        xr = _math.atan2(-a[1][2], a[1][1])
        zr = 0.0
    return [_math.degrees(xr), _math.degrees(yr), _math.degrees(zr)]


def _t3_axis(a):
    """The axis and angle (degrees) of a turn, or None when it turns nothing."""
    ang = _math.degrees(_math.acos(max(-1.0, min(1.0, (a[0][0] + a[1][1] + a[2][2] - 1) / 2))))
    if ang < 1e-9:
        return None
    x = a[2][1] - a[1][2]
    y = a[0][2] - a[2][0]
    z = a[1][0] - a[0][1]
    n = _math.sqrt(x * x + y * y + z * z)
    if n < 1e-9:
        # a half turn: the axis is the column of (a + 1) with the largest diagonal
        m = [[(a[i][j] + (1.0 if i == j else 0.0)) / 2 for j in range(3)] for i in range(3)]
        k = max(range(3), key=lambda i: m[i][i])
        r = _math.sqrt(m[k][k])
        return [m[i][k] / r for i in range(3)], 180.0
    return [x / n, y / n, z / n], ang


def _t3_cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _t3_frame(u):
    """Two unit vectors square to the unit vector u, for turning shapes about it."""
    a = [1.0, 0.0, 0.0] if abs(u[0]) < 0.9 else [0.0, 1.0, 0.0]
    e1 = _t3_cross(a, u)
    n = _math.sqrt(sum(v * v for v in e1))
    e1 = [v / n for v in e1]
    return e1, _t3_cross(u, e1)


def _t3_bounds(pts):
    return [min(p[k] for p in pts) for k in range(3)] + [max(p[k] for p in pts) for k in range(3)]


def _t3_open(kind, x):
    _S.t3["stack"].append({"kind": kind, "mark": len(_S.ops), "x": x})


def _t3_pop(kind):
    st = _S.t3["stack"]
    if not st or st[-1]["kind"] != kind:
        raise RuntimeError("vs.End%s without vs.Begin%s" % (kind, kind))
    return st.pop()


def _t3_drawn(mark):
    """The 2D and 3D shapes added since a Begin call, as their ids."""
    return [op[1] for op in _S.ops[mark:] if op[0] == "add"]


def _t3_forget(tmp):
    """Takes an object out of the script's copy of the drawing (it was replaced, consumed or deleted)."""
    s = _S
    o = s.objs.pop(tmp, None)
    if o is None:
        return
    kids = s.kids.get(o["parent"] or o["layer"])
    if kids and tmp in kids:
        kids.remove(tmp)
    for g in s.groups:
        while tmp in g:
            g.remove(tmp)


def _t3_forget_tree(tmp):
    """Takes a group and what it holds out of the script's copy of the drawing."""
    for k in list(_S.kids.get(tmp, [])):
        _S.objs.pop(k, None)
    _S.kids.pop(tmp, None)
    _t3_forget(tmp)


def _t3_closed(o):
    g = o.get("shape") or {}
    k = g.get("kind")
    if k in ("rect", "roundrect"):
        return True
    if k in ("polygon", "polyline"):
        return bool(g.get("closed"))
    if k == "arc":
        return abs(g.get("sweep", 0)) >= 360 - 1e-9
    return False


def _t3_profile(o):
    """A 2D shape's outline in plan (mm points) and whether it is closed; None for what isn't a profile."""
    g = o.get("shape") or {}
    k = g.get("kind")
    if k in ("rect", "roundrect", "polygon", "polyline", "line"):
        return [list(p) for p in g["pts"]], bool(g.get("closed")) or k in ("rect", "roundrect")
    if k == "arc":
        cx, cy = g["center"]
        full = abs(g["sweep"]) >= 360 - 1e-9
        n = max(8, int(abs(g["sweep"]) / 5))
        pts = []
        for j in range(n if full else n + 1):
            th = _math.radians(g["start"] + g["sweep"] * j / n)
            pts.append([cx + g["rx"] * _math.cos(th), cy + g["ry"] * _math.sin(th)])
        return pts, full
    return None


def _t3_area(pts):
    """The area and perimeter of a closed outline (mm2, mm)."""
    a = 0.0
    p = 0.0
    for i in range(len(pts)):
        q, r = pts[i], pts[(i + 1) % len(pts)]
        a += q[0] * r[1] - r[0] * q[1]
        p += _math.hypot(r[0] - q[0], r[1] - q[1])
    return abs(a) / 2, p


def _t3_drawn_pts(o):
    """The points of a 3D polygon the script drew with Poly3D or Add3DPt (mm), or None."""
    if not str(o["id"]).startswith("new:"):
        return None
    pts3 = (o.get("shape") or {}).get("pts3")
    return [list(p) for p in pts3] if pts3 else None


def _t3_host_box(i, o=None):
    got = _json.loads(_host("Bounds3D", i))
    if got is None:
        # a plug-in object with no geometry of its own is a point: its insertion point, at z 0
        if o is not None and o.get("type") == 86 and o.get("ins") is not None:
            x, y = o["ins"][0], o["ins"][1]
            return [x, y, 0.0, x, y, 0.0]
        raise ValueError("this object has no shape to measure in 3D")
    return got


def _t3_local(o):
    """What the object is made of in its own frame: a box (mm) or points."""
    st = _S.t3
    i = o["id"]
    loc = st["local"].get(i)
    if loc is None:
        if str(i).startswith("new:"):
            pts = _t3_drawn_pts(o)
            if pts is not None:
                loc = {"pts": pts}
            elif o.get("type") == 86 and o.get("ins") is not None:
                x, y = o["ins"][0], o["ins"][1]
                loc = {"box": [x, y, 0.0, x, y, 0.0]}
            else:
                b = o.get("bbox") or [0.0, 0.0, 0.0, 0.0]
                loc = {"box": [b[0], b[1], 0.0, b[2], b[3], 0.0]}
        else:
            loc = {"box": _t3_host_box(i, o)}
        st["local"][i] = loc
    return loc


def _t3_m(i):
    """The turn (3x3) and move (mm) an object is held with, from the script's own changes."""
    m = _S.t3["m"].get(i)
    return m if m is not None else (_t3_ident(), [0.0, 0.0, 0.0])


def _t3_world(loc, m):
    R, t = m
    if "pts" in loc:
        P = loc["pts"]
    else:
        x0, y0, z0, x1, y1, z1 = loc["box"]
        P = [[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    return [[a + b for a, b in zip(_t3_vec(R, p), t)] for p in P]


def _t3_box(o):
    """The 3D box of an object now, mm: x0, y0, z0, x1, y1, z1."""
    return _t3_bounds(_t3_world(_t3_local(o), _t3_m(o["id"])))


def _t3_put(o, R, t):
    _S.t3["m"][o["id"]] = (R, t)
    b = _t3_box(o)
    o["bbox"] = [b[0], b[1], b[3], b[4]]


def _t3_move(o, d):
    R, t = _t3_m(o["id"])
    _t3_put(o, R, [t[k] + d[k] for k in range(3)])


def _t3_turn_obj(o, A, c):
    """Turns the object by A about the point c (mm): its turn becomes A . R and its move A . (t - c) + c."""
    R, t = _t3_m(o["id"])
    d = [t[k] - c[k] for k in range(3)]
    _t3_put(o, _t3_mul(A, R), [a + b for a, b in zip(_t3_vec(A, d), c)])


def _t3_rotate(o, A, c):
    r = _t3_axis(A)
    if r is not None:
        _S.ops.append(["rot3d", [o["id"]], r[0], r[1], list(c)])
        _t3_turn_obj(o, A, c)


def _t3_entry(tmp, typ, cls, attrs, loc):
    """Registers a 3D object the script made, on the active layer (in the group being built)."""
    s = _S
    o = {"id": tmp, "type": typ, "layer": s.active_layer, "parent": s.pio, "cls": cls, "name": "", "sel": False,
         "attrs": attrs, "shape": None, "records": {}, "sym": None, "bbox": None}
    s.objs[tmp] = o
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.t3["local"][tmp] = loc
    if s.groups:
        s.groups[-1].append(tmp)
    b = _t3_box(o)
    o["bbox"] = [b[0], b[1], b[3], b[4]]
    s.last_new = tmp
    return o


def _t3_attrs(o):
    return o.get("attrs")


def _t3_new_attrs():
    full = dict(_S.new_attrs)
    full.update(_S.attrs)
    return full


def _t3_measure(i, what):
    """The volume and area (mm3, mm2) of a solid by its id: made here (when known) or read from the drawing."""
    if i in _S.t3["solid"]:
        return _S.t3["solid"][i]
    if str(i).startswith("new:"):
        raise NotImplementedError("vs.%s of a solid the script made is available once the run has drawn it, in Rodeo" % what)
    got = _json.loads(_host("Solid3D", i))
    if got is None:
        raise ValueError("vs.%s needs a solid, mesh or extrude" % what)
    _S.t3["solid"][i] = got
    return got


def _t3_mesh_group(tmps, cls, attrs):
    """Groups closed 3D polygons already drawn and makes them one mesh, which replaces them."""
    G = _group(tmps)
    out = _t3_tmp()
    _S.ops.append(["tomesh", out, G])
    _t3_forget_tree(G)
    return out


def _t3_polys_mesh(polys, cls, attrs):
    """A mesh of closed 3D polygons (mm points), in class cls: one per face, grouped and converted."""
    s = _S
    tmps = []
    saved = s.active_class
    s.active_class = cls
    try:
        for pts in polys:
            flat = [c for p in pts for c in p]
            t = _add({"kind": "poly3d", "points": flat, "closed": True}, {"kind": "polygon", "pts": [[p[0], p[1]] for p in pts], "closed": True})
            s.t3["local"][t] = {"pts": [list(p) for p in pts]}
            tmps.append(t)
    finally:
        s.active_class = saved
    if not tmps:
        raise ValueError("there is nothing to make a mesh from")
    out = _t3_mesh_group(tmps, cls, attrs)
    box = _t3_bounds([p for pts in polys for p in pts])
    _t3_entry(out, 40, cls, attrs, {"box": box})
    return out


# ---- beginning and ending 3D shapes -----------------------------------------------------------

def BeginXtrd(startDistance, endDistance):
    """Starts an extrude: the 2D shapes drawn until EndXtrd are its profiles (Rodeo's reading: z is above the active layer)."""
    _t3_open("Xtrd", (_mm(startDistance), _mm(endDistance)))


def EndXtrd():
    """Makes the extrude: its profiles (closed shapes) stand from the lower distance to the upper. Other shapes drawn are removed."""
    s = _S
    top = _t3_pop("Xtrd")
    a, b = top["x"]
    drawn = _t3_drawn(top["mark"])
    profs = []
    others = []
    for t in drawn:
        o = s.objs.get(t)
        if o is not None and _t3_closed(o):
            profs.append(o)
        else:
            others.append(t)
    info = [(o["id"], o["bbox"], o["cls"], _t3_attrs(o), _t3_profile(o)) for o in profs]
    for t in drawn:
        _t3_forget(t)
    if not info:
        if others:
            s.ops.append(["delete", others])
        return
    base = min(a, b)
    height = abs(b - a)
    if height <= 0:
        raise ValueError("vs.EndXtrd needs an end distance apart from the start distance")
    outs = [_t3_tmp() for _ in info]
    s.ops.append(["xtrd", outs, [p[0] for p in info], base, height])
    if others:
        s.ops.append(["delete", others])
    for k, (pid, bb, cls, attrs, prof) in enumerate(info):
        _t3_entry(outs[k], 24, cls, attrs, {"box": [bb[0], bb[1], base, bb[2], bb[3], base + height]})
        area, perim = _t3_area(prof[0])
        s.t3["solid"][outs[k]] = (area * height, 2 * area + perim * height)
    if len(outs) > 1:
        _group(outs)


def BeginMXtrd(startDistance, endDistance):
    """Starts a multiple extrude: the closed shapes drawn until EndMXtrd are its profiles, in drawing order."""
    _t3_open("MXtrd", (_mm(startDistance), _mm(endDistance)))


def EndMXtrd():
    """Makes the multiple extrude of two or more profiles (one object, as Vectorworks makes it)."""
    s = _S
    top = _t3_pop("MXtrd")
    a, b = top["x"]
    drawn = _t3_drawn(top["mark"])
    profs = [s.objs[t] for t in drawn if t in s.objs and _t3_closed(s.objs[t])]
    if len(profs) < 2:
        raise ValueError("vs.EndMXtrd needs two or more closed shapes to make a multiple extrude")
    cls, attrs = profs[0]["cls"], _t3_attrs(profs[0])
    box2 = _t3_bounds([[p[0], p[1], 0.0] for o in profs for p in _t3_profile(o)[0]])
    ids = [o["id"] for o in profs]
    for t in drawn:
        _t3_forget(t)
    base = min(a, b)
    height = abs(b - a)
    if height <= 0:
        raise ValueError("vs.EndMXtrd needs an end distance apart from the start distance")
    out = _t3_tmp()
    s.ops.append(["mxtrd", out, ids, base, height])
    others = [t for t in drawn if t not in ids]
    if others:
        s.ops.append(["delete", others])
    _t3_entry(out, 38, cls, attrs, {"box": [box2[0], box2[1], base, box2[3], box2[4], base + height]})


def BeginSweep(startAngle, arcAngle, incAngle, PitchDistance):
    """Starts a sweep: the 2D shapes drawn are turned about the vertical through the origin (x is the radius, y the height)."""
    _t3_open("Sweep", (float(startAngle), float(arcAngle), float(incAngle), _mm(PitchDistance)))


def EndSweep():
    """Makes the sweep as a mesh: its profiles turned in steps of the increment (Rodeo has no sweep object that turns about the origin)."""
    s = _S
    top = _t3_pop("Sweep")
    start, arc, inc, pitch = top["x"]
    drawn = _t3_drawn(top["mark"])
    profs = []
    for t in drawn:
        o = s.objs.get(t)
        pr = _t3_profile(o) if o is not None else None
        if pr is not None:
            profs.append((pr[0], pr[1], o["cls"]))
    if not profs:
        raise ValueError("vs.EndSweep needs a 2D shape to sweep")
    if not inc > 0:
        raise ValueError("vs.BeginSweep needs an increment above 0")
    for t in drawn:
        _t3_forget(t)
    s.ops.append(["delete", drawn])
    n = max(1, int(_math.ceil(abs(arc) / inc - 1e-9)))
    full = abs(arc) >= 360 - 1e-9

    def at(p, k):
        th = start + arc * k / n
        r = _math.radians(th)
        return [p[0] * _math.cos(r), p[0] * _math.sin(r), p[1] + pitch * (th - start) / 360.0]

    faces = []
    for pts, closed, _c in profs:
        m = len(pts)
        for e in range(m if closed else m - 1):
            a, b = pts[e], pts[(e + 1) % m]
            for k in range(n):
                faces.append([at(a, k), at(b, k), at(b, k + 1), at(a, k + 1)])
        if closed and not full:
            faces.append([at(p, 0) for p in pts])
            faces.append([at(p, n) for p in pts])
    _t3_polys_mesh(faces, profs[0][2], None)


def BeginMesh():
    """Starts a mesh: the 3D polygons drawn until EndMesh are its faces."""
    _t3_open("Mesh", None)


def EndMesh():
    """Makes the mesh of the 3D polygons drawn (Rodeo takes only 3D polygons as faces for now)."""
    s = _S
    top = _t3_pop("Mesh")
    drawn = _t3_drawn(top["mark"])
    if not drawn:
        raise ValueError("vs.EndMesh has no faces: draw 3D polygons after vs.BeginMesh")
    pts = []
    for t in drawn:
        o = s.objs.get(t)
        p = _t3_drawn_pts(o) if o is not None else None
        if p is None:
            raise NotImplementedError("vs.EndMesh takes 3D polygons only, which Rodeo can't mesh yet")
        pts.extend(p)
    cls = s.objs[drawn[0]]["cls"]
    attrs = _t3_attrs(s.objs[drawn[0]])
    out = _t3_mesh_group(drawn, cls, attrs)
    _t3_entry(out, 40, cls, attrs, {"box": _t3_bounds(pts)})


# ---- 3D polygons, loci and solids -------------------------------------------------------------

def Locus3D(*args):
    """A 3D locus at x, y, z (above the active layer)."""
    v = _nums(args, 3, "Locus3D")
    s = _S
    p = [_mm(v[0]), _mm(v[1]), _mm(v[2])]
    tmp = _t3_tmp()
    s.ops.append(["loc3", tmp, s.active_layer, s.active_class, p[0], p[1], p[2]])
    _t3_entry(tmp, 9, s.active_class, _t3_new_attrs(), {"pts": [p]})


def GetLocus3D(h):
    """The x, y, z of a 3D locus the script made (a drawing's own are not read yet)."""
    o = _obj(h, "a 3D locus")
    loc = _S.t3["local"].get(o["id"])
    if not str(o["id"]).startswith("new:") or loc is None or "pts" not in loc:
        raise NotImplementedError("vs.GetLocus3D of a 3D locus in the drawing isn't available in Rodeo yet")
    p = _t3_world(loc, _t3_m(o["id"]))[0]
    return (_un(p[0]), _un(p[1]), _un(p[2]))


def GetPolyPt3D(objectHd, index):
    """The x, y, z of vertex index (from 1) of a 3D polygon or mesh."""
    o = _obj(objectHd, "a 3D polygon or mesh")
    k = int(index) - 1
    if str(o["id"]).startswith("new:"):
        pts = _t3_world(_t3_local(o), _t3_m(o["id"])) if "pts" in _t3_local(o) else None
    else:
        raw = _json.loads(_host("Points3D", o["id"]))
        if raw is None:
            raise ValueError("this object has no vertices to read")
        pts = _t3_world({"pts": raw}, _t3_m(o["id"]))
    if pts is None or k < 0 or k >= len(pts):
        raise IndexError("vs.GetPolyPt3D: no vertex %s" % index)
    p = pts[k]
    return (_un(p[0]), _un(p[1]), _un(p[2]))


def _t3_bool(obj1, obj2, mode, what):
    s = _S
    o1 = _obj(obj1, "a 3D object")
    o2 = _obj(obj2, "a 3D object")
    b1 = _t3_box(o1)
    b2 = _t3_box(o2)
    box = [min(b1[0], b2[0]), min(b1[1], b2[1]), min(b1[2], b2[2]), max(b1[3], b2[3]), max(b1[4], b2[4]), max(b1[5], b2[5])]
    out = _t3_tmp()
    s.ops.append(["solid", out, [o1["id"], o2["id"]], mode])
    cls, attrs = o1["cls"], _t3_attrs(o1)
    _t3_forget(o1["id"])
    _t3_forget(o2["id"])
    _t3_entry(out, 84, cls, attrs, {"box": box})
    return (0, _h(out))


def AddSolid(obj1, obj2):
    """A solid of the two added together (one solid holding both); (0, the solid)."""
    return _t3_bool(obj1, obj2, "add", "AddSolid")


def SubtractSolid(obj1, obj2):
    """A solid of obj2 taken from obj1; (0, the solid)."""
    return _t3_bool(obj1, obj2, "sub", "SubtractSolid")


def IntersectSolid(obj1, obj2):
    """A solid of what obj1 and obj2 share; (0, the solid)."""
    return _t3_bool(obj1, obj2, "int", "IntersectSolid")


def CreateTaperedExtrude(profileH, angle, height):
    """A tapered extrude of a closed shape: its sides lean in by angle degrees over height. Made as a mesh; the profile stays."""
    o = _obj(profileH, "a closed 2D shape")
    pr = _t3_profile(o)
    if pr is None or not pr[1]:
        raise ValueError("vs.CreateTaperedExtrude needs a closed shape")
    h = _mm(height)
    out = _t3_tmp()
    _S.ops.append(["taper", out, o["id"], float(angle), h])
    box = _t3_bounds([[p[0], p[1], 0.0] for p in pr[0]])
    box[2], box[5] = 0.0, h
    _t3_entry(out, 40, o["cls"], _t3_attrs(o), {"box": box})
    return _h(out)


def CreateTaperedExtrd2(profileH, angle, height):
    """The same as CreateTaperedExtrude: Rodeo makes one kind of tapered extrude, a mesh."""
    return CreateTaperedExtrude(profileH, angle, height)


def HExtrude(objectH, bottom, top):
    """An extrude of a 2D object's shape from bottom to top (mm above the layer); the object stays."""
    o = _obj(objectH, "a 2D shape")
    if not o.get("bbox"):
        raise ValueError("vs.HExtrude needs a shape with a plan outline")
    lo, hi = sorted([_mm(bottom), _mm(top)])
    if hi <= lo:
        raise ValueError("vs.HExtrude needs a top apart from the bottom")
    out = _t3_tmp()
    _S.ops.append(["xcopy", out, o["id"], lo, hi - lo])
    b = o["bbox"]
    _t3_entry(out, 24, o["cls"], _t3_attrs(o), {"box": [b[0], b[1], lo, b[2], b[3], hi]})
    return _h(out)


def CreateExtrudeAlongPath(pathHandle, profileHandle):
    """A closed profile swept along a path (in the order vs gives: path, then profile). Made as a mesh; both stay."""
    path = _obj(pathHandle, "a path")
    prof = _obj(profileHandle, "a closed profile")
    if not _t3_closed(prof):
        raise ValueError("vs.CreateExtrudeAlongPath needs a closed profile")
    out = _t3_tmp()
    _S.ops.append(["alongpath", out, prof["id"], path["id"]])
    b1 = _t3_box(path)
    b2 = _t3_box(prof)
    box = [min(b1[0], b2[0]), min(b1[1], b2[1]), min(b1[2], b2[2]), max(b1[3], b2[3]), max(b1[4], b2[4]), max(b1[5], b2[5])]
    _t3_entry(out, 40, prof["cls"], _t3_attrs(prof), {"box": box})
    return _h(out)


def ConvertTo3DPolys(original):
    """The object as 3D polygons: a 2D shape becomes one 3D polygon, a 3D object its faces (grouped when more than one)."""
    o = _obj(original, "an object")
    if o["type"] == 25:
        return _h(o["id"])
    flat = o["type"] in (2, 3, 4, 5, 6, 13, 21)
    out = _t3_tmp()
    box = _t3_box(o)
    cls, attrs = o["cls"], _t3_attrs(o)
    _S.ops.append(["to3d", out, o["id"], 25 if flat else 11])
    _t3_forget(o["id"])
    _t3_entry(out, 25 if flat else 11, cls, attrs, {"box": box})
    return _h(out)


def MeshToGroup(meshObj):
    """A mesh as a group of 3D polygons, one per face."""
    o = _obj(meshObj, "a mesh")
    out = _t3_tmp()
    box = _t3_box(o)
    cls, attrs = o["cls"], _t3_attrs(o)
    _S.ops.append(["to3d", out, o["id"], 11])
    _t3_forget(o["id"])
    _t3_entry(out, 11, cls, attrs, {"box": box})
    return _h(out)


def GroupToMesh(groupObj):
    """A group of 3D polygons as one mesh of its faces."""
    o = _obj(groupObj, "a group of 3D polygons")
    out = _t3_tmp()
    box = _t3_box(o)
    cls, attrs = o["cls"], _t3_attrs(o)
    _S.ops.append(["tomesh", out, o["id"]])
    _t3_forget_tree(o["id"])
    _t3_entry(out, 40, cls, attrs, {"box": box})
    return _h(out)


def CnvrtToGenericSolid(solid):
    """Solids have no history for Rodeo to drop, so the solid is returned as it is."""
    return _h(_obj(solid, "a solid")["id"])


def ObjVolume(solidObject):
    """The volume of a solid, in cubic units."""
    v = _t3_measure(_obj(solidObject, "a solid")["id"], "ObjVolume")
    return v[0] / (_S.U ** 3)


def CalcVolume(solidObject):
    """The volume of a solid, in cubic units (the same as ObjVolume)."""
    v = _t3_measure(_obj(solidObject, "a solid")["id"], "CalcVolume")
    return v[0] / (_S.U ** 3)


def ObjSurfaceArea(solidObject):
    """The surface area of a solid, in square units."""
    v = _t3_measure(_obj(solidObject, "a solid")["id"], "ObjSurfaceArea")
    return v[1] / (_S.U ** 2)


def CalcSurfaceArea(solidObject):
    """The surface area of a solid, in square units (the same as ObjSurfaceArea)."""
    v = _t3_measure(_obj(solidObject, "a solid")["id"], "CalcSurfaceArea")
    return v[1] / (_S.U ** 2)


def ObjSurfAreaInWorldC(solidObject):
    """The surface area of a solid, in square units (the same as ObjSurfaceArea)."""
    v = _t3_measure(_obj(solidObject, "a solid")["id"], "ObjSurfAreaInWorldC")
    return v[1] / (_S.U ** 2)


# ---- making 3D shapes as meshes ---------------------------------------------------------------

def _t3_point(v, what):
    return _nums([v], 3, what)


def CreateSphere(center, radiusDistance):
    """A sphere as a mesh of 12 by 24 faces (Rodeo's tessellation, not a true sphere)."""
    c = [_mm(v) for v in _t3_point(center, "CreateSphere")]
    r = _mm(radiusDistance)
    u = [0.0, 0.0, 1.0]
    e1, e2 = _t3_frame(u)
    polys = _t3_lat_polys(c, r, e1, e2, u, 12, 24, 0.0, _math.pi)
    return _h(_t3_polys_mesh(polys, _S.active_class, None))


def CreateHemisphere(center, top):
    """A hemisphere of the sphere through top, standing on center, as a mesh (the base is a face)."""
    c = [_mm(v) for v in _t3_point(center, "CreateHemisphere")]
    t = [_mm(v) for v in _t3_point(top, "CreateHemisphere")]
    d = [t[k] - c[k] for k in range(3)]
    r = _math.sqrt(sum(x * x for x in d))
    if r <= 0:
        raise ValueError("vs.CreateHemisphere needs a top apart from the centre")
    u = [x / r for x in d]
    e1, e2 = _t3_frame(u)
    polys = _t3_lat_polys(c, r, e1, e2, u, 6, 24, 0.0, _math.pi / 2)
    polys.append([_t3_ring_pt(c, r, e1, e2, u, _math.pi / 2, 2 * _math.pi * j / 24) for j in range(24)])
    return _h(_t3_polys_mesh(polys, _S.active_class, None))


def _t3_ring_pt(c, r, e1, e2, u, th, ph):
    """The point at polar angle th from u and azimuth ph on a sphere of radius r about c."""
    s, k = _math.sin(th), _math.cos(th)
    return [c[i] + r * (s * (_math.cos(ph) * e1[i] + _math.sin(ph) * e2[i]) + k * u[i]) for i in range(3)]


def _t3_lat_polys(c, r, e1, e2, u, nth, nlon, t0, t1):
    def P(th, ph):
        return _t3_ring_pt(c, r, e1, e2, u, th, ph)

    polys = []
    for i in range(nth):
        a = t0 + (t1 - t0) * i / nth
        b = t0 + (t1 - t0) * (i + 1) / nth
        for j in range(nlon):
            p0 = 2 * _math.pi * j / nlon
            p1 = 2 * _math.pi * (j + 1) / nlon
            polys.append([P(a, p0), P(a, p1), P(b, p1), P(b, p0)])
    return polys


def CreateCone(center, tip, radiusDistance):
    """A cone from a base centre to its tip, as a mesh of 24 sides and the base."""
    c = [_mm(v) for v in _t3_point(center, "CreateCone")]
    p = [_mm(v) for v in _t3_point(tip, "CreateCone")]
    r = _mm(radiusDistance)
    d = [p[k] - c[k] for k in range(3)]
    h = _math.sqrt(sum(x * x for x in d))
    if h <= 0 or r <= 0:
        raise ValueError("vs.CreateCone needs a height and a radius above 0")
    u = [x / h for x in d]
    e1, e2 = _t3_frame(u)
    ring = [[c[k] + r * (_math.cos(2 * _math.pi * j / 24) * e1[k] + _math.sin(2 * _math.pi * j / 24) * e2[k]) for k in range(3)] for j in range(24)]
    polys = [[ring[j], ring[(j + 1) % 24], p] for j in range(24)]
    polys.append(ring)
    return _h(_t3_polys_mesh(polys, _S.active_class, None))


# ---- moves and turns --------------------------------------------------------------------------

def Move3D(*args):
    """Moves the most recently made 3D object by x, y, z (mm above the layer)."""
    v = _nums(args, 3, "Move3D")
    if _S.last_new is None:
        raise ValueError("vs.Move3D moves the object made just before it, and there is none")
    o = _obj(_h(_S.last_new), "a 3D object")
    d = [_mm(v[0]), _mm(v[1]), _mm(v[2])]
    _S.ops.append(["move3d", [o["id"]], d[0], d[1], d[2]])
    _t3_move(o, d)


def Move3DObj(h, xDistance, yDistance, zDistance):
    """Moves a 3D object by x, y, z from where it is."""
    o = _obj(h, "a 3D object")
    d = [_mm(xDistance), _mm(yDistance), _mm(zDistance)]
    _S.ops.append(["move3d", [o["id"]], d[0], d[1], d[2]])
    _t3_move(o, d)


def Rotate3D(xAngle, yAngle, zAngle):
    """Turns the most recently made 3D object about its own centre (Rodeo's reading: the centre of its 3D box)."""
    v = _nums((xAngle, yAngle, zAngle), 3, "Rotate3D")
    if _S.last_new is None:
        raise ValueError("vs.Rotate3D turns the object made just before it, and there is none")
    o = _obj(_h(_S.last_new), "a 3D object")
    b = _t3_box(o)
    c = [(b[k] + b[k + 3]) / 2 for k in range(3)]
    _t3_rotate(o, _t3_euler(v[0], v[1], v[2]), c)


def Set3DRot(h, xAngle, yAngle, zAngle, xDistance, yDistance, zDistance):
    """Turns a 3D object by x, y, z degrees (added to its turn) about the point given (mm above the layer)."""
    o = _obj(h, "a 3D object")
    c = [_mm(xDistance), _mm(yDistance), _mm(zDistance)]
    _t3_rotate(o, _t3_euler(xAngle, yAngle, zAngle), c)


def SetRot3D(h, xAngle, yAngle, zAngle, xDistance, yDistance, zDistance):
    """Sets a 3D object's turn to x, y, z degrees about the point given. Only for objects the script made (a drawing's turn isn't read yet)."""
    o = _obj(h, "a 3D object")
    if not str(o["id"]).startswith("new:") and o["id"] not in _S.t3["m"]:
        raise NotImplementedError("vs.SetRot3D of a 3D object in the drawing isn't available in Rodeo yet")
    c = [_mm(xDistance), _mm(yDistance), _mm(zDistance)]
    R, _t = _t3_m(o["id"])
    _t3_rotate(o, _t3_mul(_t3_euler(xAngle, yAngle, zAngle), _t3_tr(R)), c)


def Get3DCntr(h):
    """The centre of a 3D object's box: ((x, y), z)."""
    b = _t3_box(_obj(h, "a 3D object"))
    return ((_un((b[0] + b[3]) / 2), _un((b[1] + b[4]) / 2)), _un((b[2] + b[5]) / 2))


def Get3DInfo(h):
    """The sizes of a 3D object's box, in the order Vectorworks returns them: (delta y, delta x, delta z)."""
    b = _t3_box(_obj(h, "a 3D object"))
    return (_un(b[4] - b[1]), _un(b[3] - b[0]), _un(b[5] - b[2]))


def Get3DOrientation(h):
    """(True, x, y, z, mirrored): a new object's turn in degrees; a drawing's isn't read yet."""
    o = _obj(h, "a 3D object")
    if not str(o["id"]).startswith("new:"):
        raise NotImplementedError("vs.Get3DOrientation of a 3D object in the drawing isn't available in Rodeo yet")
    R, _t = _t3_m(o["id"])
    a = _t3_angles(R)
    return (True, a[0], a[1], a[2], False)


def SetLayerElevationN(h, baseElev, thickness):
    """Sets a design layer's elevation (its base); Rodeo keeps no thickness, so thickness is not kept."""
    _set_elev(_layer(h), _mm(baseElev))


def GetLayerElevationN(h):
    """A design layer's (base, thickness) in units; the thickness is 0 (Rodeo keeps only the base)."""
    return (_un(float(_design(_layer(h)).get("elev") or 0)), 0.0)


def ResetOrientation3D():
    """Vectorworks resets its 3D settings after new 3D objects so they draw; Rodeo draws them as made, so nothing is done."""
    return None


# ---- the view, projection and working plane: kept as the script sets them ---------------------

def GetView():
    """The 3D view's three angles (radians) and the z distance (units): kept as SetView set them."""
    v = _S.t3["view"]
    return (_math.radians(v["angles"][0]), _math.radians(v["angles"][1]), _math.radians(v["angles"][2]), _un(v["dist"][2]))


def SetView(xAngle, yAngle, zAngle, xDistance, yDistance, zDistance):
    """Keeps the 3D view's angles (degrees) and distances; Rodeo's drawing view doesn't change."""
    v = _S.t3["view"]
    v["angles"] = [float(xAngle), float(yAngle), float(zAngle)]
    v["dist"] = [_mm(xDistance), _mm(yDistance), _mm(zDistance)]


def GetViewMatrix(objectHandle):
    """(True, offset, x, y, z) of a layer's or viewport's view matrix: as SetViewMatrix kept it, else none (zeros)."""
    m = _S.t3["view"]["matrices"].get(_obj_or_layer(objectHandle), ((0.0, 0.0, 0.0), 0.0, 0.0, 0.0))
    return (True, m[0], m[1], m[2], m[3])


def SetViewMatrix(objectHandle, offset, rotationXAng, rotationYAng, rotationZAng):
    """Keeps a layer's or viewport's view matrix; nothing is drawn from it."""
    _S.t3["view"]["matrices"][_obj_or_layer(objectHandle)] = (tuple(_flat([offset])), float(rotationXAng), float(rotationYAng), float(rotationZAng))
    return True


def _obj_or_layer(h):
    if _is_layer(h):
        return h._id
    return _obj(h)["id"]


def Projection(proj, rMode, viewDistance, clip1, clip2):
    """Keeps the projection and render mode the script sets (0 orthogonal, 1 perspective...); Rodeo's view doesn't change."""
    _S.t3["view"]["proj"] = int(proj)
    _S.t3["view"]["render"] = int(rMode)


def GetProjection(theyLayer):
    """The projection kept as Projection set it (0, orthogonal, until then)."""
    return _S.t3["view"]["proj"]


def GetWorkingPlane():
    """The working plane's x, y, z and turns as SetWorkingPlane kept them (zeros until then); Rodeo doesn't move the drawing to it."""
    return tuple(_S.t3["view"]["plane"])


def SetWorkingPlane(x, y, z, xRotation, yRotation, zRotation):
    """Keeps the working plane's offset and turns; Rodeo's drawing coordinates are unchanged."""
    _S.t3["view"]["plane"] = [float(x), float(y), float(z), float(xRotation), float(yRotation), float(zRotation)]


def SetWorkingPlaneN(centerPt, normal, uVec):
    """Keeps the working plane by centre, normal and u vector; Rodeo's drawing coordinates are unchanged."""
    _S.t3["view"]["plane_n"] = [tuple(_flat([centerPt])), tuple(_flat([normal])), tuple(_flat([uVec]))]


def GetWorkingPlaneN():
    """The working plane as SetWorkingPlaneN kept it (the ground plane until then)."""
    return _S.t3["view"]["plane_n"]
`;
