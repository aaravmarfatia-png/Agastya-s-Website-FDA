#!/usr/bin/env python3
"""
Food-safety issues per country for the 4D globe -> data/crises.json

Official sources only (government / United Nations), no API keys:
  * openFDA food enforcement reports (U.S. FDA)  - food recalls, with the recalling firm's country
                                                    (U.S. firms placed by state)
  * WHO Disease Outbreak News                      - foodborne & waterborne disease outbreaks,
                                                    food contamination / adulteration events
  * ReliefWeb (UN OCHA)                             - foodborne & waterborne epidemics
                                                    (from a local cache, see below)

Only food-safety items are kept: natural disasters, conflicts and non-food diseases are dropped.
Nothing is invented: a country with no records gets an empty list.

ReliefWeb asks for no large bursts of RSS requests, so its per-country history is kept in
data/cache/reliefweb.json and only missing countries are fetched, one at a time with a pause.

Usage:
    python3 fetch_crises.py            # refresh openFDA + WHO, fill in missing ReliefWeb countries
    python3 fetch_crises.py --refresh  # also re-download ReliefWeb history for every country (slow)
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "data" / "issues"          # index.json + one file per country
CACHE = ROOT / "data" / "cache" / "reliefweb.json"
UA = "curl/8.7.1"

# ------------------------------------------------------------------ what counts as food safety
# Groups map onto the 4D globe's four validated beacon colours.
GROUPS = {
    "recall": "Food recall",
    "contamination": "Contamination & adulteration",
    "outbreak": "Foodborne & waterborne outbreak",
    "alert": "Food safety alert",
}
# Diseases WHO lists as transmitted through contaminated food (and often water).
FOODBORNE = re.compile(
    r"cholera|typhoid|paratyphoid|hepatitis ?[ae]\b|botulism|salmonell|listeri|e\.? ?coli|escherichia|"
    r"shiga|stec|ehec|haemolytic uraemic|hemolytic uremic|shigell|dysentery|campylobacter|vibrio|"
    r"norovirus|cyclospora|trichinell|brucell|food[- ]?borne|food poisoning|acute watery diarrh|diarrh",
    re.I,
)
CHEMICAL = re.compile(r"methanol|melamine|aflatoxin|mycotoxin|lead poisoning|\blead\b(?!\s+to\b)|mercury|arsenic|pesticide poisoning|adulterat|contaminated (food|oil|flour|milk)", re.I)

US_STATES = {  # approximate centroids, used to spread U.S. firms across the map
    "AL": (32.8, -86.8), "AK": (64.2, -149.5), "AZ": (34.3, -111.7), "AR": (34.9, -92.4), "CA": (37.2, -119.5),
    "CO": (39.0, -105.5), "CT": (41.6, -72.7), "DE": (39.0, -75.5), "DC": (38.9, -77.0), "FL": (28.6, -82.4),
    "GA": (32.7, -83.4), "HI": (20.8, -156.3), "ID": (44.4, -114.6), "IL": (40.0, -89.2), "IN": (39.9, -86.3),
    "IA": (42.1, -93.5), "KS": (38.5, -98.4), "KY": (37.5, -85.3), "LA": (31.1, -92.0), "ME": (45.4, -69.2),
    "MD": (39.0, -76.8), "MA": (42.3, -71.8), "MI": (44.3, -85.4), "MN": (46.3, -94.3), "MS": (32.7, -89.7),
    "MO": (38.4, -92.5), "MT": (47.0, -109.6), "NE": (41.5, -99.8), "NV": (39.3, -116.6), "NH": (43.7, -71.6),
    "NJ": (40.2, -74.7), "NM": (34.4, -106.1), "NY": (42.9, -75.5), "NC": (35.6, -79.4), "ND": (47.5, -100.5),
    "OH": (40.3, -82.8), "OK": (35.6, -97.5), "OR": (43.9, -120.6), "PA": (40.9, -77.8), "RI": (41.7, -71.5),
    "SC": (33.9, -80.9), "SD": (44.4, -100.2), "TN": (35.9, -86.4), "TX": (31.5, -99.3), "UT": (39.3, -111.7),
    "VT": (44.1, -72.7), "VA": (37.5, -78.8), "WA": (47.4, -120.5), "WV": (38.6, -80.6), "WI": (44.6, -89.9),
    "WY": (43.0, -107.6), "PR": (18.2, -66.5),
}
FDA_COUNTRY = {  # openFDA country names that differ from data/countries.js
    "Korea (the Republic of)": "KOR", "Dominican Republic (the)": "DOM", "Vietnam": "VNM", "Taiwan": "TWN",
    "United States": "USA", "Russia": "RUS", "Turkey": "TUR",
}
EXTRA_PLACES = {  # territories on the map that appear in official records but are not WHO member states
    "TWN": ("Taiwan", 23.7, 121.0), "HKG": ("Hong Kong", 22.32, 114.17), "MAC": ("Macao", 22.2, 113.55),
    "PSE": ("Palestine", 31.9, 35.2), "XKX": ("Kosovo", 42.6, 20.9), "PRI": ("Puerto Rico", 18.2, -66.5),
    "GRL": ("Greenland", 64.2, -51.7), "FRO": ("Faroe Islands", 62.0, -6.8), "NCL": ("New Caledonia", -21.3, 165.5),
    "PYF": ("French Polynesia", -17.7, -149.4),
}
WHO_ALIASES = {
    "Democratic Republic of the Congo": "COD", "Syrian Arab Republic": "SYR", "United Republic of Tanzania": "TZA",
    "Viet Nam": "VNM", "Türkiye": "TUR", "Turkey": "TUR", "Republic of Korea": "KOR", "Iran (Islamic Republic of)": "IRN",
    "Lao People's Democratic Republic": "LAO", "Bolivia (Plurinational State of)": "BOL", "Venezuela (Bolivarian Republic of)": "VEN",
    "Côte d’Ivoire": "CIV", "Côte d'Ivoire": "CIV", "Russian Federation": "RUS", "Republic of Moldova": "MDA",
    "United Kingdom of Great Britain and Northern Ireland": "GBR", "United States of America": "USA",
    "Democratic People's Republic of Korea": "PRK", "Micronesia (Federated States of)": "FSM", "Netherlands (Kingdom of the)": "NLD",
}


def get(url: str, timeout: int = 30) -> bytes:
    p = subprocess.run(["curl", "-sL", "--compressed", "-A", UA, "--max-time", str(timeout), "--retry", "2", "-f", url],
                       capture_output=True, timeout=timeout * 3 + 10)
    if p.returncode != 0:
        raise RuntimeError(f"curl exit {p.returncode} for {url}")
    return p.stdout


def iso_date(value) -> str | None:
    if not value:
        return None
    v = str(value).strip()
    try:
        if re.fullmatch(r"\d{8}", v):
            return datetime.strptime(v, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
        if "T" in v or re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
        return parsedate_to_datetime(v).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def clean(s, limit: int = 300) -> str:
    t = re.sub(r"<[^>]+>", " ", html.unescape(s or ""))
    t = re.sub(r"\s+", " ", html.unescape(t)).strip()
    return t if len(t) <= limit else t[:limit].rsplit(" ", 1)[0] + "…"


def jitter(key: str, spread: float) -> tuple[float, float]:
    h = 2166136261
    for ch in key:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return ((h % 1000) / 1000 - 0.5) * spread, (((h // 1000) % 1000) / 1000 - 0.5) * spread


def load_countries() -> list[dict]:
    raw = (ROOT / "data" / "countries.js").read_text(encoding="utf-8")
    return json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))["countries"]


def classify_text(text: str) -> str | None:
    if CHEMICAL.search(text):
        return "contamination"
    if FOODBORNE.search(text):
        return "outbreak"
    return None


# ------------------------------------------------------------------ ReliefWeb (cached, polite)
GLIDE = re.compile(r"^[A-Z]{2}-\d{4}-\d{6}-[A-Z]{3}$")


class RateLimited(Exception):
    pass


def reliefweb_country(iso: str, name_to_iso: dict) -> list:
    page = get(f"https://reliefweb.int/country/{iso.lower()}").decode("utf-8", "replace")
    m = re.search(r"advanced-search=%28C(\d+)%29", page) or re.search(r"%28PC(\d+)%29", page)
    if not m:
        return []
    rss = get(f"https://reliefweb.int/disasters/rss.xml?advanced-search=%28C{m.group(1)}%29")
    if b"Access to RSS feeds is limited" in rss:
        raise RateLimited()
    out = []
    for it in ET.fromstring(rss.lstrip(b"\xef\xbb\xbf")).iter("item"):
        cats = [(x.text or "").strip() for x in it.findall("category")]
        glides = [x for x in cats if GLIDE.match(x)]
        link = (it.findtext("link") or "").strip()
        if not link.startswith("https://reliefweb.int/"):
            continue
        out.append({
            "title": clean(it.findtext("title"), 160), "url": link, "date": iso_date(it.findtext("pubDate")),
            "type": glides[0][:2] if glides else "OT", "glide": glides[0] if glides else None,
            "also": sorted({name_to_iso[x] for x in cats if x in name_to_iso and name_to_iso[x] != iso}),
            "summary": clean(it.findtext("description")),
        })
    return out


def reliefweb(countries, name_to_iso, errors) -> dict:
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text(encoding="utf-8")).get("countries", {})
        except ValueError:
            cache = {}
    refresh, fails = "--refresh" in sys.argv, 0
    for c in countries:
        iso = c["iso3"]
        if iso in cache and cache[iso].get("disasters") is not None and not refresh:
            continue
        try:
            cache[iso] = {"disasters": reliefweb_country(iso, name_to_iso)}
            fails = 0
            time.sleep(1.5)
        except RateLimited:
            errors.append("ReliefWeb is limiting RSS access right now; using cached history, try again later")
            break
        except Exception as e:  # noqa: BLE001
            fails += 1
            if fails >= 3:
                errors.append(f"ReliefWeb not responding ({e}); using cached history")
                break
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(), "countries": cache},
                                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return cache


# ------------------------------------------------------------------ openFDA
def openfda(meta: dict, errors, yearly: dict) -> list:
    """Recent recalls per country (items) + complete yearly recall counts per country (into `yearly`)."""
    base = "https://api.fda.gov/food/enforcement.json"
    items = []
    try:
        countries = json.loads(get(base + "?count=country.exact", 40)).get("results", [])
    except Exception as e:  # noqa: BLE001
        errors.append(f"openFDA: {e}")
        return items
    queries = []
    for row in countries:
        name = row["term"]
        q = urllib.parse.quote(f'country.exact:"{name}"')
        limit = 1000 if name == "United States" else 100
        queries.append((name, f"{base}?search={q}&sort=report_date:desc&limit={limit}"))
    for name, url in queries:
        iso = FDA_COUNTRY.get(name) or next((k for k, v in meta.items() if v["name"] == name), None)
        if not iso:
            errors.append(f"openFDA: no ISO3 for {name}")
            continue
        try:
            rows = json.loads(get(url, 60)).get("results", [])
            q = urllib.parse.quote(f'country.exact:"{name}"')
            for d in json.loads(get(f"{base}?search={q}&count=report_date", 60)).get("results", []):
                y = d["time"][:4]
                yearly.setdefault(iso, {})[y] = yearly.setdefault(iso, {}).get(y, 0) + d["count"]
        except Exception as e:  # noqa: BLE001
            errors.append(f"openFDA {name}: {e}")
            continue
        for r in rows:
            num = r.get("recall_number", "")
            firm = clean(r.get("recalling_firm"), 80)
            product = clean(r.get("product_description"), 110)
            reason = clean(r.get("reason_for_recall"), 260)
            cls = r.get("classification", "")
            if iso == "USA" and r.get("state") in US_STATES:
                lat, lon = US_STATES[r["state"]]
                spread = 2.5
            else:
                place = meta.get(iso) or EXTRA_PLACES.get(iso)
                if not place:
                    continue
                lat, lon = (place["lat"], place["lon"]) if isinstance(place, dict) else place[1:]
                spread = 2.0
            dy, dx = jitter(num, spread)
            group = "contamination" if CHEMICAL.search(reason) else "recall"
            items.append({
                "iso3": [iso], "home": iso, "lat": round(lat + dy, 3), "lon": round(lon + dx, 3),
                "date": iso_date(r.get("report_date") or r.get("recall_initiation_date")),
                "group": group, "label": f"{GROUPS[group]} · {cls}" if cls else GROUPS[group],
                "title": f"{firm}: {product}", "detail": f"Reason: {reason}",
                "weight": {"Class I": 1.0, "Class II": 0.6, "Class III": 0.35}.get(cls, 0.5),
                "url": f"{base}?search=recall_number:%22{urllib.parse.quote(num)}%22", "source": "U.S. FDA (openFDA)",
                "place": f"{r.get('city', '')}, {r.get('state', '')}".strip(", ") if iso == "USA" else "",
            })
    return items


# ------------------------------------------------------------------ WHO Disease Outbreak News
def who_don(countries: list[dict], meta: dict, errors) -> list:
    names = {c["name"]: c["iso3"] for c in countries}
    names.update(WHO_ALIASES)
    ordered = sorted(names, key=len, reverse=True)
    rows = []
    for skip in range(0, 4000, 100):  # WHO's API rejects large pages
        url = ("https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDateAndTime%20desc"
               f"&$top=100&$skip={skip}&$select=Title,PublicationDateAndTime,UrlName")
        try:
            page = json.loads(get(url, 40)).get("value", [])
        except Exception as e:  # noqa: BLE001
            errors.append(f"WHO DON page {skip}: {e}")
            break
        rows += page
        if len(page) < 100:
            break
        time.sleep(0.4)
    out = []
    for d in rows:
        title = d.get("Title", "")
        group = classify_text(title)
        if not group:
            continue
        rest, isos = title, []
        for n in ordered:
            if re.search(r"(?<![\w])" + re.escape(n) + r"(?![\w])", rest):
                isos.append(names[n])
                rest = rest.replace(n, " ")
        isos = [i for i in dict.fromkeys(isos) if i in meta]
        if not isos:
            continue
        url = "https://www.who.int/emergencies/disease-outbreak-news/item/" + d.get("UrlName", "")
        dy, dx = jitter(url, 3.0)
        out.append({
            "iso3": isos, "home": isos[0], "lat": round(meta[isos[0]]["lat"] + dy, 3), "lon": round(meta[isos[0]]["lon"] + dx, 3),
            "date": iso_date(d.get("PublicationDateAndTime")), "group": group, "label": GROUPS[group],
            "title": title, "weight": 0.85, "url": url, "source": "WHO Disease Outbreak News",
        })
    return out


# ------------------------------------------------------------------ EU RASFF (European Commission)
RASFF_WEIGHT = {"serious": 1.0, "potentially serious": 0.75, "potential risk": 0.6, "not serious": 0.35, "no risk": 0.25, "undecided": 0.55}
PATHOGEN = re.compile(r"salmonell|listeri|e\.? ?coli|stec|norovirus|hepatitis|bacillus|clostridi|vibrio|campylobacter|"
                      r"enterobacter|cronobacter|mould|mold|yeast|anisakis|parasit|insect|rodent|infest|spoil|decomposi", re.I)
CHEM_PLUS = re.compile(CHEMICAL.pattern + r"|ochratoxin|pesticide|residue|chlorpyrifos|ethylene oxide|2-chloroethanol|cadmium|dioxin|"
                       r"\bpahs?\b|benzo\(a\)pyrene|sulphite|sulfite|unauthori[sz]ed|migration|histamine|nitrite|veterinary|"
                       r"\bcolou?rs?\b|sudan (dyes?|red|orange|i{1,3}v?|[1-4])\b|tropane|alkaloid|3-mcpd|glycidyl|mineral oil|acrylamide|\bnickel\b|chromium|\btin\b", re.I)


def place(iso: str, meta: dict):
    m = meta.get(iso)
    if m:
        return m["lat"], m["lon"]
    if iso in EXTRA_PLACES:
        return EXTRA_PLACES[iso][1], EXTRA_PLACES[iso][2]
    return None


def rasff_items(meta: dict, errors) -> list:
    path = ROOT / "data" / "cache" / "rasff.json"
    if not path.exists():
        errors.append("RASFF cache missing: run python3 scripts/fetch-rasff.py")
        return []
    iso2to3 = {v: k for k, v in json.loads((ROOT / "data" / "cache" / "iso3to2.json").read_text()).items()}
    iso2to3.update({"XK": "XKX", "UK": "GBR", "EL": "GRC"})
    out = []
    for n in json.loads(path.read_text())["notifications"].values():
        ptype = (n.get("productType") or {}).get("description", "")
        if ptype not in ("food", "food contact material"):
            continue  # animal feed is left out: food safety only
        origins = [iso2to3.get((o or {}).get("isoCode", "")) for o in n.get("originCountries") or []]
        origins = [o for o in dict.fromkeys(origins) if o and place(o, meta)]
        if not origins:
            continue
        d = n.get("ecValidationDate", "")
        try:
            date = datetime.strptime(d, "%d-%m-%Y %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
        subject = clean(n.get("subject", ""), 220)
        subject = subject[:1].upper() + subject[1:]
        cls = (n.get("notificationClassification") or {}).get("description", "notification")
        risk = (n.get("riskDecision") or {}).get("description", "undecided")
        cat = (n.get("productCategory") or {}).get("description", "")
        notifier = (n.get("notifyingCountry") or {}).get("organizationName", "")
        group = "contamination" if (CHEM_PLUS.search(subject) or PATHOGEN.search(subject)) else "alert"
        url = f"https://webgate.ec.europa.eu/rasff-window/screen/notification/{n['notifId']}"
        lat, lon = place(origins[0], meta)
        dy, dx = jitter(url, 3.0)
        out.append({
            "iso3": origins, "home": origins[0], "lat": round(lat + dy, 3), "lon": round(lon + dx, 3), "date": date,
            "group": group, "label": f"EU RASFF {cls}", "title": subject,
            "detail": f"Product: {cat}. Risk: {risk}. Reported by {notifier}. Reference {n.get('reference', '')}.",
            "weight": RASFF_WEIGHT.get(risk, 0.55), "url": url, "source": "EU RASFF (European Commission)", "days": 60,
        })
    return out


# ------------------------------------------------------------------ FDA Import Alerts (U.S. FDA)
FOOD_ALERT_PREFIXES = {f"{i:02d}" for i in list(range(2, 47)) + [54]}   # FDA industry codes for foods & dietary supplements
FOOD_WORDS = re.compile(r"food|pesticide|salmonell|filth|aflatoxin|seafood|fish|fruit|vegetable|spice|honey|juice|milk|cheese|"
                        r"candy|lead|color|colour|melamine|histamine|decomposition|listeria|e\. ?coli|botulin|acidified|low-acid", re.I)


def fda_import_alert_items(meta: dict, errors) -> list:
    path = ROOT / "data" / "cache" / "fda_import_alerts.json"
    if not path.exists():
        errors.append("FDA import alert cache missing: run python3 scripts/fetch-fda-import-alerts.py")
        return []
    out = []
    for iso, rec in json.loads(path.read_text()).items():
        pl = place(iso, meta)
        if not pl:
            continue
        for a in rec.get("alerts", []):
            prefix = a["num"].split("-")[0]
            if prefix not in FOOD_ALERT_PREFIXES and not (prefix == "99" and FOOD_WORDS.search(a["title"])):
                continue
            try:
                date = datetime.strptime(a["date"], "%m/%d/%Y").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                continue
            group = "contamination" if (CHEM_PLUS.search(a["title"]) or PATHOGEN.search(a["title"]) or re.search(r"filth|unsanitary|insanitary", a["title"], re.I)) else "alert"
            key = a["url"] + "#" + iso
            dy, dx = jitter(key, 3.0)
            name = (meta.get(iso) or {}).get("name") or EXTRA_PLACES.get(iso, (iso,))[0]
            out.append({
                "iso3": [iso], "home": iso, "lat": round(pl[0] + dy, 3), "lon": round(pl[1] + dx, 3), "date": date,
                "group": group, "label": f"FDA import alert {a['num']}", "title": a["title"],
                "detail": f"The U.S. FDA can detain these products from listed firms in {name} at the border ({a['type'] or 'import alert'}). Alert last updated {a['date']}.",
                "weight": 0.7, "url": a["url"], "source": "U.S. FDA Import Alerts", "days": 180, "key": key,
            })
    return out


def main() -> int:
    t0 = time.time()
    countries = load_countries()
    meta = {c["iso3"]: c for c in countries}
    name_to_iso = {c["name"]: c["iso3"] for c in countries}
    name_to_iso.update(WHO_ALIASES)
    errors: list[str] = []

    rw_cache = reliefweb(countries, name_to_iso, errors)
    rw_items = []
    for iso, rec in rw_cache.items():
        if iso not in meta:
            continue
        for d in rec.get("disasters", []):
            text = f"{d['title']} {d.get('summary', '')}"
            # epidemics of foodborne/waterborne disease, or contamination events of any type
            group = classify_text(text) if d.get("type") in ("EP", "OT", "AC", "CE") else ("contamination" if CHEMICAL.search(d["title"]) else None)
            if not group or not d.get("date"):
                continue
            dy, dx = jitter(d["url"], 3.0)
            rw_items.append({
                "iso3": [iso, *d.get("also", [])], "home": iso, "lat": round(meta[iso]["lat"] + dy, 3), "lon": round(meta[iso]["lon"] + dx, 3),
                "date": d["date"], "group": group, "label": GROUPS[group], "title": d["title"], "detail": d.get("summary", ""),
                "weight": 0.85, "url": d["url"], "source": "ReliefWeb (UN OCHA)",
            })

    yearly: dict = {}
    fda = openfda(meta, errors, yearly)
    who = who_don(countries, meta, errors)
    rasff = rasff_items(meta, errors)
    fda_ia = fda_import_alert_items(meta, errors)
    # sources that are complete histories are counted per year directly (openFDA totals come from its count API)
    for it in rw_items + who + rasff + fda_ia:
        y = (it["date"] or "")[:4]
        if y:
            for iso in it["iso3"]:
                yearly.setdefault(iso, {})[y] = yearly.setdefault(iso, {}).get(y, 0) + 1

    # de-duplicate (multi-country ReliefWeb events appear in several country feeds; one FDA alert covers many countries)
    seen, items = set(), []
    for it in rw_items + who + fda + rasff + fda_ia:
        key = it.get("key") or it["url"]
        if key in seen or not it["date"]:
            continue
        seen.add(key)
        items.append(it)
    items.sort(key=lambda i: i["date"], reverse=True)

    # ---------------- write: compact index (globe) + one detailed file per country (panels)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    groups = list(GROUPS)
    sources = sorted({i["source"] for i in items})
    isos = sorted({iso for i in items for iso in i["iso3"]} | set(meta))
    idx = {iso: k for k, iso in enumerate(isos)}
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    events, per_country = [], {iso: [] for iso in isos}
    for it in items:
        day = (datetime.fromisoformat(it["date"]) - epoch).days
        events.append([[idx[i] for i in it["iso3"]], round(it["lat"], 2), round(it["lon"], 2), day,
                       groups.index(it["group"]), round(it["weight"] * 100), it.get("days") or 0, sources.index(it["source"])])
        rec = {k: it[k] for k in ("title", "url", "date", "group", "label", "source", "weight", "days") if k in it}
        if it.get("detail"):
            rec["detail"] = it["detail"]
        if len(it["iso3"]) > 1:
            rec["also"] = it["iso3"]
        for iso in it["iso3"]:
            per_country[iso].append(rec)
    names = {**{c["iso3"]: c["name"] for c in countries}, **{k: v[0] for k, v in EXTRA_PLACES.items()}}
    for old in OUT_DIR.glob("*.json"):
        old.unlink()
    for iso, lst in per_country.items():   # every country gets a file, even an empty one (no 404s in the browser)
        if True:
            (OUT_DIR / f"{iso}.json").write_text(json.dumps({"iso3": iso, "name": names.get(iso, iso), "count": len(lst), "items": lst},
                                                            ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {iso: len(per_country[iso]) for iso in isos}
    index = {
        "generated": datetime.now(timezone.utc).isoformat(), "scope": "food safety only",
        "sources": {
            "EU RASFF (European Commission)": "https://webgate.ec.europa.eu/rasff-window/screen/search",
            "U.S. FDA Import Alerts": "https://www.accessdata.fda.gov/cms_ia/ialist.html",
            "U.S. FDA (openFDA)": "https://open.fda.gov/apis/food/enforcement/",
            "WHO Disease Outbreak News": "https://www.who.int/emergencies/disease-outbreak-news",
            "ReliefWeb (UN OCHA)": "https://reliefweb.int/disasters",
        },
        "groups": groups, "sourceList": sources, "countries": isos, "counts": counts, "yearly": yearly,
        "eventFields": ["countryIndexes", "lat", "lon", "dayNumber", "groupIndex", "weightPct", "activeDays", "sourceIndex"],
        "events": events,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    stale = ROOT / "data" / "crises.json"
    if stale.exists():
        stale.unlink()   # replaced by data/issues/

    per = {}
    for it in items:
        per[it["source"]] = per.get(it["source"], 0) + 1
    who_members = [c["iso3"] for c in countries]
    under = sorted(((counts[i], names[i]) for i in who_members if counts[i] < 20))
    print(f"{len(items)} food-safety issues from {len(per)} official sources")
    print("  " + " · ".join(f"{k}: {v}" for k, v in sorted(per.items(), key=lambda kv: -kv[1])))
    print(f"WHO member states with >= 20 issues: {len(who_members) - len(under)} of {len(who_members)}")
    print(f"index {((OUT_DIR / 'index.json').stat().st_size) // 1024} KB · {sum(1 for _ in OUT_DIR.glob('*.json')) - 1} country files · {time.time() - t0:.0f}s")
    if under:
        print("fewer than 20: " + ", ".join(f"{n} ({c})" for c, n in under))
    if errors:
        print(f"{len(errors)} note(s):\n  " + "\n  ".join(errors[:20]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
