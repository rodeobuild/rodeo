// Node checks of the layout dialogs (vs.CreateLayout ... vs.RunLayoutDialog) through vsCheck.ts.
//
// The editor's answer to vs's _host("Dialog", spec) is JSON, one object per event the editor sends:
//   { "item": <id of the control the event is about>, "data": <its data: a choice's index, a tab's pane,
//     a list's row, or 0>, "values": { "<control id>": { ...what that control holds... } }, "focus": <id of
//     the control holding the keyboard focus, or null> }
// A control's values are the keys its read() gives in layoutDialog.ts: "text" (edit fields), "raw" and
// "value" (real and integer fields), "sel" (popups and list boxes, a list of indices), "value" (check
// boxes, radio buttons, sliders, tabs' pane, colour popups) and, for list browsers, "sel", "sort" and
// "checks"; list browsers also send "event" ({type, row, col}) and tree controls "sel" and "open".
// Each script's handler receives the item (the control id, or 12255 for setup and 12256 for setdown)
// and data. The answers run in order; once the queue is empty the editor answers null, which ends
// the dialog as Cancel.

import assert from "node:assert/strict";
import { ranVs, runVs } from "./vsCheck.ts";

interface Spec {
  id: number;
  title: string;
  first: number | null;
  focus: number | null;
  items: { id: number; kind: string; text?: string; value?: unknown; sel?: number[]; max?: number; live?: boolean; enabled: boolean; visible: boolean }[];
}

/** The dialog specs the script sent to the editor, in order. */
function specs(asked: [string, unknown[]][]): Spec[] {
  return asked.filter(([k]) => k === "Dialog").map(([, args]) => JSON.parse(args[0] as string) as Spec);
}

function item(spec: Spec, id: number) {
  const found = spec.items.find((i) => i.id === id);
  assert.ok(found, `item ${id} is in the spec`);
  return found;
}

// Step 1: a typed field sends an event per pause, without losing the focus or the text typed since.
{
  const code = `
import vs
dlg = vs.CreateLayout("Typing")
vs.CreateEditText(dlg, 10, "", 20)
vs.CreateStaticText(dlg, 11, "")
vs.SetFirstLayoutItem(dlg, 10)
vs.SetBelowItem(dlg, 10, 11)
seen = []
def handler(item, data):
    if item == 12255:
        return
    if item == 10:
        seen.append((vs.GetItemText(dlg, 10), vs.GetActiveEditItem(dlg)))
        vs.SetItemText(dlg, 11, "You typed: " + vs.GetItemText(dlg, 10))
    if item == 1:
        print(seen)
    return None
vs.RunLayoutDialog(dlg, handler)
print("done")
`;
  const r = ranVs(code, {
    answers: {
      Dialog: [
        { item: 10, data: 0, values: { 10: { text: "a" } }, focus: 10 },
        { item: 10, data: 0, values: { 10: { text: "ab" } }, focus: 10 },
        { item: 1, data: 0, values: { 10: { text: "ab" } }, focus: 10 },
      ],
    },
  });
  assert.deepEqual(r.printed.trim().split("\n"), ["[('a', 10), ('ab', 10)]", "done"]);
  const s = specs(r.asked);
  // one spec before the first event, then one after each event the script answers
  assert.equal(s.length, 3);
  // the static text follows the typed text at the next spec
  assert.equal(item(s[2], 11).text, "You typed: ab");
}

// Step 2: sliders (CreateControl kind 3), their data and live updates; frames for pictures.
{
  const code = `
import vs
dlg = vs.CreateLayout("Slider")
vs.CreateControl(dlg, 10, 3, "Level", 100)
vs.CreateImageControl2(dlg, 11, 32, 16, "x.png")
vs.SetFirstLayoutItem(dlg, 10)
vs.SetBelowItem(dlg, 10, 11)
vs.SetSliderLiveUpdate(dlg, 10, True)
vs.SetControlData(dlg, 10, 250)
print("clamped", vs.GetControlData(dlg, 10))
got = []
def handler(item, data):
    if item == 12255:
        vs.SetControlData(dlg, 10, 40)
        return None
    if item == 10:
        got.append(vs.GetControlData(dlg, 10))
    return None
vs.RunLayoutDialog(dlg, handler)
print("handled", got, "after", vs.GetControlData(dlg, 10))
`;
  const r = ranVs(code, {
    answers: {
      Dialog: [
        { item: 10, data: 0, values: { 10: { value: 55 } }, focus: 10 },
        { item: 1, data: 0, values: { 10: { value: 70 } }, focus: 10 },
      ],
    },
  });
  assert.deepEqual(r.printed.trim().split("\n"), ["clamped 100", "handled [55] after 70"]);
  const s = specs(r.asked);
  assert.equal(item(s[0], 10).kind, "slider");
  assert.equal(item(s[0], 10).value, 40, "the setup's change is in the first spec");
  assert.equal(item(s[0], 11).kind, "frame");
  assert.equal(item(s[0], 10).max, 100);
  assert.equal(item(s[0], 10).live, true);
  // a control kind Rodeo doesn't have fails honestly
  const bad = runVs(`import vs\ndlg = vs.CreateLayout("x")\nvs.CreateControl(dlg, 5, 11, "Gradient", 10)\n`, {});
  assert.equal(bad.error?.name, "NotImplementedError");
}

