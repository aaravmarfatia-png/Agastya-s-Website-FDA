#!/usr/bin/env python3
"""Download EU RASFF Window notifications into data/cache/rasff.json (raw, git-ignored).
Polite: one request at a time, 1 s apart. Incremental: stops at the first page that is
already fully cached, unless --full is given.   Usage: python3 scripts/fetch-rasff.py [--full]"""
import json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache" / "rasff.json"
URL = "https://webgate.ec.europa.eu/rasff-window/backend/public/notification/search/consolidated/"

def page(n):
    body = json.dumps({"parameters": {"pageNumber": n, "itemsPerPage": 100}})
    for attempt in range(4):
        p = subprocess.run(["curl", "-s", "-A", "curl/8.7.1", "--max-time", "60", "-X", "POST", URL,
                            "-H", "Content-Type: application/json", "-d", body, "-w", "\n%{http_code}"],
                           capture_output=True, text=True)
        out, _, code = p.stdout.rpartition("\n")
        if code == "200":
            return json.loads(out)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"page {n}: HTTP {code}")

cache = json.loads(CACHE.read_text()) if CACHE.exists() else {"notifications": {}}
known = cache["notifications"]
full = "--full" in sys.argv or not known
first = page(1)
total_pages = first["totalPages"]
print(f"RASFF: {first['totalElements']} notifications, {total_pages} pages; cached {len(known)}", flush=True)
for n in range(1, total_pages + 1):
    data = first if n == 1 else page(n)
    new = 0
    for x in data.get("notifications", []):
        if str(x["notifId"]) not in known:
            new += 1
        known[str(x["notifId"])] = x
    if n % 20 == 0 or n == total_pages:
        CACHE.write_text(json.dumps(cache, separators=(",", ":")))
        print(f"  page {n}/{total_pages} · {len(known)} cached", flush=True)
    if not new and not full:
        print("  reached already-cached notifications; stopping", flush=True)
        break
    time.sleep(1)
cache["fetched"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
CACHE.write_text(json.dumps(cache, separators=(",", ":")))
print(f"done: {len(known)} notifications cached", flush=True)
