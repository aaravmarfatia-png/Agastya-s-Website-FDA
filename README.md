# Food Safety Watch

One page that collects food recalls, allergy alerts and consumer-protection news from
**government and United Nations sources only**.

## Use it

1. Get the latest data:
   ```
   python3 fetch_feeds.py
   ```
2. Open `index.html` in a browser. No web server is needed.

Run step 1 again whenever you want fresh data. Opening `index.html` directly works, but serving it is closer to a real website:
```
python3 -m http.server 8000
```
then visit http://localhost:8000. To refresh every morning at 7am, add this with `crontab -e`:
```
0 7 * * * cd "/Users/aaravmarfatia/Documents/Agastya's Website FDA" && /opt/homebrew/bin/python3 fetch_feeds.py
```

## Files

| File | What it does |
|---|---|
| `fetch_feeds.py` | Downloads the official feeds and writes `data/feed.js`. Also holds the list of sources and the domain allowlist. |
| `data/feed.js` | The collected data. Created by the script, so don't edit it by hand. |
| `build_countries.py` | Checks a national food safety / health / consumer authority for each of the 194 WHO member states and writes `data/countries.js`. Every country also gets its WHO country page. Links that don't respond or show an error or maintenance page are dropped. Run it occasionally (it takes a couple of minutes). |
| `data/countries.js` | The country list. Created by `build_countries.py`. |
| `index.html`, `styles.css`, `app.js` | The website: live feed, search and filters, trusted-source directory, About page. |
| `explore.js` | The 3D globe (every country is a pin), the 60-day timeline with play button, and 3D card tilt. |
| `countries-ui.js` | Country search, "surprise me", the slide-in country panel and the "Every country" directory. |
| `cursor.js` | Mouse effects: cursor follower, spotlight, magnetic buttons, parallax. |

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

## 4D globe

Click **4D globe** in the top menu, or open `http://localhost:8000/?4d`. It needs the local server and a browser with WebGL 2.

**Setup (once):**
```
npm install                     # three, gsap, topojson-client, world-atlas, @mediapipe/tasks-vision
node scripts/build-world.mjs    # data/world-50m.json: country borders tagged with ISO3 codes
python3 fetch_crises.py         # data/crises.json: food-safety issues per country
python3 -m http.server 8000
```
The site loads these packages straight from `node_modules` through an import map in `index.html`, so there's no build step. If you host the site, upload `node_modules` along with it, or copy across the files the import map points to.

**What's in it:**

| Feature | How it works |
|---|---|
| Earth | Country borders (Natural Earth via world-atlas) drawn into a land texture and a country-ID texture. Sunlight comes from the real sub-solar point for the selected UTC time. Also: Rayleigh-tinted atmosphere, procedural clouds, ocean glint. |
| Hover / click | Hovering raises the country with a glowing edge. Clicking flies the camera into low orbit and sends a shockwave across the globe and the spacetime grid. A panel lists the country's food-safety issues (recalls, contamination, foodborne and waterborne outbreaks) and its official food-safety sources. Arcs connect it to countries sharing the same outbreak. |
| 4D lattice | A tesseract rotated in the XW/YW/ZW planes and projected from 4D to 3D, plus a spacetime grid bent by the globe's "mass", the cursor and shockwaves. A post-processing pass adds gravitational lensing, chromatic aberration, bloom and depth of field. |
| W-axis slider (right; also Shift+scroll, `[` / `]`) | Changes the 4D projection and switches data layers: borders & food-safety sources → recall & alert density → foodborne outbreak density. |
| Time scrubber (bottom; Space, `L` for live) | Past issues → live present → trend projection. Scrubbing spins the Earth, moves the sunlight, rotates the tesseract through W and updates the beacons. |
| Hologram (webcam) | Optional. Uses MediaPipe face detection in the browser to shift the camera view as your head moves, so the screen behaves like a window. Video never leaves the device, and the camera turns off when you switch it off or exit. |
| Motion | On phones and tablets: tilting shifts the view, and shaking sends a shockwave. On iOS, the browser asks for permission first. |
| Haptics | Vibration patterns on supported phones: a tick on hover, a heartbeat on selecting a country, a rumble with the shockwave. iOS Safari doesn't support vibration. |
| 4D audio | Off until you turn it on. Generated drones and pings use HRTF 3D sound, so they move around your head as the globe turns. |
| Performance | The resolution adjusts automatically to aim for 60 fps (or choose High/Low). Exiting releases everything: WebGL, webcam, audio and event listeners. |

**Data: food-safety issues only, from official sources.** Natural disasters, conflicts, hunger/food security and non-food diseases are left out.
- **U.S. FDA (openFDA food enforcement reports):** food recalls, including recalls by firms in 30+ other countries. U.S. recalls are placed by state. Recalls for lead, other chemicals or adulteration count as contamination.
- **WHO Disease Outbreak News:** outbreaks of foodborne and waterborne diseases (cholera, typhoid, hepatitis A/E, botulism, Salmonella, Listeria, E. coli…), plus contamination events such as methanol or melamine.
- **ReliefWeb (UN OCHA):** foodborne and waterborne epidemics.
- **The site's national feeds:** FDA, CDC, UK Food Standards Agency and CFIA recalls and alerts. WHO/FAO news is used only when it names a food-safety hazard.

The browser refreshes openFDA and WHO live, and uses `data/crises.json` if they can't be reached. Nothing is invented: a country with no records says so.

The "future" part of the timeline is a straight-line trend of each country's yearly food-safety record counts. It is labelled as such and is not a forecast. ReliefWeb's history is kept in `data/cache/` (git-ignored). Its JSON API needs an approved app name (https://apidoc.reliefweb.int/#appname), so missing countries are fetched from its public RSS one at a time, with pauses.