// Step 3: list browsers. The answers are the editor's: a selection, a header click that asks for a
// sort, a check toggle, a double click, and OK. Attributes set on a cell move with its row when sorted.
// Rows start as bolt 5, nut 12, washer 3, axle 1, gear 9 (the Qty column numbers); an ascending sort
// on Qty gives axle, washer, bolt, gear, nut.
{
  const code = `
import vs
dlg = vs.CreateLayout("Browser")
vs.CreateLB(dlg, 10, 30, 5)
vs.InsertLBColumn(dlg, 10, 0, "Name", 12)
vs.InsertLBColumn(dlg, 10, 1, "Qty", 6)
vs.InsertLBColumn(dlg, 10, 2, "Done", 6)
vs.SetLBControlType(dlg, 10, 2, 3)
vs.SetLBColumnHeaderJust(dlg, 10, 1, 3)
vs.SetLBColumnHeaderToolTip(dlg, 10, 1, "Quantity", "in stock")
for i, (n, q) in enumerate([("bolt", 5), ("nut", 12), ("washer", 3), ("axle", 1), ("gear", 9)]):
    vs.InsertLBItem(dlg, 10, i, n)
    vs.SetLBNumericItemInfo(dlg, 10, i, 1, str(q), q, 0)
vs.SetLBSelection(dlg, 10, 0, 1, True)
vs.EnableLBSorting(dlg, 10, True)
vs.EnableLBColumnLines(dlg, 10, True)
vs.SetLBColumnWidth(dlg, 10, 0, 1, 8)
print("counts", vs.GetNumLBColumns(dlg, 10), vs.GetNumLBItems(dlg, 10), vs.GetLBColumnWidth(dlg, 10, 0)[1], vs.GetLBControlType(dlg, 10, 2))
print("selected", vs.GetNumSelectedLBItems(dlg, 10), vs.IsLBItemSelected(dlg, 10, 1), vs.IsLBSortingEnabled(dlg, 10), vs.AreLBColumnLinesEnabled(dlg, 10))
print("header", vs.GetLBColumnHeaderJust(dlg, 10, 1)[1], vs.GetLBColumnHeaderToolTip(dlg, 10, 1)[1:])
seen = []
def handler(item, data):
    if item == 12255:
        vs.SetLBItemTextStyle(dlg, 10, 0, 0, 1)
        vs.SetLBItemTextColor(dlg, 10, 2, 0, 255, 0, 0)
        return None
    if item == 10:
        ok, kind, row, col = vs.GetLBEventInfo(dlg, 10)
        seen.append((ok, kind, row, col, vs.GetNumSelectedLBItems(dlg, 10), vs.GetLBSortColumn(dlg, 10), vs.GetLBItemInfo(dlg, 10, 0, 0)[1]))
    return None
vs.RunLayoutDialog(dlg, handler)
for s in seen:
    print("event", s)
print("after", vs.GetLBItemTextStyle(dlg, 10, 2, 0)[1], vs.GetLBItemTextColor(dlg, 10, 1, 0), vs.GetLBItemInfo(dlg, 10, 2, 2))
print("sort", vs.GetLBSortColumn(dlg, 10), vs.GetLBColumnSortState(dlg, 10, 1), vs.GetLBColumnSortState(dlg, 10, 0))
print("text", vs.GetLBItemInfo(dlg, 10, 0, 0)[1], vs.GetLBItemInfo(dlg, 10, 4, 1)[1])
`;
  const r = ranVs(code, {
    answers: {
      Dialog: [
        // a click on the axle row (row 3), column 0
        { item: 10, data: 3, values: { 10: { sel: [3], sort: null, checks: {}, event: { type: -4, row: 3, col: 0 } } }, focus: 10 },
        // a header click on Qty asks for an ascending sort
        { item: 10, data: 1, values: { 10: { sel: [3], sort: [1, true], checks: {}, event: { type: -10, row: -1, col: 1 } } }, focus: 10 },
        // the check cell of row 2 (bolt after the sort) is turned on
        { item: 10, data: 2, values: { 10: { sel: [0], sort: [1, true], checks: { "2,2": true }, event: { type: -2, row: 2, col: 2 } } }, focus: 10 },
        // a double click on row 4, column 0
        { item: 10, data: 4, values: { 10: { sel: [0], sort: [1, true], checks: { "2,2": true }, event: { type: -5, row: 4, col: 0 } } }, focus: 10 },
        { item: 1, data: 0, values: { 10: { sel: [0], sort: [1, true], checks: { "2,2": true }, event: null } }, focus: 10 },
      ],
    },
  });
  assert.deepEqual(r.printed.trim().split("\n"), [
    "counts 3 5 8 3",
    "selected 2 True True True",
    "header 3 ('Quantity', 'in stock')",
    "event (True, -4, 3, 0, 1, -1, 'bolt')",
    "event (True, -10, -1, 1, 1, 1, 'axle')",
    "event (True, -2, 2, 2, 1, 1, 'axle')",
    "event (True, -5, 4, 0, 1, 1, 'axle')",
    "after 1 (True, 255, 0, 0) (True, '', 1)",
    "sort 1 -1 0",
    "text axle 12",
  ]);
  // the sorted rows reach the editor in their new order
  const s = specs(r.asked);
  const rowsOf = (sp: Spec) => (sp.items.find((i) => i.id === 10) as unknown as { rows: { cells: { text: string }[] }[] }).rows;
  assert.equal(rowsOf(s[2])[0].cells[0].text, "axle");
  assert.equal(rowsOf(s[2])[4].cells[0].text, "nut");
}

// Step 4: tree controls. A top-level item (parent -1), a child under it (parent = its id), a second
// top-level item after the first; the editor answers with a selection and the expanded items.
{
  const code = `
import vs
dlg = vs.CreateLayout("Tree")
vs.CreateTreeControl(dlg, 10, 30, 8)
vs.InsertTreeControlItem(dlg, 10, "Walls", -1, 0)
vs.InsertTreeControlItem(dlg, 10, "Brick", 1, 0)
vs.InsertTreeControlItem(dlg, 10, "Doors", -1, 1)
vs.SetTreeControlItemData(dlg, 10, 2, 77)
vs.SelectTreeControlItem(dlg, 10, 2)
vs.ExpandTreeControlItem(dlg, 10, 1, True)
print("tree", vs.GetTreeControlSelectedItem(dlg, 10), vs.GetTreeControlTextSelectedItem(dlg, 10), vs.GetTreeControlItemText(dlg, 10, 3), vs.GetTreeControlItemData(dlg, 10, 2))
def handler(item, data):
    if item == 10:
        print("picked", data, vs.GetTreeControlSelectedItem(dlg, 10))
    return None
vs.RunLayoutDialog(dlg, handler)
vs.RemoveTreeControlItem(dlg, 10, 3)
print("after remove", vs.GetTreeControlItemText(dlg, 10, 2))
`;
  const r = ranVs(code, {
    answers: {
      Dialog: [
        { item: 10, data: 3, values: { 10: { sel: [3], open: [1] } }, focus: 10 },
        { item: 1, data: 0, values: { 10: { sel: [3], open: [1] } }, focus: 10 },
      ],
    },
  });
  assert.deepEqual(r.printed.trim().split("\n"), [
    "tree (True, 2) (True, 'Brick') (True, 'Doors') 77",
    "picked 3 (True, 3)",
    "after remove (True, 'Brick')",
  ]);
  const s = specs(r.asked);
  // the tree's rows go depth first as [id, text, parent (0 at the top), has children]
  const rows = (item(s[0], 10) as unknown as { tree: [number, string, number, boolean][] }).tree;
  assert.deepEqual(rows, [[1, "Walls", 0, true], [2, "Brick", 1, false], [3, "Doors", 0, false]]);
  assert.equal(item(s[0], 10).kind, "tree");
}

// Step 5: popups, statics, buttons, frames, swap panes and the misc calls, each called at least once.
{
  const code = `
import vs
dlg = vs.CreateLayout("Misc")
vs.CreatePullDownSearch(dlg, 10, 20)
vs.InsertPulldownSearch(dlg, 10, "a", "Alpha", "first", "", False)
vs.InsertPulldownSearch(dlg, 10, "b", "Beta", "second", "", False)
vs.CreateCenteredStaticText(dlg, 11, "Centre", 12)
vs.CreateRightStaticText(dlg, 12, "Right", 12)
vs.CreateStyledStatic(dlg, 13, "Bold", 12, 2)
vs.SetStaticTextStyle(dlg, 13, 4)
vs.SetStaticTextColor(dlg, 13, 255, 0, 0)
vs.CreateEditPassword(dlg, 15, 10)
vs.CreateSearchEditBox(dlg, 16, "find", 12)
vs.CreateBorderlessBtn(dlg, 17, "Pick", "", True)
vs.CreateImagePushButton(dlg, 18, 12, "pict.png")
vs.CreateStandardIconControl(dlg, 19, 0)
vs.CreateSwapControl(dlg, 20)
p1 = vs.CreateSwapPane(dlg, 20, 1)
vs.SetControlText(dlg, 11, "Centred")
def handler(item, data):
    return None
vs.RunLayoutDialog(dlg, handler)
print("ok", p1)
`;
  const r = ranVs(code, { answers: { Dialog: [{ item: 1, data: 0, values: {}, focus: null }] } });
  assert.ok(r.printed.includes("ok"), "the misc calls ran");
  const s = specs(r.asked);
  assert.equal(item(s[0], 11).text, "Centred");
  assert.equal(item(s[0], 13).kind, "static");
  assert.equal(item(s[0], 19).kind, "frame");
}

