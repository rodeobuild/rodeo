// Checks a sheet layer's page under Node: a sheet made in a drawing has its page from the start
// (ISO A3 landscape in metric drawings, Tabloid in feet and inches), Page Setup's page is stored
// in the sheet's record and reads back after saving and reopening, and a sheet copied from one
// with a page keeps that page. Run from web/: npx tsx src/core/sheetPage.check.ts

import assert from "node:assert/strict";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import { defaultSheetPage } from "./settings.ts";

const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;
const pageOf = (s: ReturnType<typeof openVwx>, name: string) => s.doc.layers().find((l) => l.name === name)?.page;

// metric: a new sheet has ISO A3 landscape and can take a page
{
  const s = openVwx(blankDrawing("mm"), "metric.vwx");
  const id = s.createLayer("Sheet-1", "sheet");
  const layer = s.doc.layers().find((l) => l.id === id)!;
  assert.equal(layer.kind, "sheet");
  assert.equal(layer.canHoldPage, true, "a new sheet's record has room for a page");
  assert.ok(near(layer.page?.width, 420) && near(layer.page?.height, 297), `new metric sheet page is A3 landscape (got ${JSON.stringify(layer.page)})`);
  console.log("ok   new metric sheet has A3 landscape");

  s.setSheetPage(id, { width: 841, height: 594 });
  assert.ok(near(pageOf(s, "Sheet-1")?.width, 841) && near(pageOf(s, "Sheet-1")?.height, 594), "page set to ISO A1 reads back 841 x 594");
  console.log("ok   Page Setup's ISO A1 reads back 841 x 594");

  // saved and reopened, the page is still there
  const again = openVwx(s.doc.toBytes(), "metric-again.vwx");
  const back = again.doc.layers().find((l) => l.name === "Sheet-1");
  assert.ok(near(back?.page?.width, 841) && near(back?.page?.height, 594), `page survives save and reopen (got ${JSON.stringify(back?.page)})`);
  console.log("ok   page survives save and reopen");

  // a sheet copied from this one keeps its page, not the default
  const copy = s.createLayer("Sheet-2", "sheet");
  const copied = s.doc.layers().find((l) => l.id === copy)!;
  assert.ok(near(copied.page?.width, 841) && near(copied.page?.height, 594), `a sheet copied from one with a page keeps that page (got ${JSON.stringify(copied.page)})`);
  console.log("ok   a sheet copied from one with a page keeps its page");
}

// feet and inches: Tabloid
{
  const s = openVwx(blankDrawing("ftin"), "imperial.vwx");
  assert.equal(s.doc.info.units, "Feet & Inches");
  const id = s.createLayer("Sheet-1", "sheet");
  const layer = s.doc.layers().find((l) => l.id === id)!;
  assert.ok(near(layer.page?.width, 17 * 25.4) && near(layer.page?.height, 11 * 25.4), `new imperial sheet page is Tabloid (got ${JSON.stringify(layer.page)})`);
  console.log("ok   new feet and inches sheet has Tabloid 17 x 11 in");
}

// the default by unit system
{
  assert.deepEqual(defaultSheetPage("Millimeters"), { width: 420, height: 297 });
  assert.deepEqual(defaultSheetPage("Meters"), { width: 420, height: 297 });
  assert.deepEqual(defaultSheetPage(undefined), { width: 420, height: 297 });
  assert.deepEqual(defaultSheetPage("Feet & Inches"), { width: 17 * 25.4, height: 11 * 25.4 });
  assert.deepEqual(defaultSheetPage("Inches"), { width: 17 * 25.4, height: 11 * 25.4 });
  assert.deepEqual(defaultSheetPage("Feet"), { width: 17 * 25.4, height: 11 * 25.4 });
  console.log("ok   default page by unit system");
}

// a design layer has no page to set
{
  const s = openVwx(blankDrawing("mm"), "design.vwx");
  const design = s.doc.layers().find((l) => l.kind === "design")!;
  assert.equal(design.canHoldPage, undefined);
  assert.throws(() => s.setSheetPage(design.id, { width: 100, height: 100 }), /only a sheet layer/);
  console.log("ok   a design layer refuses a page");
}

console.log("sheetPage checks passed");
