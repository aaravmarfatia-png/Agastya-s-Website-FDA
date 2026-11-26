// Food-safety issues (official sources only) + 3D beacons and arcs.
//  * snapshot: data/crises.json from fetch_crises.py
//      openFDA food recalls (U.S. FDA), WHO Disease Outbreak News (foodborne/waterborne & contamination),
//      ReliefWeb foodborne/waterborne epidemics (UN OCHA)
//  * national recall feeds already on the site (window.FEED_DATA): FDA, CDC, UK FSA, CFIA
//  * live refresh in the browser: openFDA + WHO DON (both CORS-enabled)
//  Only food-safety items are shown. The future part of the timeline is a straight-line trend
//  of past yearly counts, not a forecast.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { latLonToVec3, hash01, DAY_MS } from "./util.js";

// Beacon colours by kind of issue (validated categorical palette on the dark 4D surface, same order)
export const GROUPS = {
  recall: { label: "Food recall", color: "#4790dc" },
  contamination: { label: "Contamination & adulteration", color: "#dc6a3f" },
  outbreak: { label: "Foodborne & waterborne outbreak", color: "#a674d6" },
  alert: { label: "Food safety alert", color: "#b98d25" },
};
const ACTIVE_DAYS = { recall: 120, contamination: 180, outbreak: 120, alert: 60 };

// Same rules as fetch_crises.py
const FOODBORNE = /cholera|typhoid|paratyphoid|hepatitis ?[ae]\b|botulism|salmonell|listeri|e\.? ?coli|escherichia|shiga|stec|ehec|haemolytic uraemic|hemolytic uremic|shigell|dysentery|campylobacter|vibrio|norovirus|cyclospora|trichinell|brucell|food[- ]?borne|food poisoning|acute watery diarrh|diarrh/i;
const CHEMICAL = /methanol|melamine|aflatoxin|mycotoxin|lead poisoning|\blead\b(?!\s+to\b)|mercury|arsenic|pesticide poisoning|adulterat|contaminated (food|oil|flour|milk)/i;
const classify = (text) => (CHEMICAL.test(text) ? "contamination" : FOODBORNE.test(text) ? "outbreak" : null);

const US_STATES = "AL32.8,-86.8|AK64.2,-149.5|AZ34.3,-111.7|AR34.9,-92.4|CA37.2,-119.5|CO39,-105.5|CT41.6,-72.7|DE39,-75.5|DC38.9,-77|FL28.6,-82.4|GA32.7,-83.4|HI20.8,-156.3|ID44.4,-114.6|IL40,-89.2|IN39.9,-86.3|IA42.1,-93.5|KS38.5,-98.4|KY37.5,-85.3|LA31.1,-92|ME45.4,-69.2|MD39,-76.8|MA42.3,-71.8|MI44.3,-85.4|MN46.3,-94.3|MS32.7,-89.7|MO38.4,-92.5|MT47,-109.6|NE41.5,-99.8|NV39.3,-116.6|NH43.7,-71.6|NJ40.2,-74.7|NM34.4,-106.1|NY42.9,-75.5|NC35.6,-79.4|ND47.5,-100.5|OH40.3,-82.8|OK35.6,-97.5|OR43.9,-120.6|PA40.9,-77.8|RI41.7,-71.5|SC33.9,-80.9|SD44.4,-100.2|TN35.9,-86.4|TX31.5,-99.3|UT39.3,-111.7|VT44.1,-72.7|VA37.5,-78.8|WA47.4,-120.5|WV38.6,-80.6|WI44.6,-89.9|WY43,-107.6|PR18.2,-66.5"
  .split("|").reduce((o, s) => { const [lat, lon] = s.slice(2).split(",").map(Number); o[s.slice(0, 2)] = [lat, lon]; return o; }, {});
const FEED_REGION = { "United States": "USA", "United Kingdom": "GBR", Canada: "CAN" };
const FDA_COUNTRY = { "Korea (the Republic of)": "KOR", "Dominican Republic (the)": "DOM", Vietnam: "VNM", Taiwan: "TWN", "United States": "USA" };

function mkEvent(e) {
  const date = Date.parse(e.date);
  return { ...e, date, end: date + (ACTIVE_DAYS[e.group] || 90) * DAY_MS };
}