// Step 6: popups (pull-downs, enhanced menus, thumbnails, image popups of object names), value popups
// (line styles, weights, markers, patterns) and buttons, with their values read back and the editor's
// selection delivered to the handler.
{
  const code = `
import vs
dlg = vs.CreateLayout("Popups")
vs.CreatePullDownSearch(dlg, 10, 20)
print("search add", vs.InsertPulldownSearch(dlg, 10, "k1", "Alpha", "tip", "", False), vs.InsertPulldownSearch(dlg, 10, "k2", "Beta", "tip", "", False))
vs.CreateEnhancedPullDownMenu(dlg, 11, 20, True)
print("enh", vs.InsertEnhancedPullDownMenuItem(dlg, 11, "One", 0), vs.InsertEnhanPullDownMenuItem(dlg, 11, "Two", 0), vs.InsertEnhancedPullDownMenuItem(dlg, 11, "Three", 0))
vs.RemoveEnhancedPullDownMenuItemRange(dlg, 11, 0, 1)
vs.ShowEnhancedPullDownMenuGroupIcon(dlg, 11, True)
vs.NotifyPullDownClicked(dlg, 11)
vs.CreateThumbnailPopup(dlg, 12)
vs.CreateCustThumbPopup(dlg, 13, 1)
vs.UpdateThumbnailPreview(dlg, 12)
vs.CreateResourcePopup(dlg, 14, 20)
print("img", vs.InsertImagePopupObjectItem(dlg, 14, "Door"), vs.InsertImagePopupObjectItem(dlg, 14, "Window"), vs.InsertImagePopupSeparator(dlg, 14, "---"))
print("get", vs.GetNumImagePopupItems(dlg, 14), vs.GetImagePopupObject(dlg, 14, 1), vs.GetImagePopupObjectItemIndex(dlg, 14, "Window"), vs.GetImagePopupObjectItemIndex(dlg, 14, "Nope"))
vs.SetImagePopupSelectedItem(dlg, 14, 2)
print("sel", vs.GetImagePopupSelectedItem(dlg, 14))
vs.RemoveImagePopupItem(dlg, 14, 3)
print("after remove", vs.GetNumImagePopupItems(dlg, 14))
vs.CreateLineStylePopup(dlg, 15)
vs.CreateLineWeightPopup(dlg, 16)
vs.CreateLineAttributePopup(dlg, 17)
vs.CreateMarkerPopup(dlg, 18)
vs.CreatePatternPopup(dlg, 19)
vs.SetMarkerChoice(dlg, 18, 1, 2, 90, 3)
vs.SetMarkerValue(dlg, 18, 4, 45, 10, 2, 0, 1)
print("marker", vs.GetMarkerChoice(dlg, 18), vs.GetMarkerValue(dlg, 18), vs.GetMarkerPopupSelectedItem(dlg, 18))
vs.SetLineStyleChoice(dlg, 15, 3)
vs.SetLineWeightChoice(dlg, 16, 0.5)
vs.SetLineAttributeData(dlg, 17, 2, 1.25)
vs.SetLineTypeChoice(dlg, 15, 4)
vs.SetLineTypeAttriData(dlg, 15, 5, 0.75)
vs.SetPatternData(dlg, 19, 6, 1, 2)
print("values", vs.GetLineStyleChoice(dlg, 15), vs.GetLineWeightChoice(dlg, 16), vs.GetLineAttributeData(dlg, 17), vs.GetLineTypeChoice(dlg, 15), vs.GetLineTypeAttriData(dlg, 15), vs.GetPatternData(dlg, 19))
print("ltypes", vs.GetNumLineTypeItems(dlg, 15))
vs.CreateBorderlessBtn(dlg, 30, "Pick", "", True)
vs.CreateBorderlessMenu(dlg, 31, "Menu", "")
vs.CreateCheckBox2(dlg, 32, "Tick", "")
vs.CreateRadioButton2(dlg, 33, "Dot", "")
vs.CreateImagePushButton(dlg, 34, 12, "pict.png")
vs.UpdateImagePushButton(dlg, 34, "pict2.png")
def handler(item, data):
    if item == 14:
        print("popup-event", data, vs.GetImagePopupSelectedItem(dlg, 14))
    return None
vs.RunLayoutDialog(dlg, handler)
print("end")`;
  const r = ranVs(code, { answers: { Dialog: [{ item: 14, data: 1, values: { 14: { sel: [1] } }, focus: 14 }, { item: 1, data: 0, values: {}, focus: null }] } });
  assert.deepEqual(r.printed.trim().split("\n"), [
    "search add True True",
    "enh 0 1 2",
    "img 0 1 2",
    "get 3 Window 2 0",
    "sel 2",
    "after remove 2",
    "marker (1, 2, 90, 3.0) (4, 45, 10.0, 2.0, 0, 1.0) (1, 2, 90, 3.0)",
    "values 3 0.5 (2, 1.25) 5 (5, 0.75) (6, 1, 2)",
    "ltypes 0",
    "popup-event 1 2",
    "end",
  ]);
  const s = specs(r.asked);
  assert.equal(item(s[0], 14).kind, "popup");
  assert.equal(item(s[0], 34).kind, "button");
}

// Step 7: a Vectorscript PROCEDURE that builds and runs a dialog, with calls that have no VAR parameters.
{
  const code = `PROCEDURE Handler(item, data: LONGINT);
BEGIN
END;
PROCEDURE Main;
VAR dlg: LONGINT;
BEGIN
  dlg := CreateLayout('Vectorscript');
  CreateEditText(dlg, 10, '', 20);
  CreateStaticText(dlg, 11, '', 20);
  CreateCheckBox(dlg, 12, 'Show');
  CreateRadioButton(dlg, 13, 'Red');
  CreateResourcePopup(dlg, 14, 20);
  InsertImagePopupObjectItem(dlg, 14, 'Door');
  SetFirstLayoutItem(dlg, 10);
  SetBelowItem(dlg, 10, 11);
  SetBelowItem(dlg, 11, 12);
  SetBelowItem(dlg, 12, 13);
  SetBelowItem(dlg, 13, 14);
  RunLayoutDialog(dlg, Handler);
  Message(GetImagePopupObject(dlg, 14, 0));
END;
RUN(Main);`;
  const r = ranVs(code, { file: "program.vs", answers: { Dialog: [{ item: 1, data: 0, values: {}, focus: null }] } });
  assert.deepEqual(r.messages, ["Door"]);
  const s = specs(r.asked);
  assert.equal(item(s[0], 14).kind, "popup");
}

