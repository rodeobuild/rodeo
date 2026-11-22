// (part of the vs module: see index.ts)
export const VS_PLUGIN_OBJECTS = String.raw`
#
# Vectorworks' calls for plug-in objects beyond the core's: a path object's path (its polyline is
# virtual, in the object's own frame, and not one of the object's drawn children), the control points
# and popups of its parameters, the widgets its script adds and changes, and the state events that
# report which parameter an edit changed. What the run is about comes in the snapshot's plugin block
# (plugin.info, from run.ts): the control points, popup choices, display names, widget numbers and the
# values an edit replaced. Calls Rodeo can't answer for a plug-in object aren't defined here, so they
# raise NotImplementedError.

_PATH_KEY = "__path"
def _plugin_objects_init(state, snap):
    p = snap.get("plugin") or {}
    state.info = p.get("info") or {}
    state.param_names = [name for name, _t, _v in p.get("params", [])]
    state.popups = {}
    state.changed = list(state.info.get("changed") or [])
    state.path_id = None
    if state.pio and state.params.get(_PATH_KEY):
        state.path_id = _make_path(state, state.params[_PATH_KEY])


_INIT_HOOKS.append(_plugin_objects_init)


def _plugin_objects_result(state):
    # the popups' items go to the layout with the widgets (index.ts reads them there)
    if state.plugin and state.popups:
        for widget, items in state.popups.items():
            if items:
                state.ui["widgets"].append({"id": widget, "items": [[i, t] for i, t in items], "level": 0})
    return {}


_RESULT_HOOKS.append(_plugin_objects_result)


def _make_path(state, text):
    """The virtual polyline of a path object's path (its JSON from the record): its id, or None when it has under two vertices."""
    try:
        d = _json.loads(text)
    except ValueError:
        return None
    verts = d.get("v") or []
    if len(verts) < 2:
        return None
    rows = [[float(v[0]), float(v[1]), v[2] if len(v) > 2 else "corner", float(v[3]) if len(v) > 3 else 0.0] for v in verts]
    shape = {"kind": "polyline", "pts": [r[:2] for r in rows], "closed": bool(d.get("closed")), "verts": rows}
    pid = "path:" + state.pio
    o = {
        "id": pid, "type": _TYPE_OF_KIND["polyline"], "typeName": "polyline", "layer": state.objs[state.pio]["layer"],
        "parent": state.pio, "cls": state.active_class, "name": "", "sel": False, "attrs": {}, "records": {},
        "sym": None, "turned": 0, "ins": None, "shape": shape,
    }
    o["bbox"] = _shape_box(shape)
    state.objs[pid] = o
    return pid


def _is_pio(h):
    return isinstance(h, Handle) and _S.pio is not None and h._id == _S.pio


def _pkey_of(name):
    """A parameter's key from its name as a script gives it: a P before the name is the parameter constant's, unless the plug-in has a parameter of that name."""
    text = str(name)
    if text[:1] in "Pp" and _pkey(text[1:]) in [_pkey(n) for n in _S.param_names]:
        text = text[1:]
    return _pkey(text)


def _is_own(plugin_name):
    return _S.plugin is not None and str(plugin_name).lower() == str(_S.plugin["name"]).lower()


def GetCustomObjectPath(objectHand):
    """The path of a path plug-in object: a polyline handle in the object's own frame, or None when it has none."""
    if not _is_pio(objectHand):
        raise TypeError("vs.GetCustomObjectPath takes the handle of the plug-in object being drawn")
    return _h(_S.path_id)


def GetCustomObjectProfileGroup(objectHand):
    """A path object's profile: Rodeo draws no profile along a path, so None."""
    if not _is_pio(objectHand):
        raise TypeError("vs.GetCustomObjectProfileGroup takes the handle of the plug-in object being drawn")
    return None


def GetCustomObjectWallHoleGroup(objectHand):
    """The opening a plug-in object cuts in a wall: Rodeo's plug-in objects cut none, so None."""
    if not _is_pio(objectHand):
        raise TypeError("vs.GetCustomObjectWallHoleGroup takes the handle of the plug-in object being drawn")
    return None


def _choices_of(parameterName):
    key = _pkey_of(parameterName)
    for name, items in (_S.info.get("choices") or {}).items():
        if _pkey(name) == key:
            return items
    return []


def NumCustomObjectChoices(objectName, parameterName):
    return len(_choices_of(parameterName))


def GetCustomObjectChoice(objectName, parameterName, choiceIndex):
    items = _choices_of(parameterName)
    i = int(choiceIndex)
    if not 1 <= i <= len(items):
        raise IndexError("vs.GetCustomObjectChoice: there's no choice %d (1 to %d)" % (i, len(items)))
    return items[i - 1]["label"]


def GetPluginChoiceIndex(inPluginName, inParameterName, inChoiceName):
    """(found, index from 1): the choice by its kept value or the name shown."""
    if not _is_own(inPluginName):
        return (False, 0)
    for i, item in enumerate(_choices_of(inParameterName)):
        if str(inChoiceName) in (item["value"], item["label"]):
            return (True, i + 1)
    return (False, 0)


def GetLocalizedPluginName(inPluginName):
    # Rodeo keeps no localized names: the plug-in's own name stands for it, and another's is unknown
    if _is_own(inPluginName):
        return (True, _S.plugin["name"])
    return (False, str(inPluginName))


def GetLocalizedPluginParameter(inPluginName, inParameterName):
    key = _pkey_of(inParameterName)
    if _is_own(inPluginName) and key in [_pkey(n) for n in _S.param_names]:
        for name, label in (_S.info.get("labels") or {}).items():
            if _pkey(name) == key:
                return (True, label)
    return (False, str(inParameterName))


def GetLocalizedPluginChoice(inPluginName, inParameterName, inChoiceIndex):
    items = _choices_of(inParameterName) if _is_own(inPluginName) else []
    i = int(inChoiceIndex)
    if 1 <= i <= len(items):
        return (True, items[i - 1]["label"])
    return (False, "")


def _widget_id_of(parameterName):
    """The number of the layout widget showing a parameter: from the layout run, else from the layout's numbers."""
    key = _pkey_of(parameterName)
    for w in _S.ui["widgets"]:
        if w.get("param") and _pkey(w["param"]) == key:
            return w.get("id")
    for name, wid in (_S.info.get("widgets") or {}).items():
        if _pkey(name) == key:
            return wid
    return None


def _param_state(parameterName, key, on):
    # a plug-in with no layout of its own lists its fields as they are: nothing to grey or hide then
    wid = _widget_id_of(parameterName)
    if wid is not None:
        _widget_state(wid, key, on)
    return True


def SetParameterVisibility(inPlugin, inParameterName, inSetVisible):
    _param_state(inParameterName, "visible", inSetVisible)


def EnableParameter(inPlugin, inParameterName, inSetEnabled):
    _param_state(inParameterName, "enabled", inSetEnabled)


def vsoParamName2Index(formatName, paramUnivName):
    """The parameter's zero-based index in the plug-in's parameters, or -1."""
    key = _pkey(paramUnivName)
    for i, name in enumerate(_S.param_names):
        if _pkey(name) == key:
            return i
    return -1


def vsoPrmName2WidgetID(recName, paramName, outWidgetID=None):
    wid = _widget_id_of(paramName)
    return (wid is not None, wid if wid is not None else 0)


def vsoWidgetGetRecParam(widgetID):
    for w in _S.ui["widgets"]:
        if w.get("id") == int(widgetID) and w.get("param"):
            return w["param"]
    return ""


def vsoWidgetSetText(widgetID, text):
    for w in _S.ui["widgets"]:
        if w.get("id") == int(widgetID):
            w["label"] = str(text)
    return None


def vsoWidgetGetText(widgetID):
    for w in _S.ui["widgets"]:
        if w.get("id") == int(widgetID):
            return w.get("label", "")
    return ""


def vsoWidgetGetEnable(widgetID):
    return bool(_S.ui["states"].get(str(int(widgetID)), {}).get("enabled", True))


def vsoWidgetGetVisible(widgetID):
    return bool(_S.ui["states"].get(str(int(widgetID)), {}).get("visible", True))


def vsoInsertWidget(paramID, widgetType, mappingID, text, data=0):
    """A widget added to the layout: a parameter's when its type is a field's (mappingID is the parameter's number from 1, Rodeo's reading), else a widget of the type. It goes to the end of the layout."""
    wid = int(paramID)
    kind = int(widgetType)
    if kind in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14) and 1 <= int(mappingID) <= len(_S.param_names):
        w = {"id": wid, "param": _S.param_names[int(mappingID) - 1], "label": str(text), "level": 0}
    else:
        w = {"id": wid, "type": kind, "label": str(text), "level": 0}
    _S.ui["widgets"].append(w)
    return True


def vsoInsertParamWidget(position, parameterID, text, data=0):
    """A parameter's widget put at position in the layout (both numbered from 1, Rodeo's reading of the reference)."""
    n = int(parameterID)
    if not 1 <= n <= len(_S.param_names):
        return False
    w = {"id": n, "param": _S.param_names[n - 1], "label": str(text), "level": 0}
    _S.ui["widgets"].insert(max(0, min(int(position) - 1, len(_S.ui["widgets"]))), w)
    return True


def _popup(widgetID):
    return _S.popups.setdefault(int(widgetID), [])


def vsoWidgetPopupAdd(widgetID, id, text):
    _popup(widgetID).append([str(id), str(text)])


def vsoWidgetPopupClear(widgetID):
    _S.popups[int(widgetID)] = []


def vsoWidgetPopupGetCnt(widgetID):
    return len(_popup(widgetID))


def vsoWidgetPopupGet(widgetID, index):
    items = _popup(widgetID)
    i = int(index)
    if not 0 <= i < len(items):
        raise IndexError("vs.vsoWidgetPopupGet: there's no item %d" % i)
    return (items[i][0], items[i][1])


def vsoWidgetPopupSet(widgetID, index, id, text):
    items = _popup(widgetID)
    i = int(index)
    if not 0 <= i <= len(items):
        raise IndexError("vs.vsoWidgetPopupSet: there's no item %d" % i)
    if i == len(items):
        items.append([str(id), str(text)])
    else:
        items[i] = [str(id), str(text)]
    return None


def vsoWidgetPopupGetID(widgetID, text):
    for item_id, item_text in _popup(widgetID):
        if item_text == str(text):
            return item_id
    return ""


def vsoWidgetPopupGetTxt(widgetID, id):
    for item_id, item_text in _popup(widgetID):
        if item_id == str(id):
            return item_text
    return ""


def vsoStateClear():
    # the states of a run are its own (see vsoStateGetParamChng): nothing is kept between runs
    return None


def vsoStateAddCurrent(hObj, message):
    # Rodeo adds no states of its own, so the message passes on as it came
    return int(message)


def vsoStateGet(hObj, state):
    return False


def vsoStateGetParamChng(hObj):
    """The next parameter an edit changed in this run: (True, widget, parameter index from 0, the value it held) or (False, 0, 0, "")."""
    if not _S.changed:
        return (False, 0, 0, "")
    change = _S.changed.pop(0)
    wid = _widget_id_of(change["name"])
    return (True, wid if wid is not None else 0, vsoParamName2Index("", change["name"]), change["old"])


def vsoStateGetObjChng(hObj):
    return (False, 0)


def vsoStateGetPos(hObj):
    return (False, 0.0, 0.0, 0.0, False)


def vsoStateGetRot(hObj):
    return (False, 0.0, False)


def vsoStateGetLayrChng(hObj):
    return (False, 0.0, 0.0, False)


def vsoStateGetNameChng(hObj):
    return (False, "", "")


def vsoStateGetExitGroup(hObj):
    return (False, 0)


for _n in ("DisplayContextHelpOfCurrentPlugin",):
    globals()[_n] = _accepted
del _n
`;
