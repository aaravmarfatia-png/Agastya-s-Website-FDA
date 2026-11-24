# Food Safety Watch

One page that collects food recalls, allergy alerts and consumer-protection news from
**government and United Nations sources only**.

## Use it

1. Get the latest data:
   ```
   python3 fetch_feeds.py
   ```
2. Open `index.html` in a browser. No web server is needed.

Run step 1 again whenever you want fresh data. To refresh every morning at 7am, add this with `crontab -e`:
```
0 7 * * * cd "/Users/aaravmarfatia/Documents/Agastya's Website FDA" && /opt/homebrew/bin/python3 fetch_feeds.py
```

## Files

| File | What it does |
|---|---|
| `fetch_feeds.py` | Downloads the official feeds and writes `data/feed.js`. Also holds the list of sources and the domain allowlist. |
| `data/feed.js` | The collected data. Created by the script, so don't edit it by hand. |
| `index.html`, `styles.css`, `app.js` | The website: live feed, search and filters, trusted-source directory, About page. |

## Sources

**Pulled in automatically:** FDA (recalls, allergy alerts, press releases, openFDA enforcement
reports), CDC food safety, CPSC recalls, UK Food Standards Agency alerts, CFIA and Health Canada
recalls, EFSA news, WHO news and FAO news (WHO and FAO are filtered to food-related stories).

**Direct links only:** FSSAI, BIS, NHS, India's Department of Consumer Affairs, PIB, USDA FSIS,
FoodSafety.gov, FTC, Food Standards Scotland, EU RASFF, FSANZ, NZ MPI, Singapore Food Agency,
Codex Alimentarius and UNCTAD. These sites either have no public feed or block automated reading.

## The trust rule

`TRUSTED_SUFFIXES` in `fetch_feeds.py` lists the allowed domains (`.gov`, `.gov.uk`, `.nhs.uk`,
`.gov.in`, `canada.ca`, `europa.eu`, `who.int`, `fao.org`, `un.org` and others). Any item whose link
is outside that list is dropped. The script also refuses to run if a configured source isn't on it.

To add a source, add an entry to `LIVE_SOURCES` (for a feed) or `DIRECTORY` (for a link) and run the
script again.