export async function loadCrises(countryMeta, { signal }) {
  const snap = await (await fetch("data/crises.json", { signal })).json();
  const events = snap.items.filter((i) => i.date && GROUPS[i.group]).map(mkEvent);

  // recalls & alerts from the national feeds the site already collects (data/feed.js)
  const names = Object.values(countryMeta).sort((a, b) => b.name.length - a.name.length);
  // only the site's food feeds: CPSC / Health Canada product recalls and FDA's mixed drug & device feed are
  // consumer-protection items, not food safety, so they stay on the main site but not on the globe
  const FOOD_FEEDS = new Set(["fda-food-recalls", "fda-allergies", "cdc-food-safety", "uk-fsa-alerts", "cfia-recalls", "who-news", "fao-news"]);
  for (const f of (window.FEED_DATA && window.FEED_DATA.items) || []) {
    if (!f.date || !FOOD_FEEDS.has(f.source)) continue;
    let iso = FEED_REGION[f.region];
    if (!iso && f.region === "Global (UN)") iso = names.find((c) => f.title.includes(c.name))?.iso3;
    if (!iso || !countryMeta[iso]) continue;
    const text = `${f.title} ${f.summary}`;
    // UN news is broad (hunger, nutrition…): keep it only when it names a food-safety hazard
    const unNews = f.source === "who-news" || f.source === "fao-news";
    if (unNews && !classify(text)) continue;
    const group = classify(text) === "contamination" ? "contamination" : f.category === "Recall" ? "recall" : unNews ? classify(text) : "alert";
    const c = countryMeta[iso], spread = iso === "USA" ? [16, 40] : iso === "CAN" ? [6, 30] : [3, 3];
    const center = iso === "USA" ? [39, -98] : iso === "CAN" ? [50, -95] : [c.lat, c.lon];
    events.push(mkEvent({
      iso3: [iso], home: iso, lat: center[0] + (hash01(f.link) - 0.5) * spread[0], lon: center[1] + (hash01(f.link + "x") - 0.5) * spread[1],
      date: f.date, group, label: GROUPS[group].label, title: f.title, detail: f.summary, weight: group === "recall" ? 0.6 : 0.5, url: f.link, source: f.agency,
    }));
  }
  const seen = new Set();
  const unique = events.filter((e) => (seen.has(e.url) ? false : seen.add(e.url)));
  return { events: unique, yearly: snap.yearly || {}, generated: snap.generated, liveStatus: "snapshot" };
}

