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
OUT = ROOT / "data" / "crises.json"
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
EXTRA_PLACES = {"TWN": ("Taiwan", 23.7, 121.0)}  # shown on the map but not a WHO member state
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
    # WHO + ReliefWeb items are complete histories, so count them per year directly
    for it in rw_items + who:
        y = (it["date"] or "")[:4]
        if y:
            for iso in it["iso3"][:1]:
                yearly.setdefault(iso, {})[y] = yearly.setdefault(iso, {}).get(y, 0) + 1

    # de-duplicate multi-country ReliefWeb events (each country's feed lists the same disaster)
    seen, items = set(), []
    for it in rw_items + who + fda:
        if it["url"] in seen or not it["date"]:
            continue
        seen.add(it["url"])
        items.append(it)
    items.sort(key=lambda i: i["date"], reverse=True)

    by_country = {c["iso3"]: 0 for c in countries}
    for it in items:
        for iso in it["iso3"]:
            if iso in by_country:
                by_country[iso] += 1

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "scope": "food safety only",
        "sources": {
            "openfda": "https://open.fda.gov/apis/food/enforcement/",
            "who_don": "https://www.who.int/emergencies/disease-outbreak-news",
            "reliefweb": "https://reliefweb.int/disasters",
        },
        "groups": GROUPS,
        "items": items,
        "counts": by_country,
        "yearly": yearly,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    per = {}
    for it in items:
        per[it["source"]] = per.get(it["source"], 0) + 1
    print(f"{len(items)} food-safety items · {sum(1 for v in by_country.values() if v)} of {len(by_country)} countries have at least one")
    print("  " + " · ".join(f"{k}: {v}" for k, v in per.items()))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB) in {time.time() - t0:.0f}s")
    if errors:
        print(f"{len(errors)} note(s):\n  " + "\n  ".join(errors[:20]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
