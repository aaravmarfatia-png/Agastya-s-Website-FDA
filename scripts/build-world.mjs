// Builds data/world-50m.json: the world-atlas 50m TopoJSON with an ISO3 code on each country.
// world-atlas uses ISO 3166-1 numeric ids; i18n-iso-countries maps them to alpha-3.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const countries = require("i18n-iso-countries");

const topo = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-50m.json", import.meta.url)));
// A few territories without an official numeric code in world-atlas
const EXTRA = { "Kosovo": "XKX", "N. Cyprus": "CYN", "Somaliland": "SOL", "Indian Ocean Ter.": "IOT", "Siachen Glacier": "SIA", "Ashmore and Cartier Is.": "AUS" };
let missing = [];
for (const g of topo.objects.countries.geometries) {
  const iso3 = g.id ? countries.numericToAlpha3(g.id) : null;
  g.properties.iso3 = iso3 || EXTRA[g.properties.name] || null;
  if (!g.properties.iso3) missing.push(g.properties.name);
}
writeFileSync(new URL("../data/world-50m.json", import.meta.url), JSON.stringify(topo));
console.log(`wrote data/world-50m.json · ${topo.objects.countries.geometries.length} shapes · no ISO3: ${missing.join(", ") || "none"}`);