/** Top up with live official data. Resolves with the number of new items (0 on any failure). */
export async function refreshLive(store, countryMeta, { signal }) {
  const timeout = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : signal;
  const seen = new Set(store.events.map((e) => e.url));
  const byName = Object.fromEntries(Object.values(countryMeta).map((c) => [c.name, c.iso3]));
  let added = 0;
  const base = "https://api.fda.gov/food/enforcement.json";
  const jobs = [
    fetch(`${base}?sort=report_date:desc&limit=100`, { signal: timeout }).then((r) => r.json()).then((d) => {
      for (const r of d.results || []) {
        const url = `${base}?search=recall_number:%22${encodeURIComponent(r.recall_number)}%22`;
        if (seen.has(url)) continue;
        const iso = FDA_COUNTRY[r.country] || byName[r.country];
        const at = iso === "USA" ? US_STATES[r.state] : countryMeta[iso] && [countryMeta[iso].lat, countryMeta[iso].lon];
        if (!iso || !at) continue;
        const reason = r.reason_for_recall || "";
        const group = CHEMICAL.test(reason) ? "contamination" : "recall";
        const ymd = r.report_date || r.recall_initiation_date || "";
        store.events.push(mkEvent({
          iso3: [iso], home: iso, lat: at[0] + (hash01(url) - 0.5) * 2.5, lon: at[1] + (hash01(url + "x") - 0.5) * 2.5,
          date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`, group,
          label: `${GROUPS[group].label}${r.classification ? " · " + r.classification : ""}`,
          title: `${r.recalling_firm}: ${String(r.product_description || "").slice(0, 110)}`, detail: "Reason: " + reason.slice(0, 260),
          weight: { "Class I": 1, "Class II": 0.6, "Class III": 0.35 }[r.classification] || 0.5, url, source: "U.S. FDA (openFDA)",
        }));
        seen.add(url); added++;
      }
    }),
    fetch("https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDateAndTime%20desc&$top=50&$select=Title,PublicationDateAndTime,UrlName", { signal: timeout })
      .then((r) => r.json()).then((d) => {
        const names = Object.values(countryMeta).sort((a, b) => b.name.length - a.name.length);
        for (const o of d.value || []) {
          const group = classify(o.Title);
          const url = "https://www.who.int/emergencies/disease-outbreak-news/item/" + o.UrlName;
          if (!group || seen.has(url)) continue;
          let rest = o.Title; const isos = [];
          for (const c of names) if (rest.includes(c.name)) { isos.push(c.iso3); rest = rest.replace(c.name, " "); }
          if (!isos.length) continue;
          const c = countryMeta[isos[0]];
          store.events.push(mkEvent({
            iso3: isos, home: isos[0], lat: c.lat + (hash01(url) - 0.5) * 3, lon: c.lon + (hash01(url + "x") - 0.5) * 3,
            date: o.PublicationDateAndTime, group, label: GROUPS[group].label, title: o.Title, weight: 0.85, url, source: "WHO Disease Outbreak News",
          }));
          seen.add(url); added++;
        }
      }),
  ];
  const res = await Promise.allSettled(jobs);
  store.liveStatus = res.some((r) => r.status === "fulfilled") ? "live" : "snapshot";
  return added;
}

/** Yearly food-safety record counts per country (complete counts from the snapshot) + linear trend. */
export function buildTrends(store, nowMs) {
  const year = new Date(nowMs).getUTCFullYear();
  const trends = new Map();
  for (const [iso, byYear] of Object.entries(store.yearly)) {
    const counts = Array.from({ length: 10 }, (_, i) => byYear[String(year - 9 + i)] || 0);
    if (!counts.some(Boolean)) continue;
    const n = counts.length, mx = (n - 1) / 2, my = counts.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    counts.forEach((c, x) => { num += (x - mx) * (c - my); den += (x - mx) ** 2; });
    trends.set(iso, { counts, firstYear: year - 9, mean: my, slope: num / den });
  }
  return trends;
}

// ------------------------------------------------------------------ beacons
export class Beacons {
  constructor(max = 900) {
    this.max = max;
    const g = new THREE.CylinderGeometry(0.0032, 0.0032, 1, 6, 1, true).translate(0, 0.5, 0);
    this.pillars = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), max);
    const rg = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), max);
    for (const m of [this.pillars, this.rings]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.group = new THREE.Group();
    this.group.add(this.pillars, this.rings);
    this.items = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
  }

  /** items: [{lat, lon, weight 0..1, group, ghost?}] */
  set(items) {
    this.items = items.slice(0, this.max);
    this.items.forEach((it, i) => {
      it.dir = latLonToVec3(it.lat, it.lon, 1);
      it.phase = hash01(String(it.lat) + it.lon) * Math.PI * 2;
      this._c.set(GROUPS[it.group]?.color || "#ffffff").multiplyScalar(it.ghost ? 0.4 : 1.5);
      this.pillars.setColorAt(i, this._c);
      this.rings.setColorAt(i, this._c);
    });
    this.pillars.count = this.rings.count = this.items.length;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  update(t, focusIso) {
    this.items.forEach((it, i) => {
      const focus = focusIso && it.iso3?.includes(focusIso) ? 1.6 : 1;
      const h = (0.05 + it.weight * 0.22) * focus * (it.ghost ? 0.8 : 1) * (0.92 + 0.08 * Math.sin(t * 2 + it.phase));
      this._q.setFromUnitVectors(this._up, it.dir);
      this._v.copy(it.dir).multiplyScalar(1.002);
      this._s.set(focus, h, focus);
      this.pillars.setMatrixAt(i, this._m.compose(this._v, this._q, this._s));
      const pulse = ((t * 0.6 + it.phase / 6.283) % 1);
      const rs = 0.004 + pulse * (0.008 + it.weight * 0.012) * focus;
      this._s.set(rs, rs, rs);
      this._v.copy(it.dir).multiplyScalar(1.003);
      this.rings.setMatrixAt(i, this._m.compose(this._v, this._q, this._s));
    });
    this.pillars.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.material.opacity = 0.4;
  }

  dispose() { for (const m of [this.pillars, this.rings]) { m.geometry.dispose(); m.material.dispose(); m.dispose(); } }
}

// ------------------------------------------------------------------ arcs
export class Arcs {
  constructor() { this.group = new THREE.Group(); this.lines = []; this.res = new THREE.Vector2(1, 1); }
  setResolution(w, h) { this.res.set(w, h); for (const l of this.lines) l.material.resolution.set(w, h); }
  clear() { for (const l of this.lines) { this.group.remove(l); l.geometry.dispose(); l.material.dispose(); } this.lines = []; }
  /** pairs: [{from:{lat,lon}, to:{lat,lon}, group}] */
  set(pairs) {
    this.clear();
    for (const p of pairs.slice(0, 24)) {
      const a = latLonToVec3(p.from.lat, p.from.lon, 1), b = latLonToVec3(p.to.lat, p.to.lon, 1);
      const ang = a.angleTo(b), lift = 0.08 + ang * 0.28, pts = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const v = new THREE.Vector3().copy(a).lerp(b, t).normalize().multiplyScalar(1 + lift * Math.sin(Math.PI * t));
        pts.push(v.x, v.y, v.z);
      }
      const g = new LineGeometry(); g.setPositions(pts);
      const c = new THREE.Color(GROUPS[p.group]?.color || "#9fe").multiplyScalar(2.2);
      const m = new LineMaterial({ color: c, linewidth: 2.2, transparent: true, opacity: 0.95, dashed: true, dashSize: 0.06, gapSize: 0.035, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
      m.resolution.copy(this.res);
      const l = new Line2(g, m); l.computeLineDistances();
      this.group.add(l); this.lines.push(l);
    }
  }
  update(dt) { for (const l of this.lines) l.material.dashOffset -= dt * 0.25; }
  dispose() { this.clear(); }
}
