#!/usr/bin/env python3
"""
Food Safety & Consumer Protection Watch - feed aggregator.

Pulls recalls, alerts and news ONLY from government and United Nations
sources, then writes data/feed.js for the website (index.html) to display.

Usage:
    python3 fetch_feeds.py

No third-party packages are needed (Python 3.9+ standard library only).
"""

from __future__ import annotations

import html
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_FILE = ROOT / "data" / "feed.js"

# Several US government sites (fda.gov, usda.gov) reject browser-like or
# custom user agents from scripts but accept a plain curl agent.
USER_AGENT = "curl/8.7.1"
TIMEOUT = 25
MAX_ITEMS_PER_SOURCE = 40

# ---------------------------------------------------------------------------
# Trust rules: every link shown on the site must belong to one of these
# government or UN domains. Anything else is dropped.
# ---------------------------------------------------------------------------
TRUSTED_SUFFIXES = (
    ".gov",          # United States federal government
    ".gov.uk",       # United Kingdom government
    ".gov.scot",     # Scottish government
    ".nhs.uk",       # UK National Health Service
    ".gov.in",       # Government of India
    ".nic.in",       # Government of India (NIC-hosted)
    ".canada.ca",    # Government of Canada
    ".gc.ca",        # Government of Canada
    ".europa.eu",    # European Union institutions
    ".gov.au",       # Australian government
    ".govt.nz",      # New Zealand government
    ".gov.sg",       # Singapore government
    ".go.jp",        # Japanese government
    "who.int",       # World Health Organization (UN)
    "fao.org",       # Food and Agriculture Organization (UN)
    "un.org",        # United Nations
    "unctad.org",    # UN Trade & Development (consumer protection)
    "unicef.org",    # UNICEF (UN)
    "wfp.org",       # World Food Programme (UN)
    "codexalimentarius.org",  # FAO/WHO Codex Alimentarius
)


