// The size of one document unit, in millimetres, and the spelling rules that find a unit's table
// entry. Core code (the formula engine, the database rows) needs these without the app's
// formatting; app/units.ts re-exports millimetresPerUnit and builds the labels on top of keyOf.

/** British spellings of the unit names below, which the tables do not list. */
const ALIASES: Readonly<Record<string, string>> = {
  millimetres: "millimeters",
  centimetres: "centimeters",
  metres: "meters",
  kilometres: "kilometers",
  "feet & inches": "feet and inches",
};

/** The document's unit name in the spelling the tables use, lower case; "" when the document names none. */
export function keyOf(units: string | undefined): string {
  const key = (units ?? "").toLowerCase();
  return ALIASES[key] ?? key;
}

const MM_PER_UNIT: Readonly<Record<string, number>> = {
  millimeters: 1,
  centimeters: 10,
  meters: 1000,
  kilometers: 1e6,
  inches: 25.4,
  feet: 304.8,
  "feet and inches": 304.8,
  yards: 914.4,
  miles: 1609344,
};

/** Millimetres in one document unit; 1 (millimetres) when the document names none or an unknown one. */
export function millimetresPerUnit(units: string | undefined): number {
  if (!units) return 1;
  return MM_PER_UNIT[keyOf(units)] ?? 1;
}
