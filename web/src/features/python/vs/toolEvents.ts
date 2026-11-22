// (part of the vs module: see index.ts)

export const VS_TOOL_EVENTS = String.raw`
#
# Tool events: a tool plug-in whose script calls vstGetEventInfo is run once per event, as Vectorworks
# runs it. Rodeo's tool session (features/vwplugins/toolRun.ts) makes each run with the snapshot's
# plugin.tool block: the event and its two messages, the points clicked, the pointer, the mode bar
# the script declared at setup, the values it holds and the data the script saved. This part answers
# the vst calls from that block and reports back what the script declared, drew and returned (the
# toolSession key of the run's result). A run for any event but the completion one applies no steps:
# what it drew goes to the rubber band only. A run with no tool block (a plain run of the script)
# reports the setup event and keeps its steps, as a command's do.
#
# Event numbers and result codes: the constants below (see toolEvents.ts in the editor for the evidence).
# Modes are numbered from 1 in the order the script added them; they are declared at setup only.

TOOL_SETUP = 3
TOOL_CANCEL = 4
TOOL_MODE = 7
TOOL_POINT_ADDED = 100
TOOL_POINT_REMOVED = 101
TOOL_DOUBLE_CLICK = 102
TOOL_DRAW = 103
TOOL_COMPLETE = 104
TOOL_STATUS = 105
TOOL_RESULT_COMPLETED = 8
TOOL_RESULT_CANCEL = 9
TOOL_RESULT_READY_WITH_ENTER = 18
# what vstGetPt2D gives for a point that wasn't clicked (measured in Vectorworks by a plug-in author)
_TOOL_NO_POINT = 1.0e97


def _tev_init(state, snap):
    p = snap.get("plugin") or {}
    t = p.get("tool") or None
    state.tev_block = t
    if t:
        state.tev_event = (int(t.get("event", TOOL_SETUP)), int(t.get("msg1", 0)), int(t.get("msg2", 0)))
    else:
        # a plain run: the setup event, which a tool's script answers with its mode bar and help
        state.tev_event = (TOOL_SETUP, 0, 0)
    setup = state.tev_event[0] == TOOL_SETUP
    state.tev_adding = setup or t is None
    state.tev_points = [[float(a), float(b)] for a, b in ((t or {}).get("points") or [])]
    cur = (t or {}).get("current")
    state.tev_current = [float(cur[0]), float(cur[1])] if cur else None
    state.tev_behavior = int((t or {}).get("behavior", 0))
    state.tev_help = str((t or {}).get("help", ""))
    state.tev_modes = [] if setup else [dict(m) for m in (t or {}).get("modes", [])]
    state.tev_data = dict((t or {}).get("data") or {})
    state.tev_result = 0
    state.tev_draw = []


_INIT_HOOKS.append(_tev_init)


def _tev_result(state):
    if state.tev_block is None:
        return {}
    out = {
        "toolSession": {
            "result": int(state.tev_result),
            "behavior": int(state.tev_behavior),
            "help": state.tev_help,
            "modes": state.tev_modes,
            "draw": state.tev_draw,
            "data": state.tev_data,
        }
    }
    # only the completion run makes the object; the others change nothing in the drawing
    if state.tev_event[0] != TOOL_COMPLETE:
        out["ops"] = []
    return out


_RESULT_HOOKS.append(_tev_result)


def _tev_mode(group):
    g = int(group)
    if 1 <= g <= len(_S.tev_modes):
        return _S.tev_modes[g - 1]
    return None


def _tev_add(mode):
    # the bar is declared at setup; a later run's add calls would only repeat it
    if _S.tev_adding:
        _S.tev_modes.append(mode)


def _tev_pt(i):
    i = int(i)
    if 0 <= i < len(_S.tev_points):
        p = _S.tev_points[i]
        return (_un(p[0]), _un(p[1]))
    return (_TOOL_NO_POINT, _TOOL_NO_POINT)


# ---- the event and the script's answer -------------------------------------------------------------

def vstGetEventInfo(*_):
    # (action, message 1, message 2): what the editor sent this run; (3, 0, 0) for a plain run
    return _S.tev_event


def vstSetEventResult(inSetVal):
    _S.tev_result = int(inSetVal)


def vstGetEventResult(*_):
    return _S.tev_result


# ---- the points and the pointer --------------------------------------------------------------------

def vstNumPts(*_):
    return len(_S.tev_points)


def vstGetPt2D(inPtIndex, *_):
    # the point's index counts from 0 (vstNumPts counts the points); a point not clicked gives 1e97
    return _tev_pt(inPtIndex)


def vstGetPt3D(inPtIndex, *_):
    # the plan's points: Z is 0 (Rodeo has no working plane for a tool yet)
    x, y = _tev_pt(inPtIndex)
    return (x, y, 0.0 if x != _TOOL_NO_POINT else _TOOL_NO_POINT)


def vstGetCurrPt2D(*_):
    c = _S.tev_current
    if c is None:
        return (_TOOL_NO_POINT, _TOOL_NO_POINT)
    return (_un(c[0]), _un(c[1]))


def vstGetCurrPt3D(*_):
    x, y = vstGetCurrPt2D()
    return (x, y, 0.0 if x != _TOOL_NO_POINT else _TOOL_NO_POINT)


def vstSetPtBehavior(inStatusType):
    # 0 and 2: two points; 1: one; 3: three; 4: many, a double-click completes; 101 box, 102 ellipse
    _S.tev_behavior = int(inStatusType)


def vstSetHelpString(inHelpStr):
    _S.tev_help = str(inHelpStr)


def vstGetToolObject(*_):
    # the object the point behaviour itself makes on completion: Rodeo makes none (the script does)
    return None


def vstNameUndoEvent(inUndoEventName):
    # the undo step's name in the mode bar: each completion is one undo step, named as the plug-in
    return None


# ---- the mode bar ------------------------------------------------------------------------------------

def vstAddButtonMode(inIconID):
    _tev_add({"kind": "button", "icons": [str(inIconID)], "items": [], "label": "", "value": 0, "enabled": True})


def AddButtonMode(imageSpecifier):
    vstAddButtonMode(imageSpecifier)


def vstAddRadioMode(inInitialSetting, inNumButtons, *icons):
    n = int(inNumButtons)
    _tev_add({"kind": "radio", "icons": [str(x) for x in icons[:n]], "items": [], "label": "", "value": int(inInitialSetting), "enabled": True})


def AddRadioMode(initialSetting, buttonCount, *icons):
    vstAddRadioMode(initialSetting, buttonCount, *icons)


def vstAddPDMenuMode(lbel):
    _tev_add({"kind": "pulldown", "icons": [], "items": [], "label": str(lbel), "value": 0, "enabled": True})


def vstAddPDMenuItem(group, item):
    m = _tev_mode(group)
    if m is not None and m["kind"] == "pulldown" and _S.tev_adding:
        m["items"].append(str(item))


def vstSetPDMenuSel(group, selectedItem):
    # the item counts from 0
    m = _tev_mode(group)
    if m is not None and m["kind"] == "pulldown":
        m["value"] = int(selectedItem)


def vstEnableMode(inModeNumber, inEnable):
    m = _tev_mode(inModeNumber)
    if m is not None:
        m["enabled"] = bool(inEnable)


def vstGetModeValue(inModeGroup):
    # a radio group's button (from 1), a pull-down's item (from 0), a check box 0 or 1, a button 0
    m = _tev_mode(inModeGroup)
    if m is None or m["kind"] == "button":
        return 0
    return int(m["value"])


def BeginModeButtonsText(*_):
    # balloon help for the mode buttons: the bar shows the help string and the labels from the images only
    return None


def SetModeButtonText(*_):
    return None


def SetModeButtonTextN(*_):
    return None


def EndModeButtonsText(*_):
    return None


def vstSetModeHelpBase(inTextRsrcIDBase):
    # the balloon help comes from a resource file of the plug-in, which Rodeo doesn't read
    return None


def vstSetCursorByView(*_):
    # the cursor is the editor's own for the view it is over
    return None


def vstSetWPHybridTool(message1):
    # Rodeo keeps the working plane as it is for a tool
    return None


def vstRestoreWPHybridTool(message1):
    return None


# ---- drawing the rubber band -----------------------------------------------------------------------

def vstDrawCoordLine(pt1X, pt1Y, pt2X, pt2Y):
    _S.tev_draw.append(["line", _mm(pt1X), _mm(pt1Y), _mm(pt2X), _mm(pt2Y)])


def vstDrawCoordLine3D(pt1X, pt1Y, pt1Z, pt2X, pt2Y, pt2Z):
    # the plan's line: Z is dropped (the drawing is shown in plan)
    vstDrawCoordLine(pt1X, pt1Y, pt2X, pt2Y)


def vstDrawCoordLineN(pt1X, pt1Y, pt2X, pt2Y, planeRefID):
    # the plane reference is ignored: the plan
    vstDrawCoordLine(pt1X, pt1Y, pt2X, pt2Y)


def vstDrawCoordRect(ptLeftTopX, ptLeftTopY, ptRghtBotX, ptRghtBotY):
    _S.tev_draw.append(["rect", _mm(ptLeftTopX), _mm(ptLeftTopY), _mm(ptRghtBotX), _mm(ptRghtBotY)])


def vstDrawCoordEllipse(ptLeftTopX, ptLeftTopY, ptRghtBotX, ptRghtBotY):
    _S.tev_draw.append(["ellipse", _mm(ptLeftTopX), _mm(ptLeftTopY), _mm(ptRghtBotX), _mm(ptRghtBotY)])


def vstDrawCoordArcN(ptLeftTopX, ptLeftTopY, ptRghtBotX, ptRghtBotY, startAngle, sweepAngle):
    # the angles are in degrees, counter-clockwise from the right (Rodeo's reading: not checked in Vectorworks)
    _S.tev_draw.append(["arc", _mm(ptLeftTopX), _mm(ptLeftTopY), _mm(ptRghtBotX), _mm(ptRghtBotY), float(startAngle), float(sweepAngle)])


# ---- data the tool keeps between its runs ----------------------------------------------------------

def _tev_set_data(inDataID, kind, value):
    _S.tev_data[str(int(inDataID))] = [kind, value]
    return True


def _tev_get_data(inDataID, kind, default):
    d = _S.tev_data.get(str(int(inDataID)))
    if d and d[0] == kind:
        return (d[1], True)
    return (default, False)


def vstSetDataLong(inDataID, inDataVal):
    return _tev_set_data(inDataID, "long", int(inDataVal))


def vstGetDataLong(inDataID):
    return _tev_get_data(inDataID, "long", 0)


def vstSetDataReal(inDataID, inDataVal):
    return _tev_set_data(inDataID, "real", float(inDataVal))


def vstGetDataReal(inDataID):
    return _tev_get_data(inDataID, "real", 0.0)


def vstSetDataString(inDataID, inDataVal):
    return _tev_set_data(inDataID, "string", str(inDataVal))


def vstGetDataString(inDataID):
    return _tev_get_data(inDataID, "string", "")
`;
