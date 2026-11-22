// (part of the vs module: see index.ts)

export const VS_RECORDS = String.raw`# ---- data records, resource lists, symbol definitions, names and plug-in objects (Vectorworks' Database - Record,
# Document List Handling, Object Names, Objects - Symbols and Objects - Custom calls) ----
# A data record is a format (its fields, from the drawing's record formats and the ones NewField makes in
# this run) attached to objects by name. An object's record values sit in its "records" entry, by record
# name then field name, in the script's units, as the snapshot gives them, so the Get calls read what
# the script set. A record handle is "rec:" + the object's id + a separator + the record's name.
# A symbol definition's handle is "sym:" + its name index; a resource's is "res:" + its type code and index.
# Resource lists are lists of the drawing's own resources: a resource on disk isn't read.

_R = None
_FIELD_TYPES = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16)
_NUMBER_TYPES = (1, 3, 5, 6, 7, 8, 10, 14, 15, 16)
_REC_SEP = "\x1e"


class _Records(object):
    def __init__(self, snap):
        # format name -> its fields in order, each {name, type, flag, value}; value is the default
        self.formats = {}
        for f in snap.get("recordFields") or []:
            self.formats[f["name"]] = [{"name": x["name"], "type": int(x["type"]), "flag": 0, "value": x.get("value")} for x in f["fields"]]
        # the drawing's resources of the kinds a list can hold: {type, index, name, folder}
        self.resources = [dict(r) for r in snap.get("resources") or []]
        # the plug-in objects a script can copy, by plug-in name: the drawing's kind id
        self.plugin_kinds = dict((k["name"], k["id"]) for k in snap.get("pluginKinds") or [])
        self.lists = {}
        self.list_seq = 0
        # the warnings a run has given (call, format), so each is given once
        self.warned = set()
        # symbol definitions in library order (the snapshot's order; a symbol made in this run goes last)
        self.sym_order = [s["index"] for s in snap["symbols"]]
        # the symbol being made by BeginSym: its name and the object sequence number it starts after
        self.sym_open = None
        self.sym_seq = 0
        # the objects inside symbol definitions (by id), their definitions' type (GetSymbolType) by index,
        # and which definitions' contents are in the copy at all
        self.def_ids = set()
        self.def_types = {}
        # NameObject's name, given to the next object created
        self.pending_name = None
        # SetRFieldOpt's flags, kept for the run only
        self.field_opts = {}
        # saved settings: the browser's, read at the start, and the ones this run set
        self.saved = dict(snap.get("savedSettings") or {})
        self.saved_set = []


class _Ops(list):
    """The run's steps: a step that would change an object inside a symbol definition is refused here."""

    def append(self, op):
        if len(op) > 1 and _in_definition(op[1]):
            raise ValueError("a script can't change an object inside a symbol definition yet (edit the symbol instance instead)")
        list.append(self, op)


def _in_definition(v):
    if isinstance(v, str):
        return v in _R.def_ids
    if isinstance(v, (list, tuple)):
        return any(isinstance(x, str) and x in _R.def_ids for x in v)
    return False


def _records_init(state, snap):
    global _R
    _R = _Records(snap)
    state.ops = _Ops(state.ops)
    # each symbol definition's contents, as the document lists them: a top-level object's container is
    # "symdef:" + the definition's index (as a layer would be), so the walking calls work on them
    for d in snap.get("symbolObjects") or []:
        box = "symdef:%d" % d["index"]
        _R.def_types[d["index"]] = d.get("type", 0)
        for o in d["objects"]:
            o = dict(o)
            o["sel"] = False
            if not o.get("parent"):
                o["layer"] = box
            state.objs[o["id"]] = o
            _R.def_ids.add(o["id"])
            state.kids.setdefault(o.get("parent") or box, []).append(o["id"])
        state.kids.setdefault(box, [])


def _records_result(state):
    return {"savedSettingsSet": _R.saved_set}


_RESULT_HOOKS.append(_records_result)


_INIT_HOOKS.append(_records_init)


def _rec_typed(ftype, value):
    """A field's value as its step carries it: an integer, a boolean, a number, millimetres for a dimension, else text."""
    if ftype in _NUMBER_TYPES + (9,) and str(value).strip() == "":
        value = 0
    if ftype == 1:
        return int(_num(value))
    if ftype == 2:
        return value if isinstance(value, bool) else str(value).strip().lower() in ("true", "yes", "1")
    if ftype == 9:
        return _mm(_num(value))
    if ftype in _NUMBER_TYPES:
        return _num(value)
    return str(value)


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError("a field takes a number, not %r" % (value,))


def _rec_text(ftype, value):
    """A field's default as the script reads it: a dimension in the drawing's units, the rest as text."""
    if value is None:
        return ""
    if ftype == 9 and isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(_un(float(value)))
    return str(value)


def _rec_handle(oid, name):
    return Handle("rec:" + oid + _REC_SEP + name)


def _rec_of(h):
    """(object id, record name) for a record handle made here, else None."""
    if isinstance(h, Handle) and isinstance(h._id, str) and h._id.startswith("rec:") and _REC_SEP in h._id:
        oid, name = h._id[4:].split(_REC_SEP, 1)
        return oid, name
    return None


def _rec_fields(h, what):
    r = _rec_of(h)
    if r is None:
        raise TypeError("vs.%s takes a handle to a record, got %r" % (what, h))
    return _R.formats.get(r[1]) or []


def _rec_format(name):
    fields = _R.formats.get(name)
    if fields is None:
        raise ValueError("the drawing has no record format named %r" % name)
    return fields


def NewField(recName, fieldName, fieldValue, fType, fFlag):
    rec = str(recName)
    name = str(fieldName)[:20]
    ftype = int(fType)
    if ftype not in _FIELD_TYPES:
        raise NotImplementedError("vs.NewField: field type %d isn't available in Rodeo yet" % ftype)
    fields = _R.formats.setdefault(rec, [])
    # a field the format already has keeps its values: Rodeo doesn't change its type or default here
    if any(f["name"] == name for f in fields):
        return None
    default = _rec_typed(ftype, fieldValue)
    fields.append({"name": name, "type": ftype, "flag": int(fFlag), "value": str(fieldValue)})
    _S.ops.append(["recfield", rec, name, ftype, default, int(fFlag)])
    # objects that already have the record start the new field at its default
    for o in _S.objs.values():
        if rec in (o.get("records") or {}):
            o["records"][rec].setdefault(name, str(fieldValue))
    return None


def _no_format_warning(call, record, outcome):
    # Vectorworks does nothing for a format the drawing lacks: the script is told once per run, on stderr
    key = (call, str(record))
    if key in _R.warned:
        return
    _R.warned.add(key)
    import sys
    print("vs.%s: the drawing has no record format named '%s', so %s" % (call, record, outcome), file=sys.stderr)


def SetRecord(h, record):
    o = _obj(h, "an object")
    rec = str(record)
    if rec not in _R.formats:
        _no_format_warning("SetRecord", rec, "no record was attached")
        return None
    fields = _rec_format(rec)
    if rec in o.setdefault("records", {}):
        return None
    o["records"][rec] = dict((f["name"], _rec_text(f["type"], f["value"])) for f in fields)
    _S.ops.append(["recattach", o["id"], rec])
    return None


def DelRecord(h, name):
    o = _obj(h, "an object")
    rec = str(name)
    if rec in (o.get("records") or {}):
        del o["records"][rec]
        _S.ops.append(["recdetach", o["id"], rec])
    return None


def NumRecords(h):
    return len(_obj(h, "an object").get("records") or {})


def GetRecord(h, cnt):
    o = _obj(h, "an object")
    names = list((o.get("records") or {}).keys())
    i = int(cnt)
    return _rec_handle(o["id"], names[i - 1]) if 1 <= i <= len(names) else None


def GetParametricRecord(h):
    o = _obj(h, "an object")
    name = o.get("parametricRecord")
    return _rec_handle(o["id"], name) if name else None


def NumFields(h):
    return len(_rec_fields(h, "NumFields"))


def GetFldName(h, t):
    fields = _rec_fields(h, "GetFldName")
    i = int(t)
    return fields[i - 1]["name"] if 1 <= i <= len(fields) else ""


def GetFldType(h, t):
    fields = _rec_fields(h, "GetFldType")
    i = int(t)
    return fields[i - 1]["type"] if 1 <= i <= len(fields) else 0


def GetFldFlag(h, t):
    # a format the drawing already has keeps no display style in the script's copy: 0 for those
    fields = _rec_fields(h, "GetFldFlag")
    i = int(t)
    return fields[i - 1]["flag"] if 1 <= i <= len(fields) else 0


_core_SetRField = SetRField


def SetRField(h, record, field, value):
    rec = str(record)
    if rec not in _R.formats:
        if rec not in _S.formats:
            _no_format_warning("SetRField", rec, "nothing was set")
            return None
        # a plug-in's parameters, which the core keeps
        return _core_SetRField(h, record, field, value)
    o = _obj(h, "an object")
    name = str(field)
    spec = next((f for f in _R.formats[rec] if f["name"] == name), None)
    if spec is None:
        raise ValueError("record %r has no field %r" % (rec, name))
    if rec not in (o.get("records") or {}):
        # an object without the record keeps nothing: Vectorworks does nothing, and the script is told once
        key = ("SetRField", rec, "object")
        if key not in _R.warned:
            _R.warned.add(key)
            import sys
            print("vs.SetRField: the object has no record named '%s', so nothing was set (SetRecord attaches one)" % rec, file=sys.stderr)
        return None
    o["records"][rec][name] = str(value)
    _S.ops.append(["recset", o["id"], rec, name, _rec_typed(spec["type"], value)])
    return None


# ---- handles for symbol definitions and resources ------------------------------------------------

def _sym_handle(index):
    return Handle("sym:%d" % index)


def _sym_of(h):
    if isinstance(h, Handle) and isinstance(h._id, str) and h._id.startswith("sym:"):
        return int(h._id[4:])
    return None


def _res_handle(item):
    if item["type"] == 16:
        return _sym_handle(item["index"])
    return Handle("res:%d:%d" % (item["type"], item["index"]))


def _res_item(h):
    """The drawing's resource (a dict) a handle names, else None."""
    if isinstance(h, Handle) and isinstance(h._id, str) and h._id.startswith("res:"):
        t, i = h._id[4:].split(":", 1)
        key = (int(t), int(i))
    else:
        i = _sym_of(h)
        if i is None:
            return None
        key = (16, i)
    return next((r for r in _R.resources if (r["type"], r["index"]) == key), None)


_core_GetTypeN = GetTypeN


def GetTypeN(h):
    if _rec_of(h) is not None:
        return 47
    if _sym_of(h) is not None:
        return 16
    return _core_GetTypeN(h)


GetType = GetTypeN

_core_GetName = GetName


_core_GetParent = GetParent


def GetParent(h):
    # a symbol definition lies in the library, not under any object or layer: it has no parent
    if _sym_of(h) is not None:
        return None
    return _core_GetParent(h)


def GetName(h):
    r = _rec_of(h)
    if r is not None:
        return r[1]
    i = _sym_of(h)
    if i is not None:
        return _S.symbols.get(i, "")
    item = _res_item(h)
    if item is not None:
        return item["name"]
    return _core_GetName(h)


# ---- symbol definitions ----------------------------------------------------------------------------

def FSymDef():
    return _sym_handle(_R.sym_order[0]) if _R.sym_order else None


def NextSymDef(h):
    i = _sym_of(h)
    if i is None or i not in _R.sym_order:
        raise TypeError("vs.NextSymDef takes a handle to a symbol definition, got %r" % (h,))
    k = _R.sym_order.index(i) + 1
    return _sym_handle(_R.sym_order[k]) if k < len(_R.sym_order) else None


def FInSymDef(sdHd):
    i = _sym_of(sdHd)
    if i is None:
        raise TypeError("vs.FInSymDef takes a handle to a symbol definition, got %r" % (sdHd,))
    if i not in _R.def_types:
        raise NotImplementedError("vs.FInSymDef isn't available in Rodeo yet for a symbol with more than 500 objects")
    return _first("symdef:%d" % i)


def BeginFolder():
    # Rodeo can't make symbol folders: the symbols that follow go to the top of the library
    return None


def EndFolder():
    return None


def BeginSym(symbolName):
    if _R.sym_open is not None:
        raise ValueError("vs.BeginSym: a symbol is already being made (EndSym comes first)")
    _R.sym_open = (str(symbolName), _S.seq)


def EndSym():
    if _R.sym_open is None:
        raise ValueError("vs.EndSym: no symbol is being made (BeginSym comes first)")
    name, mark = _R.sym_open
    _R.sym_open = None
    s = _S
    # the objects made since BeginSym are the symbol's contents: they leave the layer for the library
    ids = [i for i in s.objs if i.startswith("new:") and i[4:].isdigit() and int(i[4:]) > mark]
    if not ids:
        raise ValueError("vs.EndSym: the symbol %r has nothing in it" % name)
    _R.sym_seq += 1
    index = -_R.sym_seq
    box = "symdef:%d" % index
    # the shapes stay in the copy as the definition's contents, off the layer
    for i in ids:
        o = s.objs[i]
        _R.def_ids.add(i)
        if not o.get("parent"):
            for lst in s.kids.values():
                if i in lst:
                    lst.remove(i)
            o["layer"] = box
            s.kids.setdefault(box, []).append(i)
    _R.def_types[index] = 0
    s.symbols[index] = name
    s.symbol_boxes[index] = None
    _R.sym_order.append(index)
    _R.resources.append({"type": 16, "index": index, "name": name, "folder": ""})
    s.ops.append(["symdef", index, name, ids])
    s.last_new = None
    return None


_core_Symbol = Symbol


def Symbol(symbolName, *args):
    if _symbol_index(symbolName) >= 0:
        return _core_Symbol(symbolName, *args)
    # a symbol made in this run: placed by its own step, and not made the Symbol tool's choice
    x, y, angle = _nums(args, 3, "Symbol")
    s = _S
    index = _symbol_index(symbolName)
    s.seq += 1
    tmp = "new:%d" % s.seq
    at = [_mm(x), _mm(y)]
    s.ops.append(["symbolat", tmp, s.active_layer, index, at, s.active_class])
    s.objs[tmp] = {"id": tmp, "type": 15, "layer": s.active_layer, "parent": s.pio, "cls": s.active_class, "name": "", "sel": False,
                   "attrs": None, "shape": None, "records": {}, "sym": index, "ins": list(at), "turned": 0.0, "bbox": None}
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    if angle:
        _xform([tmp], _rotation(at[0], at[1], angle))


_core_SetActSymbol = SetActSymbol


def SetActSymbol(name):
    if _symbol_index(name) < 0:
        raise NotImplementedError("vs.SetActSymbol isn't available in Rodeo yet for a symbol made in this run")
    return _core_SetActSymbol(name)


_core_GetSymLoc = GetSymLoc


def GetSymLoc3D(symHd):
    # the instance's own height isn't in the script's copy: its layer's elevation is given instead
    x, y = _core_GetSymLoc(symHd)
    o = _placed(symHd, "GetSymLoc3D")
    layer = _S.layer_by_id.get(o["layer"]) or {}
    return (x, y, _un(float(layer.get("elev") or 0)))


# ---- resource lists (Vectorworks' Document List Handling calls) -------------------------------------

def _list_of(list_id):
    lst = _R.lists.get(int(list_id))
    if lst is None:
        raise ValueError("there is no resource list %r" % (list_id,))
    return lst


def _build_list(rtype, sub):
    t = int(rtype)
    items = [r for r in _R.resources if r["type"] == t]
    # a folder name (in the library's folders) keeps the resources in it or below it
    if sub:
        items = [r for r in items if r["folder"].startswith(str(sub))]
    items.sort(key=lambda r: r["name"].lower())
    _R.list_seq += 1
    _R.lists[_R.list_seq] = {"type": t, "items": items}
    return (_R.list_seq, len(items))


def BuildResourceList(type, folderIndex, subFolderName, *more):
    # folders on disk aren't read: the list holds the drawing's own resources, whatever the folder asked.
    # Scripts also pass a fourth argument, BuildResourceList2's useDefaultContent: it changes nothing here.
    return _build_list(type, subFolderName)


def BuildResourceList2(type, folderIndex, subFolderName, useDefaultContent):
    return _build_list(type, subFolderName)


def BuildResourceListN(type, fullPath):
    raise NotImplementedError("vs.BuildResourceListN isn't available in Rodeo yet (it reads a resource file on disk)")


def ResourceListSize(listID):
    return len(_list_of(listID)["items"])


def GetNameFromResourceList(listID, index):
    items = _list_of(listID)["items"]
    i = int(index)
    return items[i - 1]["name"] if 1 <= i <= len(items) else ""


def GetActualNameFromResourceList(listID, index):
    # a name gets the file's name in brackets only when two files hold one name: Rodeo has one file
    return GetNameFromResourceList(listID, index)


def GetResourceFromList(listID, index):
    items = _list_of(listID)["items"]
    i = int(index)
    return _res_handle(items[i - 1]) if 1 <= i <= len(items) else None


def ImportResourceToCurrentFile(listID, index):
    # every resource a list holds is in the drawing already, so it is returned as it is
    return GetResourceFromList(listID, index)


def AddResourceToList(listID, resource):
    lst = _list_of(listID)
    item = _res_item(resource)
    if item is None or item["type"] != lst["type"]:
        return 0
    lst["items"].append(item)
    return len(lst["items"])


def DeleteResourceFromList(listID, index):
    items = _list_of(listID)["items"]
    i = int(index)
    if 1 <= i <= len(items):
        del items[i - 1]
    return None


# ---- object names (Vectorworks' Object Names calls) ---------------------------------------------------

def _name_table():
    return sorted(set(o.get("name") for o in _S.objs.values() if o.get("name") and o["id"] not in _R.def_ids))


def GetObject(name):
    # an object inside a symbol definition isn't in the drawing: its name doesn't find it
    if not name:
        return None
    for o in _S.objs.values():
        if o.get("name") == name and o["id"] not in _R.def_ids:
            return Handle(o["id"])
    # then a symbol definition with that name: its handle, as Vectorworks gives it
    for i, n in _S.symbols.items():
        if n == name:
            return _sym_handle(i)
    return GetLayerByName(name)


def NameNum():
    return len(_name_table())


def Name2Index(name):
    names = _name_table()
    n = str(name)
    return names.index(n) + 1 if n in names else 0


def Index2Name(index):
    names = _name_table()
    i = int(index)
    return names[i - 1] if 1 <= i <= len(names) else ""


def NameList(index):
    return Index2Name(index)


def DelName(name):
    # the name leaves every object that holds it
    n = str(name)
    for o in list(_S.objs.values()):
        if o.get("name") == n:
            o["name"] = ""
            _S.ops.append(["name", o["id"], ""])
    return None


def NameObject(objName):
    # the name goes to the next object made (through _add, below), as SetName would give it
    _R.pending_name = str(objName)
    return None


_core_add = _add


def _add(shape, copy, extra=None):
    name = _R.pending_name
    if name is not None:
        _R.pending_name = None
        if name and any(o.get("name") == name and o["id"] not in _R.def_ids for o in _S.objs.values()):
            raise ValueError("another object is already named %r" % name)
    tmp = _core_add(shape, copy, extra)
    if name:
        _S.objs[tmp]["name"] = name
        _S.ops.append(["name", tmp, name])
    return tmp


def ActSymDef():
    i = _S.active_symbol
    return _sym_handle(i) if i is not None else None


def ActSymDefN(allowConflictDlg):
    # the active symbol is in this drawing already, so nothing is imported
    return ActSymDef()


def GetSymbolType(objectHandle):
    o = _placed(objectHandle, "GetSymbolType")
    index = o.get("sym")
    if index is None:
        raise TypeError("vs.GetSymbolType takes a symbol instance")
    if index not in _R.def_types:
        raise NotImplementedError("vs.GetSymbolType isn't available in Rodeo yet for a symbol with more than 500 objects")
    return _R.def_types[index]


def SetParent(obj, container):
    o = _obj(obj, "an object")
    if not _is_layer(container):
        raise NotImplementedError("vs.SetParent into a group or a symbol definition isn't available in Rodeo yet (it moves an object to a layer)")
    if o.get("parent"):
        raise NotImplementedError("vs.SetParent can't take an object out of a group in Rodeo yet")
    lid = container._id
    if o["layer"] != lid:
        _S.kids.get(o["layer"], []).remove(o["id"])
        o["layer"] = lid
        _S.kids.setdefault(lid, []).append(o["id"])
        _S.ops.append(["setlayer", o["id"], lid])
    return None


def FInFolder(sfHd):
    # Rodeo has no symbol folders: a folder is always empty here
    return None


def SetRFieldOpt(h, record, field, isEmpty, isDataLinked):
    # the Data Manager's flags: Rodeo doesn't keep them in the drawing, so they hold for this run only
    o = _obj(h, "an object")
    _R.field_opts[(o["id"], str(record), str(field))] = (bool(isEmpty), bool(isDataLinked))
    return None


def GetRFieldOpt(h, record, field):
    o = _obj(h, "an object")
    return _R.field_opts.get((o["id"], str(record), str(field)), (False, False))


# saved settings: one browser's, under one key of localStorage (read at the start of each run, written when it ends)
def GetSavedSetting(category, setting):
    key = "%s\x1f%s" % (category, setting)
    if key in _R.saved:
        return (True, _R.saved[key])
    return (False, "")


def SetSavedSetting(category, setting, value):
    c, k, v = str(category), str(setting), str(value)
    _R.saved["%s\x1f%s" % (c, k)] = v
    _R.saved_set.append([c, k, v])
    return None


# ---- plug-in objects (Vectorworks' Objects - Custom calls) ------------------------------------------------

def _custom_object(name, p, angle, what):
    kind = _R.plugin_kinds.get(str(name))
    if kind is None:
        raise NotImplementedError("vs.%s: Rodeo can't place the plug-in object '%s' from a script yet" % (what, name))
    x, y = _nums([p], 2, what)
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    at = [_mm(x), _mm(y)]
    turn = float(angle)
    # the copy takes its parameters and drawing from the drawn object it copies (in its class), as insertPlugin does
    s.ops.append(["plugcopy", tmp, kind, s.active_layer, at, turn])
    s.objs[tmp] = {"id": tmp, "type": 86, "typeName": "plug-in-object", "layer": s.active_layer, "parent": s.pio, "cls": s.active_class,
                   "name": "", "sel": False, "attrs": None, "shape": None, "records": {}, "sym": None, "ins": list(at), "turned": turn, "bbox": None}
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    return Handle(tmp)


def CreateCustomObject(objectName, p, rotationAngle):
    return _custom_object(objectName, p, rotationAngle, "CreateCustomObject")


def CreateCustomObjectN(objectName, p, rotationAngle, showPref):
    # the Object Properties dialog isn't shown to a script's run: showPref is accepted and ignored
    return _custom_object(objectName, p, rotationAngle, "CreateCustomObjectN")


def CreateCustomObjectPath(objectName, path, profileGroup):
    raise NotImplementedError("vs.CreateCustomObjectPath isn't available in Rodeo yet (a path plug-in object is drawn with its own tool)")
`;