// Step 8: every added call that no step above calls is called once, with its reference arity and
// generic arguments (a dialog holding one example of each control). A call that Rodeo lacks would raise
// NotImplementedError, and none does. A call whose arguments don't fit the control it names raises
// ValueError, which is what the module says for a wrong kind, so those count as reached. Any TypeError,
// AttributeError, NameError or KeyError would be a bug in the call, and there are none.
{
  const code = `import vs
d = vs.CreateLayout("Smoke")
vs.CreateLB(d, 10, 30, 5)
vs.InsertLBColumn(d, 10, 0, "Name", 12)
vs.InsertLBItem(d, 10, 0, "bolt")
vs.CreateTreeControl(d, 14, 30, 6)
vs.InsertTreeControlItem(d, 14, "Walls", -1, 0)
vs.CreateEditText(d, 16, "", 20)
vs.CreateCheckBox(d, 18, "Tick")
vs.CreateRadioButton(d, 19, "Dot")
vs.CreateTabControl(d, 21)
vs.CreateGroupBox(d, 22, "Group", True)
vs.CreateTabPane(d, 21, 22)
vs.CreateStaticText(d, 23, "Text", 10)
vs.CreateResourcePopup(d, 24, 20)
vs.InsertImagePopupObjectItem(d, 24, "Door")
vs.CreateControl(d, 25, 3, "Level", 100)
done = []
ni = []
other = []
try:
    vs.AddListBoxTabStop(d, 21, 0)
    done.append("AddListBoxTabStop")
except NotImplementedError:
    ni.append("AddListBoxTabStop")
except Exception as e:
    other.append(("AddListBoxTabStop", type(e).__name__))
try:
    vs.AdjustComponentPixelPos(d, 10, 0, 0)
    done.append("AdjustComponentPixelPos")
except NotImplementedError:
    ni.append("AdjustComponentPixelPos")
except Exception as e:
    other.append(("AdjustComponentPixelPos", type(e).__name__))
try:
    vs.AlignItemEdge(d, 10, 0, 10, 0)
    done.append("AlignItemEdge")
except NotImplementedError:
    ni.append("AlignItemEdge")
except Exception as e:
    other.append(("AlignItemEdge", type(e).__name__))
try:
    vs.AreLBRadioColumnLinesEnabled(d, 19, 0)
    done.append("AreLBRadioColumnLinesEnabled")
except NotImplementedError:
    ni.append("AreLBRadioColumnLinesEnabled")
except Exception as e:
    other.append(("AreLBRadioColumnLinesEnabled", type(e).__name__))
try:
    vs.CollapseAllLBItems(d, 10)
    done.append("CollapseAllLBItems")
except NotImplementedError:
    ni.append("CollapseAllLBItems")
except Exception as e:
    other.append(("CollapseAllLBItems", type(e).__name__))
try:
    vs.CreateCustomControl(d, 25, 0, 0)
    done.append("CreateCustomControl")
except NotImplementedError:
    ni.append("CreateCustomControl")
except Exception as e:
    other.append(("CreateCustomControl", type(e).__name__))
try:
    vs.CreateDesignLayerPullDownMenu(d, 24, 0)
    done.append("CreateDesignLayerPullDownMenu")
except NotImplementedError:
    ni.append("CreateDesignLayerPullDownMenu")
except Exception as e:
    other.append(("CreateDesignLayerPullDownMenu", type(e).__name__))
try:
    vs.CreateEditColorText(d, 16, 0, 0)
    done.append("CreateEditColorText")
except NotImplementedError:
    ni.append("CreateEditColorText")
except Exception as e:
    other.append(("CreateEditColorText", type(e).__name__))
try:
    vs.CreateLayerPDMenu(d, 24, 0)
    done.append("CreateLayerPDMenu")
except NotImplementedError:
    ni.append("CreateLayerPDMenu")
except Exception as e:
    other.append(("CreateLayerPDMenu", type(e).__name__))
try:
    vs.CreateSheetLayerPullDownMenu(d, 24, 0)
    done.append("CreateSheetLayerPullDownMenu")
except NotImplementedError:
    ni.append("CreateSheetLayerPullDownMenu")
except Exception as e:
    other.append(("CreateSheetLayerPullDownMenu", type(e).__name__))
try:
    vs.CreateSymDispCtrlN(d, 25, "x", 0, 0, 0, 0, 0, 25, 0)
    done.append("CreateSymDispCtrlN")
except NotImplementedError:
    ni.append("CreateSymDispCtrlN")
except Exception as e:
    other.append(("CreateSymDispCtrlN", type(e).__name__))
try:
    vs.CreateSymbolDisplayControl(d, 25, "x", 0, 0, 0, 0, 0)
    done.append("CreateSymbolDisplayControl")
except NotImplementedError:
    ni.append("CreateSymbolDisplayControl")
except Exception as e:
    other.append(("CreateSymbolDisplayControl", type(e).__name__))
try:
    vs.DeleteAllLBItems(d, 10)
    done.append("DeleteAllLBItems")
except NotImplementedError:
    ni.append("DeleteAllLBItems")
except Exception as e:
    other.append(("DeleteAllLBItems", type(e).__name__))
try:
    vs.DeleteLBColumn(d, 10, 0)
    done.append("DeleteLBColumn")
except NotImplementedError:
    ni.append("DeleteLBColumn")
except Exception as e:
    other.append(("DeleteLBColumn", type(e).__name__))
try:
    vs.DeleteLBItem(d, 10, 0)
    done.append("DeleteLBItem")
except NotImplementedError:
    ni.append("DeleteLBItem")
except Exception as e:
    other.append(("DeleteLBItem", type(e).__name__))
try:
    vs.DeselectEditText(d, 16)
    done.append("DeselectEditText")
except NotImplementedError:
    ni.append("DeselectEditText")
except Exception as e:
    other.append(("DeselectEditText", type(e).__name__))
try:
    vs.DisplaySwapPane(d, 21, 0)
    done.append("DisplaySwapPane")
except NotImplementedError:
    ni.append("DisplaySwapPane")
except Exception as e:
    other.append(("DisplaySwapPane", type(e).__name__))
try:
    vs.DisplayTabPane(d, 21, 0)
    done.append("DisplayTabPane")
except NotImplementedError:
    ni.append("DisplayTabPane")
except Exception as e:
    other.append(("DisplayTabPane", type(e).__name__))
try:
    vs.EnableLB(d, 10, True)
    done.append("EnableLB")
except NotImplementedError:
    ni.append("EnableLB")
except Exception as e:
    other.append(("EnableLB", type(e).__name__))
try:
    vs.EnableLBClickAllDataChange(d, 10, True)
    done.append("EnableLBClickAllDataChange")
except NotImplementedError:
    ni.append("EnableLBClickAllDataChange")
except Exception as e:
    other.append(("EnableLBClickAllDataChange", type(e).__name__))
try:
    vs.EnableLBColumnTracking(d, 10, 0, True)
    done.append("EnableLBColumnTracking")
except NotImplementedError:
    ni.append("EnableLBColumnTracking")
except Exception as e:
    other.append(("EnableLBColumnTracking", type(e).__name__))
try:
    vs.EnableLBDragAndDrop(d, 10, True)
    done.append("EnableLBDragAndDrop")
except NotImplementedError:
    ni.append("EnableLBDragAndDrop")
except Exception as e:
    other.append(("EnableLBDragAndDrop", type(e).__name__))
try:
    vs.EnableLBDropOnIndices(d, 10, True, 0, True)
    done.append("EnableLBDropOnIndices")
except NotImplementedError:
    ni.append("EnableLBDropOnIndices")
except Exception as e:
    other.append(("EnableLBDropOnIndices", type(e).__name__))
try:
    vs.EnableLBExternalSort(d, 10, True)
    done.append("EnableLBExternalSort")
except NotImplementedError:
    ni.append("EnableLBExternalSort")
except Exception as e:
    other.append(("EnableLBExternalSort", type(e).__name__))
try:
    vs.EnableLBHierDisplay(d, 10, True)
    done.append("EnableLBHierDisplay")
except NotImplementedError:
    ni.append("EnableLBHierDisplay")
except Exception as e:
    other.append(("EnableLBHierDisplay", type(e).__name__))
try:
    vs.EnableLBRadioColumnLines(d, 19, 0, True)
    done.append("EnableLBRadioColumnLines")
except NotImplementedError:
    ni.append("EnableLBRadioColumnLines")
except Exception as e:
    other.append(("EnableLBRadioColumnLines", type(e).__name__))
try:
    vs.EnableLBSingleLineSelection(d, 10, True)
    done.append("EnableLBSingleLineSelection")
except NotImplementedError:
    ni.append("EnableLBSingleLineSelection")
except Exception as e:
    other.append(("EnableLBSingleLineSelection", type(e).__name__))
try:
    vs.EnableLBUpdates(d, 10, True)
    done.append("EnableLBUpdates")
except NotImplementedError:
    ni.append("EnableLBUpdates")
except Exception as e:
    other.append(("EnableLBUpdates", type(e).__name__))
try:
    vs.EnableTextEdit(d, 16, 0)
    done.append("EnableTextEdit")
except NotImplementedError:
    ni.append("EnableTextEdit")
except Exception as e:
    other.append(("EnableTextEdit", type(e).__name__))
try:
    vs.EnsureLBItemIsVisible(d, 10, 0)
    done.append("EnsureLBItemIsVisible")
except NotImplementedError:
    ni.append("EnsureLBItemIsVisible")
except Exception as e:
    other.append(("EnsureLBItemIsVisible", type(e).__name__))
try:
    vs.ExpandAllLBItems(d, 10)
    done.append("ExpandAllLBItems")
except NotImplementedError:
    ni.append("ExpandAllLBItems")
except Exception as e:
    other.append(("ExpandAllLBItems", type(e).__name__))
try:
    vs.FindLBColumnDataItem(d, 10, 0, "x")
    done.append("FindLBColumnDataItem")
except NotImplementedError:
    ni.append("FindLBColumnDataItem")
except Exception as e:
    other.append(("FindLBColumnDataItem", type(e).__name__))
try:
    vs.FindLBColumnItem(d, 10, 0, "x")
    done.append("FindLBColumnItem")
except NotImplementedError:
    ni.append("FindLBColumnItem")
except Exception as e:
    other.append(("FindLBColumnItem", type(e).__name__))
try:
    vs.GetActivePane(d, 10)
    done.append("GetActivePane")
except NotImplementedError:
    ni.append("GetActivePane")
except Exception as e:
    other.append(("GetActivePane", type(e).__name__))
try:
    vs.GetIconPushButtonState(d, 10)
    done.append("GetIconPushButtonState")
except NotImplementedError:
    ni.append("GetIconPushButtonState")
except Exception as e:
    other.append(("GetIconPushButtonState", type(e).__name__))
try:
    vs.GetLBColumnDataItemInfo(d, 10, 0, 0)
    done.append("GetLBColumnDataItemInfo")
except NotImplementedError:
    ni.append("GetLBColumnDataItemInfo")
except Exception as e:
    other.append(("GetLBColumnDataItemInfo", type(e).__name__))
try:
    vs.GetLBColumnOwnerDrawnType(d, 10, 0, 0)
    done.append("GetLBColumnOwnerDrawnType")
except NotImplementedError:
    ni.append("GetLBColumnOwnerDrawnType")
except Exception as e:
    other.append(("GetLBColumnOwnerDrawnType", type(e).__name__))
try:
    vs.GetLBEditDisplayType(d, 16, 0)
    done.append("GetLBEditDisplayType")
except NotImplementedError:
    ni.append("GetLBEditDisplayType")
except Exception as e:
    other.append(("GetLBEditDisplayType", type(e).__name__))
try:
    vs.GetLBItemByClass(d, 10, 0, 0)
    done.append("GetLBItemByClass")
except NotImplementedError:
    ni.append("GetLBItemByClass")
except Exception as e:
    other.append(("GetLBItemByClass", type(e).__name__))
try:
    vs.GetLBItemDashStyle(d, 23, 0, 0)
    done.append("GetLBItemDashStyle")
except NotImplementedError:
    ni.append("GetLBItemDashStyle")
except Exception as e:
    other.append(("GetLBItemDashStyle", type(e).__name__))
try:
    vs.GetLBItemData(d, 10, 0, 0)
    done.append("GetLBItemData")
except NotImplementedError:
    ni.append("GetLBItemData")
except Exception as e:
    other.append(("GetLBItemData", type(e).__name__))
try:
    vs.GetLBItemDisplayType(d, 10, 0)
    done.append("GetLBItemDisplayType")
except NotImplementedError:
    ni.append("GetLBItemDisplayType")
except Exception as e:
    other.append(("GetLBItemDisplayType", type(e).__name__))
try:
    vs.GetLBItemFillBackColor(d, 10, 0, 0)
    done.append("GetLBItemFillBackColor")
except NotImplementedError:
    ni.append("GetLBItemFillBackColor")
except Exception as e:
    other.append(("GetLBItemFillBackColor", type(e).__name__))
try:
    vs.GetLBItemFillForeColor(d, 10, 0, 0)
    done.append("GetLBItemFillForeColor")
except NotImplementedError:
    ni.append("GetLBItemFillForeColor")
except Exception as e:
    other.append(("GetLBItemFillForeColor", type(e).__name__))
try:
    vs.GetLBItemGradientOrImageRefNumber(d, 24, 0, 0)
    done.append("GetLBItemGradientOrImageRefNumber")
except NotImplementedError:
    ni.append("GetLBItemGradientOrImageRefNumber")
except Exception as e:
    other.append(("GetLBItemGradientOrImageRefNumber", type(e).__name__))
try:
    vs.GetLBItemHatchRefNum(d, 10, 0, 0)
    done.append("GetLBItemHatchRefNum")
except NotImplementedError:
    ni.append("GetLBItemHatchRefNum")
except Exception as e:
    other.append(("GetLBItemHatchRefNum", type(e).__name__))
try:
    vs.GetLBItemLineType(d, 10, 0, 0)
    done.append("GetLBItemLineType")
except NotImplementedError:
    ni.append("GetLBItemLineType")
except Exception as e:
    other.append(("GetLBItemLineType", type(e).__name__))
try:
    vs.GetLBItemMkrByClass(d, 10, 0, 0)
    done.append("GetLBItemMkrByClass")
except NotImplementedError:
    ni.append("GetLBItemMkrByClass")
except Exception as e:
    other.append(("GetLBItemMkrByClass", type(e).__name__))
try:
    vs.GetLBItemMkrChoice(d, 24, 0, 0)
    done.append("GetLBItemMkrChoice")
except NotImplementedError:
    ni.append("GetLBItemMkrChoice")
except Exception as e:
    other.append(("GetLBItemMkrChoice", type(e).__name__))
try:
    vs.GetLBItemPatternIndex(d, 10, 0, 0)
    done.append("GetLBItemPatternIndex")
except NotImplementedError:
    ni.append("GetLBItemPatternIndex")
except Exception as e:
    other.append(("GetLBItemPatternIndex", type(e).__name__))
try:
    vs.GetLBItemPenBackColor(d, 10, 0, 0)
    done.append("GetLBItemPenBackColor")
except NotImplementedError:
    ni.append("GetLBItemPenBackColor")
except Exception as e:
    other.append(("GetLBItemPenBackColor", type(e).__name__))
try:
    vs.GetLBItemPenForeColor(d, 10, 0, 0)
    done.append("GetLBItemPenForeColor")
except NotImplementedError:
    ni.append("GetLBItemPenForeColor")
except Exception as e:
    other.append(("GetLBItemPenForeColor", type(e).__name__))
try:
    vs.GetLBItemTextJust(d, 16, 0, 0)
    done.append("GetLBItemTextJust")
except NotImplementedError:
    ni.append("GetLBItemTextJust")
except Exception as e:
    other.append(("GetLBItemTextJust", type(e).__name__))
try:
    vs.GetLBItemTileRefNum(d, 10, 0, 0)
    done.append("GetLBItemTileRefNum")
except NotImplementedError:
    ni.append("GetLBItemTileRefNum")
except Exception as e:
    other.append(("GetLBItemTileRefNum", type(e).__name__))
try:
    vs.GetLBMultImageIndexes(d, 24, 0, 0)
    done.append("GetLBMultImageIndexes")
except NotImplementedError:
    ni.append("GetLBMultImageIndexes")
except Exception as e:
    other.append(("GetLBMultImageIndexes", type(e).__name__))
try:
    vs.GetMultilineText(d, 16)
    done.append("GetMultilineText")
except NotImplementedError:
    ni.append("GetMultilineText")
except Exception as e:
    other.append(("GetMultilineText", type(e).__name__))
try:
    vs.GetNumLBColumnDataItems(d, 10, 0)
    done.append("GetNumLBColumnDataItems")
except NotImplementedError:
    ni.append("GetNumLBColumnDataItems")
except Exception as e:
    other.append(("GetNumLBColumnDataItems", type(e).__name__))
try:
    vs.GetPopUpChoiceIndex(d, 24, "x")
    done.append("GetPopUpChoiceIndex")
except NotImplementedError:
    ni.append("GetPopUpChoiceIndex")
except Exception as e:
    other.append(("GetPopUpChoiceIndex", type(e).__name__))
try:
    vs.HierLBItemClosed(d, 10, 0, True)
    done.append("HierLBItemClosed")
except NotImplementedError:
    ni.append("HierLBItemClosed")
except Exception as e:
    other.append(("HierLBItemClosed", type(e).__name__))
try:
    vs.HierLBItemIsClosed(d, 10, 0)
    done.append("HierLBItemIsClosed")
except NotImplementedError:
    ni.append("HierLBItemIsClosed")
except Exception as e:
    other.append(("HierLBItemIsClosed", type(e).__name__))
try:
    vs.HierLBItemIsContain(d, 10, 0)
    done.append("HierLBItemIsContain")
except NotImplementedError:
    ni.append("HierLBItemIsContain")
except Exception as e:
    other.append(("HierLBItemIsContain", type(e).__name__))
try:
    vs.HierLBItemOpened(d, 10, 0, True)
    done.append("HierLBItemOpened")
except NotImplementedError:
    ni.append("HierLBItemOpened")
except Exception as e:
    other.append(("HierLBItemOpened", type(e).__name__))
try:
    vs.InsertLBColumnDataItem(d, 10, 0, "x", "x", "x", 0)
    done.append("InsertLBColumnDataItem")
except NotImplementedError:
    ni.append("InsertLBColumnDataItem")
except Exception as e:
    other.append(("InsertLBColumnDataItem", type(e).__name__))
try:
    vs.InsertPropClassOrLayerItem(d, 24, "x", "x")
    done.append("InsertPropClassOrLayerItem")
except NotImplementedError:
    ni.append("InsertPropClassOrLayerItem")
except Exception as e:
    other.append(("InsertPropClassOrLayerItem", type(e).__name__))
try:
    vs.InsertProposedClassOrLayerItem(d, 24, "x", 0)
    done.append("InsertProposedClassOrLayerItem")
except NotImplementedError:
    ni.append("InsertProposedClassOrLayerItem")
except Exception as e:
    other.append(("InsertProposedClassOrLayerItem", type(e).__name__))
try:
    vs.IsItemEnabled(d, 10)
    done.append("IsItemEnabled")
except NotImplementedError:
    ni.append("IsItemEnabled")
except Exception as e:
    other.append(("IsItemEnabled", type(e).__name__))
try:
    vs.IsItemVisible(d, 10)
    done.append("IsItemVisible")
except NotImplementedError:
    ni.append("IsItemVisible")
except Exception as e:
    other.append(("IsItemVisible", type(e).__name__))
try:
    vs.IsLBColumnTrackingEnabled(d, 10, 0)
    done.append("IsLBColumnTrackingEnabled")
except NotImplementedError:
    ni.append("IsLBColumnTrackingEnabled")
except Exception as e:
    other.append(("IsLBColumnTrackingEnabled", type(e).__name__))
try:
    vs.IsLBDisplayHier(d, 10)
    done.append("IsLBDisplayHier")
except NotImplementedError:
    ni.append("IsLBDisplayHier")
except Exception as e:
    other.append(("IsLBDisplayHier", type(e).__name__))
try:
    vs.IsLBItemReadOnly(d, 10, 0, 0)
    done.append("IsLBItemReadOnly")
except NotImplementedError:
    ni.append("IsLBItemReadOnly")
except Exception as e:
    other.append(("IsLBItemReadOnly", type(e).__name__))
try:
    vs.IsLBReadOnly(d, 10)
    done.append("IsLBReadOnly")
except NotImplementedError:
    ni.append("IsLBReadOnly")
except Exception as e:
    other.append(("IsLBReadOnly", type(e).__name__))
try:
    vs.IsLBResOnlyCurDoc(d, 10, 0, 0)
    done.append("IsLBResOnlyCurDoc")
except NotImplementedError:
    ni.append("IsLBResOnlyCurDoc")
except Exception as e:
    other.append(("IsLBResOnlyCurDoc", type(e).__name__))
try:
    vs.RefreshLB(d, 10)
    done.append("RefreshLB")
except NotImplementedError:
    ni.append("RefreshLB")
except Exception as e:
    other.append(("RefreshLB", type(e).__name__))
try:
    vs.RemoveAllImagePopupItems(d, 24)
    done.append("RemoveAllImagePopupItems")
except NotImplementedError:
    ni.append("RemoveAllImagePopupItems")
except Exception as e:
    other.append(("RemoveAllImagePopupItems", type(e).__name__))
try:
    vs.RemoveAllLBColumnDataItems(d, 10, 0)
    done.append("RemoveAllLBColumnDataItems")
except NotImplementedError:
    ni.append("RemoveAllLBColumnDataItems")
except Exception as e:
    other.append(("RemoveAllLBColumnDataItems", type(e).__name__))
try:
    vs.RemoveLBColumnDataItem(d, 10, 0, 0)
    done.append("RemoveLBColumnDataItem")
except NotImplementedError:
    ni.append("RemoveLBColumnDataItem")
except Exception as e:
    other.append(("RemoveLBColumnDataItem", type(e).__name__))
try:
    vs.RemoveListBoxTabStop(d, 21)
    done.append("RemoveListBoxTabStop")
except NotImplementedError:
    ni.append("RemoveListBoxTabStop")
except Exception as e:
    other.append(("RemoveListBoxTabStop", type(e).__name__))
try:
    vs.SelectEditText(d, 16)
    done.append("SelectEditText")
except NotImplementedError:
    ni.append("SelectEditText")
except Exception as e:
    other.append(("SelectEditText", type(e).__name__))
try:
    vs.SetComponentIndeterminate(d, 10, True)
    done.append("SetComponentIndeterminate")
except NotImplementedError:
    ni.append("SetComponentIndeterminate")
except Exception as e:
    other.append(("SetComponentIndeterminate", type(e).__name__))
try:
    vs.SetComponentSize(d, 10, 0, 0)
    done.append("SetComponentSize")
except NotImplementedError:
    ni.append("SetComponentSize")
except Exception as e:
    other.append(("SetComponentSize", type(e).__name__))
try:
    vs.SetEdgeBinding(d, 10, True, True, True, True)
    done.append("SetEdgeBinding")
except NotImplementedError:
    ni.append("SetEdgeBinding")
except Exception as e:
    other.append(("SetEdgeBinding", type(e).__name__))
try:
    vs.SetEditColorTextStyl(d, 16, "x")
    done.append("SetEditColorTextStyl")
except NotImplementedError:
    ni.append("SetEditColorTextStyl")
except Exception as e:
    other.append(("SetEditColorTextStyl", type(e).__name__))
try:
    vs.SetFocusOnLB(d, 10)
    done.append("SetFocusOnLB")
except NotImplementedError:
    ni.append("SetFocusOnLB")
except Exception as e:
    other.append(("SetFocusOnLB", type(e).__name__))
try:
    vs.SetIconPushButtonState(d, 10, True)
    done.append("SetIconPushButtonState")
except NotImplementedError:
    ni.append("SetIconPushButtonState")
except Exception as e:
    other.append(("SetIconPushButtonState", type(e).__name__))
try:
    vs.SetImageControlPath(d, 24, "x")
    done.append("SetImageControlPath")
except NotImplementedError:
    ni.append("SetImageControlPath")
except Exception as e:
    other.append(("SetImageControlPath", type(e).__name__))
try:
    vs.SetItemClickable(d, 10, 0)
    done.append("SetItemClickable")
except NotImplementedError:
    ni.append("SetItemClickable")
except Exception as e:
    other.append(("SetItemClickable", type(e).__name__))
try:
    vs.SetLBColumnImage(d, 24, 0, 0)
    done.append("SetLBColumnImage")
except NotImplementedError:
    ni.append("SetLBColumnImage")
except Exception as e:
    other.append(("SetLBColumnImage", type(e).__name__))
try:
    vs.SetLBColumnOwnerDrawnType(d, 10, 0, 0, 0)
    done.append("SetLBColumnOwnerDrawnType")
except NotImplementedError:
    ni.append("SetLBColumnOwnerDrawnType")
except Exception as e:
    other.append(("SetLBColumnOwnerDrawnType", type(e).__name__))
try:
    vs.SetLBDragDropColumn(d, 10, 0)
    done.append("SetLBDragDropColumn")
except NotImplementedError:
    ni.append("SetLBDragDropColumn")
except Exception as e:
    other.append(("SetLBDragDropColumn", type(e).__name__))
try:
    vs.SetLBEditDisplayType(d, 16, 0, 0)
    done.append("SetLBEditDisplayType")
except NotImplementedError:
    ni.append("SetLBEditDisplayType")
except Exception as e:
    other.append(("SetLBEditDisplayType", type(e).__name__))
try:
    vs.SetLBHierDispColumn(d, 10, 10)
    done.append("SetLBHierDispColumn")
except NotImplementedError:
    ni.append("SetLBHierDispColumn")
except Exception as e:
    other.append(("SetLBHierDispColumn", type(e).__name__))
try:
    vs.SetLBItemByClass(d, 10, 0, 0, True)
    done.append("SetLBItemByClass")
except NotImplementedError:
    ni.append("SetLBItemByClass")
except Exception as e:
    other.append(("SetLBItemByClass", type(e).__name__))
try:
    vs.SetLBItemDashStyle(d, 23, 0, 0, 0, 0)
    done.append("SetLBItemDashStyle")
except NotImplementedError:
    ni.append("SetLBItemDashStyle")
except Exception as e:
    other.append(("SetLBItemDashStyle", type(e).__name__))
try:
    vs.SetLBItemData(d, 10, 0, 0, 0)
    done.append("SetLBItemData")
except NotImplementedError:
    ni.append("SetLBItemData")
except Exception as e:
    other.append(("SetLBItemData", type(e).__name__))
try:
    vs.SetLBItemDisplayType(d, 10, 0, 0)
    done.append("SetLBItemDisplayType")
except NotImplementedError:
    ni.append("SetLBItemDisplayType")
except Exception as e:
    other.append(("SetLBItemDisplayType", type(e).__name__))
try:
    vs.SetLBItemFillBackColor(d, 10, 0, 0, 0, 0, 0)
    done.append("SetLBItemFillBackColor")
except NotImplementedError:
    ni.append("SetLBItemFillBackColor")
except Exception as e:
    other.append(("SetLBItemFillBackColor", type(e).__name__))
try:
    vs.SetLBItemFillForeColor(d, 10, 0, 0, 0, 0, 0)
    done.append("SetLBItemFillForeColor")
except NotImplementedError:
    ni.append("SetLBItemFillForeColor")
except Exception as e:
    other.append(("SetLBItemFillForeColor", type(e).__name__))
try:
    vs.SetLBItemGradientOrImageRefNumber(d, 24, 0, 0, 0)
    done.append("SetLBItemGradientOrImageRefNumber")
except NotImplementedError:
    ni.append("SetLBItemGradientOrImageRefNumber")
except Exception as e:
    other.append(("SetLBItemGradientOrImageRefNumber", type(e).__name__))
try:
    vs.SetLBItemHatchRefNum(d, 10, 0, 0, 0)
    done.append("SetLBItemHatchRefNum")
except NotImplementedError:
    ni.append("SetLBItemHatchRefNum")
except Exception as e:
    other.append(("SetLBItemHatchRefNum", type(e).__name__))
try:
    vs.SetLBItemInfo(d, 10, 0, 0, "x", 0)
    done.append("SetLBItemInfo")
except NotImplementedError:
    ni.append("SetLBItemInfo")
except Exception as e:
    other.append(("SetLBItemInfo", type(e).__name__))
try:
    vs.SetLBItemInteracType(d, 10, 0, 0, 0)
    done.append("SetLBItemInteracType")
except NotImplementedError:
    ni.append("SetLBItemInteracType")
except Exception as e:
    other.append(("SetLBItemInteracType", type(e).__name__))
try:
    vs.SetLBItemLineType(d, 10, 0, 0, 0, 0)
    done.append("SetLBItemLineType")
except NotImplementedError:
    ni.append("SetLBItemLineType")
except Exception as e:
    other.append(("SetLBItemLineType", type(e).__name__))
try:
    vs.SetLBItemMkrByClass(d, 10, 0, 0, True)
    done.append("SetLBItemMkrByClass")
except NotImplementedError:
    ni.append("SetLBItemMkrByClass")
except Exception as e:
    other.append(("SetLBItemMkrByClass", type(e).__name__))
try:
    vs.SetLBItemMkrChoice(d, 24, 0, 0, 0, 0, 0, 0, 0, 0)
    done.append("SetLBItemMkrChoice")
except NotImplementedError:
    ni.append("SetLBItemMkrChoice")
except Exception as e:
    other.append(("SetLBItemMkrChoice", type(e).__name__))
try:
    vs.SetLBItemPatternIndex(d, 10, 0, 0, 0)
    done.append("SetLBItemPatternIndex")
except NotImplementedError:
    ni.append("SetLBItemPatternIndex")
except Exception as e:
    other.append(("SetLBItemPatternIndex", type(e).__name__))
try:
    vs.SetLBItemPenBackColor(d, 10, 0, 0, 0, 0, 0)
    done.append("SetLBItemPenBackColor")
except NotImplementedError:
    ni.append("SetLBItemPenBackColor")
except Exception as e:
    other.append(("SetLBItemPenBackColor", type(e).__name__))
try:
    vs.SetLBItemPenForeColor(d, 10, 0, 0, 0, 0, 0)
    done.append("SetLBItemPenForeColor")
except NotImplementedError:
    ni.append("SetLBItemPenForeColor")
except Exception as e:
    other.append(("SetLBItemPenForeColor", type(e).__name__))
try:
    vs.SetLBItemReadOnly(d, 10, 0, 0, 0)
    done.append("SetLBItemReadOnly")
except NotImplementedError:
    ni.append("SetLBItemReadOnly")
except Exception as e:
    other.append(("SetLBItemReadOnly", type(e).__name__))
try:
    vs.SetLBItemTextColorN(d, 16, 0, 0, 0)
    done.append("SetLBItemTextColorN")
except NotImplementedError:
    ni.append("SetLBItemTextColorN")
except Exception as e:
    other.append(("SetLBItemTextColorN", type(e).__name__))
try:
    vs.SetLBItemTextJust(d, 16, 0, 0, 0)
    done.append("SetLBItemTextJust")
except NotImplementedError:
    ni.append("SetLBItemTextJust")
except Exception as e:
    other.append(("SetLBItemTextJust", type(e).__name__))
try:
    vs.SetLBItemTileRefNum(d, 10, 0, 0, 0)
    done.append("SetLBItemTileRefNum")
except NotImplementedError:
    ni.append("SetLBItemTileRefNum")
except Exception as e:
    other.append(("SetLBItemTileRefNum", type(e).__name__))
try:
    vs.SetLBItemUsingColumnDataItem(d, 10, 0, 0, 0)
    done.append("SetLBItemUsingColumnDataItem")
except NotImplementedError:
    ni.append("SetLBItemUsingColumnDataItem")
except Exception as e:
    other.append(("SetLBItemUsingColumnDataItem", type(e).__name__))
try:
    vs.SetLBMultImageIndexes(d, 24, 0, 0, 0, 0, 0)
    done.append("SetLBMultImageIndexes")
except NotImplementedError:
    ni.append("SetLBMultImageIndexes")
except Exception as e:
    other.append(("SetLBMultImageIndexes", type(e).__name__))
try:
    vs.SetLBReadOnly(d, 10, 0)
    done.append("SetLBReadOnly")
except NotImplementedError:
    ni.append("SetLBReadOnly")
except Exception as e:
    other.append(("SetLBReadOnly", type(e).__name__))
try:
    vs.SetLBResOnlyCurDoc(d, 10, 0, 0, 0)
    done.append("SetLBResOnlyCurDoc")
except NotImplementedError:
    ni.append("SetLBResOnlyCurDoc")
except Exception as e:
    other.append(("SetLBResOnlyCurDoc", type(e).__name__))
try:
    vs.SetLBSortColumn(d, 10, 0, True)
    done.append("SetLBSortColumn")
except NotImplementedError:
    ni.append("SetLBSortColumn")
except Exception as e:
    other.append(("SetLBSortColumn", type(e).__name__))
try:
    vs.SetLayoutDialogPosition(d, 0, 0)
    done.append("SetLayoutDialogPosition")
except NotImplementedError:
    ni.append("SetLayoutDialogPosition")
except Exception as e:
    other.append(("SetLayoutDialogPosition", type(e).__name__))
try:
    vs.SetLayoutDialogSize(d, 0, 0)
    done.append("SetLayoutDialogSize")
except NotImplementedError:
    ni.append("SetLayoutDialogSize")
except Exception as e:
    other.append(("SetLayoutDialogSize", type(e).__name__))
try:
    vs.SetLayoutOption(d, 0, 0)
    done.append("SetLayoutOption")
except NotImplementedError:
    ni.append("SetLayoutOption")
except Exception as e:
    other.append(("SetLayoutOption", type(e).__name__))
try:
    vs.SetListBoxTabStops(d, 21, 0)
    done.append("SetListBoxTabStops")
except NotImplementedError:
    ni.append("SetListBoxTabStops")
except Exception as e:
    other.append(("SetListBoxTabStops", type(e).__name__))
try:
    vs.SetProportionalBinding(d, 10, 0, 0, 0, True)
    done.append("SetProportionalBinding")
except NotImplementedError:
    ni.append("SetProportionalBinding")
except Exception as e:
    other.append(("SetProportionalBinding", type(e).__name__))
try:
    vs.SetSelectionRange(d, 10, 0, 0)
    done.append("SetSelectionRange")
except NotImplementedError:
    ni.append("SetSelectionRange")
except Exception as e:
    other.append(("SetSelectionRange", type(e).__name__))
try:
    vs.SetStaticTextColorN(d, 16, 0)
    done.append("SetStaticTextColorN")
except NotImplementedError:
    ni.append("SetStaticTextColorN")
except Exception as e:
    other.append(("SetStaticTextColorN", type(e).__name__))
try:
    vs.ShowLBHeader(d, 10, True)
    done.append("ShowLBHeader")
except NotImplementedError:
    ni.append("ShowLBHeader")
except Exception as e:
    other.append(("ShowLBHeader", type(e).__name__))
try:
    vs.ShowLBItemByClassOpt(d, 10, 0, 0, True)
    done.append("ShowLBItemByClassOpt")
except NotImplementedError:
    ni.append("ShowLBItemByClassOpt")
except Exception as e:
    other.append(("ShowLBItemByClassOpt", type(e).__name__))
try:
    vs.ShowLBItemMkrByClass(d, 10, 0, 0, True)
    done.append("ShowLBItemMkrByClass")
except NotImplementedError:
    ni.append("ShowLBItemMkrByClass")
except Exception as e:
    other.append(("ShowLBItemMkrByClass", type(e).__name__))
try:
    vs.ShowLBItemMkrEditLst(d, 16, 0, 0, True)
    done.append("ShowLBItemMkrEditLst")
except NotImplementedError:
    ni.append("ShowLBItemMkrEditLst")
except Exception as e:
    other.append(("ShowLBItemMkrEditLst", type(e).__name__))
try:
    vs.UpdateImageControl2(d, 24, "x")
    done.append("UpdateImageControl2")
except NotImplementedError:
    ni.append("UpdateImageControl2")
except Exception as e:
    other.append(("UpdateImageControl2", type(e).__name__))
try:
    vs.UpdateImageControl3(d, 24, "x")
    done.append("UpdateImageControl3")
except NotImplementedError:
    ni.append("UpdateImageControl3")
except Exception as e:
    other.append(("UpdateImageControl3", type(e).__name__))
try:
    vs.UpdateSymDispCtrlN(d, 25, "x", 0, 0, 25, 0)
    done.append("UpdateSymDispCtrlN")
except NotImplementedError:
    ni.append("UpdateSymDispCtrlN")
except Exception as e:
    other.append(("UpdateSymDispCtrlN", type(e).__name__))
try:
    vs.UpdateSymbolDisplayControl(d, 25, "x", 0, 0)
    done.append("UpdateSymbolDisplayControl")
except NotImplementedError:
    ni.append("UpdateSymbolDisplayControl")
except Exception as e:
    other.append(("UpdateSymbolDisplayControl", type(e).__name__))
print("done", len(done))
print("ni", ni)
print("other", other)
bugs = [x for x in other if x[1] in ("TypeError", "AttributeError", "NameError", "KeyError")]
print("bugs", bugs)
print("ids", len(done) + len(other) + len(ni))
def handler8(item, data):
    return None
vs.RunLayoutDialogN(d, handler8, False)
print("runN ok")`;
  const r = ranVs(code, {});
  const lines = r.printed.trim().split("\n");
  assert.ok(lines.includes("ni []"), "no added call raises NotImplementedError");
  assert.ok(lines.includes("bugs []"), "no added call fails with a Python bug type");
  assert.ok(lines.includes("runN ok"), "RunLayoutDialogN runs with a handler");
}

console.log("layout dialogs: ok");


