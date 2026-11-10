#!/usr/bin/env node
// Converts the CSO PxStat table RIA02 (RTB Average Monthly Rent Report, JSON-stat 2.0)
// into data/rents.json, the small lookup file the API reads at startup.
//
// Usage:  node data/scripts/build-rents.mjs [raw-file] [out-file] [year]
// Defaults: data/raw/RIA02.json -> data/rents.json, latest year in the file.
//
// Rules:
// - Only "All property types" values are used (by bedroom count).
// - Values are rounded to the nearest euro. Missing (suppressed) values are left out.
// - No number is computed or estimated: every value is a cell from the raw table.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rawPath = resolve(process.argv[2] ?? `${here}/../raw/RIA02.json`);
const outPath = resolve(process.argv[3] ?? `${here}/../rents.json`);

const d = JSON.parse(readFileSync(rawPath, "utf8"));
const ids = d.id;
const size = d.size;
const index = ids.map((k) => d.dimension[k].category.index);

const DIM_TIME = ids.find((k) => k.startsWith("TLIST"));
const DIM_BEDS = "C02970V03592"; // Number of Bedrooms
const DIM_TYPE = "C02969V03591"; // Property Type
const DIM_LOC = "C03004V03625"; // Location
for (const k of [DIM_TIME, DIM_BEDS, DIM_TYPE, DIM_LOC]) {
  if (!ids.includes(k)) throw new Error(`Unexpected table layout: missing dimension ${k}`);
}

function get(sel) {
  // sel: { dimId: categoryCode }
  let off = 0;
  for (let i = 0; i < ids.length; i++) {
    const code = ids[i] === "STATISTIC" ? index[i][0] : sel[ids[i]];
    const pos = index[i].indexOf(code);
    if (pos < 0) throw new Error(`Unknown code ${code} in ${ids[i]}`);
    off = off * size[i] + pos;
  }
  const v = d.value[off];
  return v === null || v === undefined ? undefined : v;
}

const times = d.dimension[DIM_TIME].category.index;
const period = process.argv[4] ?? times[times.length - 1];
const locCat = d.dimension[DIM_LOC].category;

// Output key -> CSO bedroom code (property type fixed to "-" = All property types)
const BEDS = { all: "-", "1bed": "01", "2bed": "02", "3bed": "03", "4plusbed": "08" };

const areas = {};
const locLabels = [];
for (const code of locCat.index) {
  const label = locCat.label[code].replace(/\s+,/g, ",").trim(); // "Kilmainham , Dublin 8" -> "Kilmainham, Dublin 8"
  locLabels.push(label);
  const row = {};
  for (const [key, bed] of Object.entries(BEDS)) {
    const v = get({ [DIM_TIME]: period, [DIM_BEDS]: bed, [DIM_TYPE]: "-", [DIM_LOC]: code });
    if (v !== undefined) row[key] = Math.round(v);
  }
  if (Object.keys(row).length) areas[label] = row;
}

// ---- Dublin postal districts --------------------------------------------------------
// RIA02 has "Dublin 1" ... "Dublin 24" totals, but they are empty after 2021.
// For each district we list the RIA02 neighbourhoods inside it that DO have data for
// the period, plus the county "Dublin" figure as a fallback. Nothing is averaged.
const DISTRICTS = ["1", "2", "3", "4", "5", "6", "6W", "7", "8", "9", "10", "11", "12",
  "13", "14", "15", "16", "17", "18", "20", "22", "24"];
const postal_districts = {};
for (const n of DISTRICTS) {
  const name = `Dublin ${n}`;
  const neighbourhoods = locLabels.filter((l) => l.endsWith(`, ${name}`) && areas[l]);
  postal_districts[name] = {
    district_total_available: Boolean(areas[name]),
    fallback: "Dublin",
    neighbourhoods,
  };
}

// ---- Aliases (match case-insensitively in the API) ------------------------------------
const aliases = {};
// Postal district short forms and Eircode routing keys (D01..D24, D6W).
for (const n of DISTRICTS) {
  const name = `Dublin ${n}`;
  const pad = /^\d$/.test(n) ? `0${n}` : n;
  for (const a of [`D${n}`, `D${pad}`, `Dublin${n}`, `Dublin ${pad}`]) if (a !== name) aliases[a] = name;
}
// "Co. X" / "County X" -> county. A county is a location label with no comma that has
// sub-areas "<place>, X".
const counties = locLabels.filter((l) => !l.includes(",") && !/^Dublin \d/.test(l) &&
  locLabels.some((m) => m.endsWith(`, ${l}`)));
for (const c of counties) {
  aliases[`Co. ${c}`] = c;
  aliases[`Co ${c}`] = c;
  aliases[`County ${c}`] = c;
}
// Neighbourhood short names, only when the short name is unique across the whole table
// and does not clash with another label. E.g. "Rathmines" -> "Rathmines, Dublin 6".
// Ambiguous ones (Blackrock: Cork + Dublin; Ballymun: Dublin 9 + 11; Drogheda: Louth +
// Meath) are deliberately left out.
const shortCount = {};
for (const l of locLabels) if (l.includes(",")) {
  const s = l.split(",")[0].trim();
  shortCount[s] = (shortCount[s] ?? 0) + 1;
}
for (const l of locLabels) if (l.includes(",") && areas[l]) {
  const s = l.split(",")[0].trim();
  if (shortCount[s] === 1 && !locLabels.includes(s) && !aliases[s]) aliases[s] = l;
}

const out = {
  source: "RTB / CSO RIA02",
  source_url: "https://data.cso.ie/table/RIA02",
  api_url: "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en",
  licence: "CC BY 4.0",
  attribution: "Source: Residential Tenancies Board (RTB), RTB Average Monthly Rent Report (CSO PxStat table RIA02), licensed under CC BY 4.0. Values rounded to the nearest euro.",
  table_updated: d.updated,
  period,
  period_type: "calendar year",
  unit: "EUR per month, mean of registered tenancies (all property types)",
  keys: { all: "All bedrooms", "1bed": "One bed", "2bed": "Two bed", "3bed": "Three bed", "4plusbed": "Four plus bed" },
  notes: [
    "Missing values are suppressed or absent in the source and are left out, never estimated.",
    "Dublin postal district totals (Dublin 1-24) are empty in RIA02 after 2021. Use postal_districts[...].neighbourhoods if the listing names one, else the 'Dublin' county figure.",
  ],
  areas,
  postal_districts,
  aliases,
};

writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${outPath}: period ${period}, ${Object.keys(areas).length} areas, ${Object.keys(aliases).length} aliases`);
