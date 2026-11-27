#!/usr/bin/env python3
"""Download FDA Import Alert listings per country into data/cache/fda_import_alerts.json (raw).
One request per country, 1 s apart.   Usage: python3 scripts/fetch-fda-import-alerts.py"""
import html, json, re, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cache" / "fda_import_alerts.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
ROW = re.compile(r"<td>\s*([\d]{2}-[\d]{2,3})\s*</td>\s*<td>\s*([^<]*?)\s*</td>\s*<td>\s*([\d/]+)\s*</td>\s*<td>\s*<a href=\"(importalert_\d+\.html)\">(.*?)</a>", re.S)

raw = (ROOT / "data" / "countries.js").read_text(encoding="utf-8")
countries = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))["countries"]
iso2 = json.loads((ROOT / "data" / "cache" / "iso3to2.json").read_text())
out = {}
for i, c in enumerate(countries):
    code = iso2.get(c["iso3"])
    if not code:
        continue
    p = subprocess.run(["curl", "-s", "-L", "-A", UA, "--max-time", "45", "-w", "\n%{http_code}",
                        f"https://www.accessdata.fda.gov/cms_ia/country_{code}.html"], capture_output=True, text=True, errors="replace")
    body, _, status = p.stdout.rpartition("\n")
    rows = []
    if status == "200":
        for num, typ, date, link, title in ROW.findall(body):
            rows.append({"num": num, "type": typ.strip(), "date": date, "url": "https://www.accessdata.fda.gov/cms_ia/" + link,
                         "title": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title))).strip().strip('"')})
    out[c["iso3"]] = {"status": int(status or 0), "alerts": rows}
    if i % 20 == 0:
        OUT.write_text(json.dumps(out, separators=(",", ":")))
        print(f"  {i}/{len(countries)} countries · {sum(len(v['alerts']) for v in out.values())} alerts", flush=True)
    time.sleep(1)
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(f"done: {sum(len(v['alerts']) for v in out.values())} alerts for {sum(1 for v in out.values() if v['alerts'])} countries", flush=True)