def is_trusted(url: str) -> bool:
    try:
        host = (urllib.parse.urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    for suffix in TRUSTED_SUFFIXES:
        bare = suffix.lstrip(".")
        if host == bare or host.endswith("." + bare):
            return True
    return False


# Keywords used to keep only food-safety / consumer-protection stories from
# broad news feeds (WHO, FAO).
FOOD_KEYWORDS = re.compile(
    r"food|nutrition|diet|salt|sodium|sugar|trans[- ]fat|foodborne|"
    r"contamina|pesticide|codex|antimicrobial|zoonot|avian influenza|"
    r"bird flu|cholera|listeria|salmonella|e\. ?coli|botulism|aflatoxin|"
    r"infant formula|breastfeed|alcohol|tobacco|consumer|labell?ing|"
    r"chemical|lead poisoning|safe water|drinking water|hygiene",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Live sources. kind = "rss" | "openfda" | "fsa"
# category is one of: Recall, Alert, News
# ---------------------------------------------------------------------------
LIVE_SOURCES = [
    # --- United States -----------------------------------------------------
    {
        "id": "fda-food-recalls", "agency": "FDA", "name": "FDA - Food Safety Recalls",
        "region": "United States", "category": "Recall", "kind": "rss",
        "url": "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml",
    },
    {
        "id": "fda-recalls", "agency": "FDA", "name": "FDA - Recalls, Market Withdrawals & Safety Alerts",
        "region": "United States", "category": "Recall", "kind": "rss",
        "url": "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml",
    },
    {
        "id": "fda-allergies", "agency": "FDA", "name": "FDA - Food Allergy Alerts",
        "region": "United States", "category": "Alert", "kind": "rss",
        "url": "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-allergies/rss.xml",
    },
    {
        "id": "fda-press", "agency": "FDA", "name": "FDA - Press Releases",
        "region": "United States", "category": "News", "kind": "rss",
        "url": "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    },
    {
        "id": "openfda-enforcement", "agency": "FDA", "name": "openFDA - Food Enforcement Reports",
        "region": "United States", "category": "Recall", "kind": "openfda",
        "url": "https://api.fda.gov/food/enforcement.json?sort=report_date:desc&limit=40",
    },
    {
        "id": "cdc-food-safety", "agency": "CDC", "name": "CDC - Food Safety",
        "region": "United States", "category": "Alert", "kind": "rss",
        "url": "https://tools.cdc.gov/api/v2/resources/media/316422.rss",
    },
    {
        "id": "cpsc-recalls", "agency": "CPSC", "name": "CPSC - Consumer Product Recalls",
        "region": "United States", "category": "Recall", "kind": "rss",
        "url": "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS",
    },
    # --- United Kingdom ----------------------------------------------------
    {
        "id": "uk-fsa-alerts", "agency": "UK FSA", "name": "UK Food Standards Agency - Food Alerts",
        "region": "United Kingdom", "category": "Alert", "kind": "fsa",
        "url": "https://data.food.gov.uk/food-alerts/id?_limit=40&_sort=-created",
    },
    # --- Canada ------------------------------------------------------------
    {
        "id": "cfia-recalls", "agency": "CFIA", "name": "Canadian Food Inspection Agency - Food Recalls",
        "region": "Canada", "category": "Recall", "kind": "rss",
        "url": "https://recalls-rappels.canada.ca/en/feed/cfia-alerts-recalls",
        "fix_host": "https://recalls-rappels.canada.ca",
    },
    {
        "id": "hc-consumer", "agency": "Health Canada", "name": "Health Canada - Consumer Product Recalls",
        "region": "Canada", "category": "Recall", "kind": "rss",
        "url": "https://recalls-rappels.canada.ca/en/feed/consumer-products-alerts-recalls",
        "fix_host": "https://recalls-rappels.canada.ca",
    },
    # --- European Union ----------------------------------------------------
    {
        "id": "efsa-news", "agency": "EFSA", "name": "European Food Safety Authority - News",
        "region": "European Union", "category": "News", "kind": "rss",
        "url": "https://www.efsa.europa.eu/en/news/rss",
    },
    # --- United Nations ----------------------------------------------------
    {
        "id": "who-news", "agency": "WHO", "name": "World Health Organization - News (food & nutrition)",
        "region": "Global (UN)", "category": "News", "kind": "who",
        "url": "https://www.who.int/api/news/newsitems?sf_culture=en&$orderby=PublicationDateAndTime%20desc&$top=100",
    },
    {
        "id": "fao-news", "agency": "FAO", "name": "Food and Agriculture Organization - Newsroom (food safety)",
        "region": "Global (UN)", "category": "News", "kind": "rss",
        "url": "https://www.fao.org/feeds/fao-newsroom-rss", "filter": True,
    },
]

# ---------------------------------------------------------------------------
# Directory of trusted sites. Some (FSSAI, BIS, NHS) have no public feed
# that can be read automatically, so the site links straight to them.
# ---------------------------------------------------------------------------
DIRECTORY = [
    # India
    {"agency": "FSSAI", "name": "Food Safety and Standards Authority of India", "region": "India",
     "url": "https://www.fssai.gov.in/", "about": "India's national food regulator: food standards, licensing, advisories and recalls.",
     "links": [["Press releases", "https://www.fssai.gov.in/press-release.php"],
               ["Advisories", "https://www.fssai.gov.in/advisories.php"],
               ["Food Safety Connect (complaints)", "https://foscos.fssai.gov.in/consumergrievance/"]]},
    {"agency": "BIS", "name": "Bureau of Indian Standards", "region": "India",
     "url": "https://www.bis.gov.in/", "about": "National standards body: ISI mark, hallmarking, product certification and consumer complaints.",
     "links": [["Consumer protection", "https://www.bis.gov.in/consumer-overview/consumer-protection/"],
               ["Online complaint", "https://www.bis.gov.in/consumer-overview/online-complaint-registration/"]]},
    {"agency": "DoCA", "name": "Department of Consumer Affairs, India", "region": "India",
     "url": "https://consumeraffairs.nic.in/", "about": "Consumer protection policy, the Consumer Protection Act and the National Consumer Helpline.",
     "links": [["National Consumer Helpline", "https://consumerhelpline.gov.in/"],
               ["e-Daakhil (file a case)", "https://edaakhil.nic.in/"]]},
    {"agency": "PIB", "name": "Press Information Bureau, India", "region": "India",
     "url": "https://pib.gov.in/", "about": "Official press releases from all Indian ministries, including Health and Consumer Affairs.", "links": []},
    # United States
    {"agency": "FDA", "name": "U.S. Food and Drug Administration", "region": "United States", "live": True,
     "url": "https://www.fda.gov/food", "about": "Regulates most US food, dietary supplements and cosmetics; publishes recalls and safety alerts.",
     "links": [["Recalls & alerts", "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts"],
               ["Report a problem", "https://www.fda.gov/safety/report-problem-fda"]]},
    {"agency": "USDA FSIS", "name": "USDA Food Safety and Inspection Service", "region": "United States",
     "url": "https://www.fsis.usda.gov/", "about": "Meat, poultry and egg product safety, recalls and public health alerts.",
     "links": [["Recalls", "https://www.fsis.usda.gov/recalls"]]},
    {"agency": "CDC", "name": "Centers for Disease Control and Prevention", "region": "United States", "live": True,
     "url": "https://www.cdc.gov/food-safety/", "about": "Tracks foodborne illness outbreaks and publishes prevention guidance.",
     "links": [["Outbreak list", "https://www.cdc.gov/food-safety/outbreaks/"]]},
    {"agency": "FoodSafety.gov", "name": "FoodSafety.gov", "region": "United States",
     "url": "https://www.foodsafety.gov/", "about": "Combined federal food safety information from HHS, USDA and FDA.", "links": []},
    {"agency": "CPSC", "name": "U.S. Consumer Product Safety Commission", "region": "United States", "live": True,
     "url": "https://www.cpsc.gov/", "about": "Recalls and safety warnings for consumer products.",
     "links": [["Recalls", "https://www.cpsc.gov/Recalls"]]},
    {"agency": "FTC", "name": "Federal Trade Commission - Consumer Advice", "region": "United States",
     "url": "https://consumer.ftc.gov/", "about": "Scams, fraud, false advertising and consumer rights.",
     "links": [["Report fraud", "https://reportfraud.ftc.gov/"]]},
    # United Kingdom
    {"agency": "NHS", "name": "NHS - Food safety & healthy eating", "region": "United Kingdom",
     "url": "https://www.nhs.uk/live-well/eat-well/", "about": "NHS guidance on healthy eating, food hygiene and food poisoning.",
     "links": [["Food poisoning", "https://www.nhs.uk/conditions/food-poisoning/"],
               ["Food allergy", "https://www.nhs.uk/conditions/food-allergy/"]]},
    {"agency": "UK FSA", "name": "Food Standards Agency", "region": "United Kingdom", "live": True,
     "url": "https://www.food.gov.uk/", "about": "Food alerts, allergy alerts and food hygiene ratings for England, Wales and Northern Ireland.",
     "links": [["Hygiene ratings", "https://ratings.food.gov.uk/"]]},
    {"agency": "FSS", "name": "Food Standards Scotland", "region": "United Kingdom",
     "url": "https://www.foodstandards.gov.scot/", "about": "Scotland's public food safety and standards body.", "links": []},
    # Canada
    {"agency": "CFIA", "name": "Canadian Food Inspection Agency", "region": "Canada", "live": True,
     "url": "https://inspection.canada.ca/", "about": "Food recalls, allergy alerts and food inspection in Canada.",
     "links": [["Recalls & safety alerts", "https://recalls-rappels.canada.ca/en"]]},
    # European Union
    {"agency": "EFSA", "name": "European Food Safety Authority", "region": "European Union", "live": True,
     "url": "https://www.efsa.europa.eu/", "about": "Independent scientific advice on food and feed risks in the EU.", "links": []},
    {"agency": "RASFF", "name": "EU Rapid Alert System for Food and Feed", "region": "European Union",
     "url": "https://food.ec.europa.eu/food-safety/rasff_en", "about": "Cross-border food and feed safety notifications between EU countries.",
     "links": [["RASFF Window (search alerts)", "https://webgate.ec.europa.eu/rasff-window/screen/search"]]},
    # Asia-Pacific
    {"agency": "FSANZ", "name": "Food Standards Australia New Zealand", "region": "Asia-Pacific",
     "url": "https://www.foodstandards.gov.au/", "about": "Food standards and food recalls for Australia and New Zealand.",
     "links": [["Food recalls", "https://www.foodstandards.gov.au/food-recalls"]]},
    {"agency": "MPI", "name": "New Zealand Food Safety (MPI)", "region": "Asia-Pacific",
     "url": "https://www.mpi.govt.nz/food-safety-home/", "about": "Food safety rules, recalls and advice in New Zealand.", "links": []},
    {"agency": "SFA", "name": "Singapore Food Agency", "region": "Asia-Pacific",
     "url": "https://www.sfa.gov.sg/", "about": "Food safety and security in Singapore, including recalls.", "links": []},
    # United Nations
    {"agency": "WHO", "name": "World Health Organization - Food safety", "region": "Global (UN)", "live": True,
     "url": "https://www.who.int/health-topics/food-safety", "about": "Global food safety guidance, foodborne disease data and the INFOSAN network.",
     "links": [["Fact sheet", "https://www.who.int/news-room/fact-sheets/detail/food-safety"],
               ["INFOSAN", "https://www.who.int/groups/fao-who-international-food-safety-authorities-network-infosan"]]},
    {"agency": "FAO", "name": "Food and Agriculture Organization - Food safety", "region": "Global (UN)", "live": True,
     "url": "https://www.fao.org/food-safety/en/", "about": "UN agency for food security, food safety and agriculture.", "links": []},
    {"agency": "Codex", "name": "Codex Alimentarius (FAO/WHO)", "region": "Global (UN)",
     "url": "https://www.fao.org/fao-who-codexalimentarius/en/", "about": "International food standards, guidelines and codes of practice.", "links": []},
    {"agency": "UNCTAD", "name": "UN Trade & Development - Consumer protection", "region": "Global (UN)",
     "url": "https://unctad.org/topic/competition-and-consumer-protection", "about": "UN Guidelines for Consumer Protection and global consumer policy.", "links": []},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def clean_text(value: str | None, limit: int = 280) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)  # some feeds double-encode
    text = WS_RE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    candidates = [value, re.sub(r"\s+Z$", " +0000", value)]
    for cand in candidates:
        try:
            dt = parsedate_to_datetime(cand)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, IndexError):
            pass
    iso = value.replace("Z", "+00:00")
    for fmt in (None, "%Y%m%d", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y"):
        try:
            dt = datetime.fromisoformat(iso) if fmt is None else datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
        return resp.read()


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(el: ET.Element, *names: str) -> str | None:
    for child in el:
        if local(child.tag) in names:
            if child.text and child.text.strip():
                return child.text
            href = child.attrib.get("href")
            if href:
                return href
    return None


def make_item(src: dict, title: str, link: str, summary: str, date: str | None) -> dict:
    link = (link or "").strip()
    if link.startswith("http://"):
        link = "https://" + link[len("http://"):]
    return {
        "title": clean_text(title, 220),
        "link": link,
        "summary": clean_text(summary),
        "date": date,
        "source": src["id"],
        "agency": src["agency"],
        "region": src["region"],
        "category": src["category"],
    }


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
def parse_rss(src: dict, raw: bytes) -> list[dict]:
    raw = raw.lstrip(b"\xef\xbb\xbf").strip()
    root = ET.fromstring(raw)
    entries = [e for e in root.iter() if local(e.tag) in ("item", "entry")]
    items = []
    for e in entries:
        title = child_text(e, "title") or ""
        link = (child_text(e, "link") or "").strip()
        if src.get("fix_host") and link:
            parts = urllib.parse.urlparse(link)
            if not is_trusted(link):
                link = src["fix_host"] + parts.path
        summary = child_text(e, "description", "summary", "content") or ""
        date = parse_date(child_text(e, "pubdate", "published", "updated", "date"))
        if src.get("filter") and not FOOD_KEYWORDS.search(title + " " + summary[:600]):
            continue
        items.append(make_item(src, title, link, summary, date))
    return items


def parse_openfda(src: dict, raw: bytes) -> list[dict]:
    data = json.loads(raw)
    items = []
    for r in data.get("results", []):
        firm = r.get("recalling_firm", "").strip()
        product = clean_text(r.get("product_description", ""), 120)
        cls = r.get("classification", "")
        title = f"{cls}: {firm} - {product}" if firm else product
        reason = r.get("reason_for_recall", "")
        dist = r.get("distribution_pattern", "")
        summary = f"Reason: {reason} Distribution: {dist} Status: {r.get('status', '')}."
        num = r.get("recall_number", "")
        link = "https://api.fda.gov/food/enforcement.json?search=recall_number:%22" + urllib.parse.quote(num) + "%22"
        date = parse_date(r.get("report_date") or r.get("recall_initiation_date"))
        item = make_item(src, title, link, summary, date)
        item["extra"] = {"classification": cls, "recall_number": num}
        items.append(item)
    return items


FSA_TYPES = {"AA": "Allergy alert", "PRIN": "Product recall", "FAFA": "Food alert for action"}


def parse_fsa(src: dict, raw: bytes) -> list[dict]:
    data = json.loads(raw)
    items = []
    for a in data.get("items", []):
        kind = (a.get("notation", "").split("-") + ["", ""])[1]
        problems = a.get("problem") or []
        risk = problems[0].get("riskStatement", "") if problems else ""
        title = a.get("title", "")
        label = FSA_TYPES.get(kind)
        item = make_item(src, title, a.get("alertURL", ""), risk, parse_date(a.get("modified") or a.get("created")))
        if label:
            item["extra"] = {"type": label}
        if kind == "PRIN":
            item["category"] = "Recall"
        items.append(item)
    return items


def parse_who(src: dict, raw: bytes) -> list[dict]:
    data = json.loads(raw)
    items = []
    for n in data.get("value", []):
        title = n.get("Title", "")
        if not FOOD_KEYWORDS.search(title):
            continue
        path = n.get("ItemDefaultUrl", "")
        link = "https://www.who.int/news/item" + path if path.startswith("/") else ""
        item = make_item(src, title, link, "", parse_date(n.get("PublicationDateAndTime")))
        if n.get("NewsType"):
            item["extra"] = {"type": n["NewsType"]}
        items.append(item)
    return items


PARSERS = {"rss": parse_rss, "openfda": parse_openfda, "fsa": parse_fsa, "who": parse_who}


def run_source(src: dict) -> tuple[dict, list[dict], str | None]:
    try:
        raw = fetch(src["url"])
        items = PARSERS[src["kind"]](src, raw)
        items = [i for i in items if i["title"] and i["link"] and is_trusted(i["link"])]
        items.sort(key=lambda i: i["date"] or "", reverse=True)
        return src, items[:MAX_ITEMS_PER_SOURCE], None
    except Exception as exc:  # noqa: BLE001 - report any failure per source
        return src, [], f"{type(exc).__name__}: {exc}"


def main() -> int:
    for src in LIVE_SOURCES:
        assert is_trusted(src["url"]), f"Untrusted source URL: {src['url']}"
    for d in DIRECTORY:
        assert is_trusted(d["url"]), f"Untrusted directory URL: {d['url']}"
        for _, u in d["links"]:
            assert is_trusted(u), f"Untrusted directory link: {u}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run_source, LIVE_SOURCES))

    seen, items, status = set(), [], []
    for src, src_items, err in results:
        kept = 0
        for it in src_items:
            # CDC re-publishes FDA/USDA notices, so dedupe on title as well as link.
            key = it["link"].split("#")[0].rstrip("/").lower()
            tkey = re.sub(r"[^a-z0-9]", "", it["title"].lower())
            if key in seen or tkey in seen:
                continue
            seen.update((key, tkey))
            items.append(it)
            kept += 1
        status.append({
            "id": src["id"], "name": src["name"], "agency": src["agency"],
            "region": src["region"], "url": src["url"], "ok": err is None,
            "count": kept, "error": err,
        })
        mark = "OK " if err is None else "ERR"
        print(f"[{mark}] {src['name']}: {kept} items" + (f"  ({err})" if err else ""))

    items.sort(key=lambda i: i["date"] or "", reverse=True)
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "sources": status,
        "directory": DIRECTORY,
        "items": items,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        "// Generated by fetch_feeds.py - do not edit by hand.\n"
        "window.FEED_DATA = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    ok = sum(s["ok"] for s in status)
    print(f"\nWrote {len(items)} items from {ok}/{len(status)} sources to {OUT_FILE.relative_to(ROOT)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
