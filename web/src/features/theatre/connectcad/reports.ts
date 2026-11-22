// ConnectCAD's report commands: Current Layer and All Layers Circuit Report, Current Layer Device
// Report, Device Connections Report and ConnectCAD Parts Report, each a new worksheet listing the
// schematic as it is now (ccadReports.ts has the rows); externals are only in the connections
// report.

import "./connectcad.css";
import { attempt } from "../../../app/commands.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { editWorksheet } from "../../../app/worksheetEditor.ts";
import { circuitRows, connectionRows, deviceRows, freeName, partRows, reportSheet, type ReportRow } from "./ccadReports.ts";
import { reportFacts } from "./schematic.ts";

/** Makes worksheet `name` of `rows` and opens it. */
export async function report(name: string, rows: readonly ReportRow[]): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const resources = doc.resources();
  const sheet = reportSheet(freeName(name, new Set(resources.map((r) => r.name))), rows);
  const made = attempt(name, (s) => s.createWorksheet(sheet));
  if (made) await editWorksheet(made.value);
}

const facts = (current: boolean) => {
  const s = store.session;
  return s ? reportFacts(s, current ? (store.activeLayerId ?? undefined) : undefined) : null;
};

export async function circuitReport(current: boolean): Promise<void> {
  const f = facts(current);
  if (!f) return;
  if (!f.circuits.length) return toast(current ? "There are no ConnectCAD circuits on the active layer." : "There are no ConnectCAD circuits in this drawing.", "info");
  await report(current ? "Current Layer Circuit Report" : "All Layers Circuit Report", circuitRows(f.circuits, !current));
}

export async function deviceReport(): Promise<void> {
  const devices = facts(true)?.devices.filter((d) => !d.external);
  if (!devices) return;
  if (!devices.length) return toast("There are no ConnectCAD devices on the active layer.", "info");
  await report("Current Layer Device Report", deviceRows(devices));
}

export async function connectionsReport(): Promise<void> {
  const f = facts(false);
  if (!f) return;
  if (!f.devices.length) return toast("There are no ConnectCAD devices in this drawing.", "info");
  await report("Device Connections Report", connectionRows(f.devices));
}

export async function partsReport(): Promise<void> {
  const devices = facts(false)?.devices.filter((d) => !d.external);
  if (!devices) return;
  if (!devices.length) return toast("There are no ConnectCAD devices in this drawing.", "info");
  await report("ConnectCAD Parts Report", partRows(devices));
}
