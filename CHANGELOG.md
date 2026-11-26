# Changelog

What's new on Food Safety Watch, newest first.

## November 26, 2026 (later): Device check

### ✨ New
- **Device check page.** Linked from About. It tests 3D sound, vibration, webcam face tracking, tilt and graphics on your own device in about a minute, then copies a summary you can send. It uses the 4D globe's real code, so if it works here, it works in the globe.

### 🔧 Improvements
- The globe's frame budget now protects itself: if a frame ever needs more than 100 draw calls, depth of field switches off.
- Screen readers no longer announce a selected country twice, and the trend chart's label now says "food-safety records".

### 🐛 Fixes
- The 4D globe now applies the food-hazard check to WHO and FAO news by source, so no non-food story can slip through.

## November 26, 2026: The 4D globe, finished

### ✨ New
- **Guided tour.** Press **T** (or the ▶ Tour button) and scroll, swipe or use the arrow keys. You travel from a world overview to the countries with the most active food-safety issues, through the data layers, and five years back in time. Each scroll moves one chapter, with smooth momentum.
- **Find a country in 4D.** Press **/** and type any country to fly straight to it. Everything on the globe can now be reached with the keyboard, and selections are read out to screen readers.
- **A globe that reacts to you.** Move the mouse faster and the spacetime grid bends deeper, the stars drift and the 4D cube spins harder.
- **Proper loading screen.** A progress bar shows each step. The globe appears first, then the food-safety data streams in.
- **Tips for first-time visitors**, with touch versions on phones.

### 🔧 Improvements
- **Food safety only, everywhere on the globe.** Country panels no longer show general consumer-product recalls (such as tools or batteries). Those stay on the main Live feed.
- **Phones:** the 4D controls are rearranged so nothing overlaps. The time bar and W-axis are compact and the globe fits a portrait screen.
- **Smoother on older devices:** slower graphics chips automatically get a lighter scene. The 4D view also pauses when the tab is hidden, and the page behind it stops animating, to save battery.
- **Comfort settings respected:** with "reduce motion" turned on there are no camera flights, flashes or wobble effects.
- **Clearer when 4D isn't possible:** devices without WebGL 2 now get an explanation, and the rest of the site still works.
- Turning on 4D audio now also gives soft click sounds on buttons.

### 🐛 Fixes
- Fixed the tour not moving when scrolling slowly with a mouse wheel.
- Fixed an error after choosing a country from the 4D search.
- Fixed the frame-rate readout shortcut on non-US keyboards.
- Local testing no longer drops files: use `npm run serve` instead of Python's server.

## November 24, 2026

### ✨ New
- **Windows app.** The whole site, including the 4D globe, as an installable desktop app (`npm run dist:win`).
- **4D globe:** real country borders, live day and night, a rotating 4D tesseract, a time scrubber from past to trend, a W-axis data slider, webcam "hologram" head tracking, phone tilt, vibration and 3D sound.
- **Food-safety issues for every country** on the globe: FDA recalls, contamination findings, and foodborne or waterborne outbreaks from WHO and ReliefWeb.
- **Every country covered:** all 194 WHO member states, each linking to official sources.
- **Live feed** of recalls, alerts and news from government and UN sources only.

### 🐛 Fixes
- Fixed the 4D globe failing with "couldn't fetch" on the published website.
