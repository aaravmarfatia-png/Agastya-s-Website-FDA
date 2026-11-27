// Common names people search for, mapped to ISO3 (official names differ: "Türkiye", "Côte d'Ivoire", "Czechia"…).
// Plain script-compatible: also exposed as window.FSW_ALIASES for the classic-script country finder.
export const ALIASES = {
  TUR: ["Turkey"], CIV: ["Ivory Coast"], CZE: ["Czech Republic"], MMR: ["Burma"], SWZ: ["Swaziland"],
  CPV: ["Cape Verde"], TLS: ["East Timor"], VNM: ["Vietnam"], KOR: ["Korea", "South Korea"], PRK: ["Korea, North", "DPRK"],
  GBR: ["UK", "Britain", "Great Britain", "England"], USA: ["US", "USA", "America", "United States of America"],
  NLD: ["Holland"], MKD: ["Macedonia"], COD: ["DRC", "Congo-Kinshasa", "Democratic Republic of the Congo"],
  COG: ["Congo-Brazzaville", "Republic of the Congo"], RUS: ["Russian Federation"], IRN: ["Persia"], LAO: ["Lao"],
  SYR: ["Syrian Arab Republic"], TZA: ["United Republic of Tanzania"], BOL: ["Bolivia"], VEN: ["Venezuela"],
  MDA: ["Republic of Moldova"], FSM: ["Federated States of Micronesia"], ARE: ["UAE", "Emirates"], STP: ["Sao Tome"],
};
if (typeof window !== "undefined") window.FSW_ALIASES = ALIASES;
