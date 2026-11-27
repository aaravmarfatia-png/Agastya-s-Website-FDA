// HUD markup + rendering for the 4D mode (plain DOM, glassmorphic panels styled in styles.css).
import { esc, host, DAY_MS } from "./util.js";
import { GROUPS } from "./crises.js";

export function createHud(root, { motionSupported, touch }) {
  root.insertAdjacentHTML("beforeend", `
  <div class="fd-hud" data-hud="on">
    <header class="fd-top fd-glass">
      <button class="fd-btn fd-exit" data-act="exit" aria-label="Exit 4D mode (Esc)"><span aria-hidden="true">←</span> Exit 4D</button>
      <div class="fd-title"><b>Food Safety Watch <i>4D</i></b><span>Food-safety issues · official government &amp; UN sources</span></div>
      <div class="fd-toggles" role="toolbar" aria-label="4D controls">
        <button class="fd-btn fd-tour-btn" data-t="tour" aria-pressed="false" title="Guided tour: scroll, swipe or use the arrow keys (T)">▶ Tour</button>
        <button class="fd-btn" data-t="holo" aria-pressed="false" title="Uses your webcam on this device only to track your head">Hologram (webcam)</button>
        ${motionSupported ? '<button class="fd-btn" data-t="motion" aria-pressed="false">Motion</button>' : ""}
        <button class="fd-btn" data-t="audio" aria-pressed="false">Enable 4D audio</button>
        <button class="fd-btn" data-t="haptics" aria-pressed="true" title="Vibration on supported phones">Haptics</button>
        <label class="fd-select"><span class="sr-only">Render quality</span>
          <select data-t="quality"><option value="auto">Auto quality</option><option value="high">High</option><option value="low">Low</option></select></label>
        <button class="fd-btn" data-t="hud" aria-pressed="true" title="Hide panels (H)">Hide HUD</button>
      </div>
    </header>

    <div class="fd-finder fd-glass" role="search">
      <label class="sr-only" for="fd-find">Find a country on the globe</label>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="fd-find" type="search" placeholder="Find a country… (/)" autocomplete="off" role="combobox"
             aria-expanded="false" aria-controls="fd-find-list" aria-autocomplete="list">
      <ul id="fd-find-list" class="fd-find-list" role="listbox" hidden></ul>
    </div>

    <aside class="fd-panel fd-glass" hidden aria-label="Country details"></aside>

    <section class="fd-tour fd-glass" hidden aria-live="polite" aria-label="Guided tour">
      <div class="fd-tour-step"></div>
      <h2 class="fd-tour-title"></h2>
      <p class="fd-tour-text"></p>
      <div class="fd-tour-nav">
        <button class="fd-btn fd-round" data-act="tour-prev" aria-label="Previous chapter">↑</button>
        <ol class="fd-tour-dots" aria-hidden="true"></ol>
        <button class="fd-btn fd-round" data-act="tour-next" aria-label="Next chapter">↓</button>
        <button class="fd-btn" data-act="tour-end">End tour</button>
      </div>
      <p class="fd-tour-hint">${touch ? "Swipe up or down to travel" : "Scroll, or use ↑ ↓, to travel"}</p>
    </section>

    <div class="fd-hints fd-glass" hidden role="note" aria-label="How to explore">
      ${touch
        ? `<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10m0 0-3-3m3 3 3-3M6 13a6 6 0 0 0 12 0"/></svg>Drag to orbit</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l-3-3m0 0v4m0-4h4M17 17l3 3m0 0v-4m0 4h-4"/></svg>Pinch to zoom</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>Tap a country</span>`
        : `<span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/></svg>Drag to orbit · scroll to zoom</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>Click a country</span><span><kbd>Shift</kbd>+scroll: W-axis</span><span><kbd>T</kbd> guided tour</span>`}
      <button class="fd-btn fd-round" data-act="hints-close" aria-label="Dismiss tips">✕</button>
    </div>

    <div class="fd-debug" hidden aria-hidden="true"></div>
    <p class="sr-only fd-sr" aria-live="polite"></p>

    <div class="fd-w fd-glass">
      <label for="fd-w-range" class="fd-w-title">W-axis depth</label>
      <input id="fd-w-range" type="range" min="0" max="2" step="0.01" value="0" aria-valuetext="Borders and food-safety sources">
      <ol class="fd-w-layers">
        <li data-l="2"><span class="lg">Foodborne outbreak density</span><span class="sm">Outbreaks</span></li>
        <li data-l="1"><span class="lg">Recall &amp; alert density</span><span class="sm">Recalls</span></li>
        <li data-l="0" class="on"><span class="lg">Borders &amp; food-safety sources</span><span class="sm">Borders</span></li>
      </ol>
    </div>

    <div class="fd-legend fd-glass" aria-label="Beacon legend">
      ${Object.values(GROUPS).map((g) => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join("")}
      <span class="fd-legend-note">Height: FDA recall class, or issue type</span>
    </div>

    <footer class="fd-time fd-glass">
      <div class="fd-time-row">
        <button class="fd-btn fd-round" data-act="rew" aria-label="Rewind through time"><svg viewBox="0 0 24 24"><path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z"/></svg></button>
        <button class="fd-btn fd-round fd-play" data-act="play" aria-label="Play forward through time" aria-pressed="false">
          <svg class="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg><svg class="i-pause" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>
        <button class="fd-btn fd-round" data-act="ff" aria-label="Fast-forward through time"><svg viewBox="0 0 24 24"><path d="M13 6l7 6-7 6zM4 6l7 6-7 6z"/></svg></button>
        <div class="fd-readout"><b class="fd-date"></b><span class="fd-mode"></span><span class="fd-count"></span></div>
        <button class="fd-btn fd-live" data-act="live">● Live</button>
      </div>
      <div class="fd-track">
        <input class="fd-scrub" type="range" min="0" max="1000" step="1" aria-label="4D time scrubber: past food-safety issues, live present, statistical trend">
        <div class="fd-ticks"><span><span class="lg">Past issues</span><span class="sm">Past</span></span><span class="fd-now"><span class="lg">Live present</span><span class="sm">Now</span></span><span><span class="lg">Trend projection</span><span class="sm">Trend</span></span></div>
      </div>
    </footer>

    <div class="fd-tip" hidden></div>
    <div class="fd-status"></div>
    <video class="fd-cam" muted playsinline hidden aria-label="Webcam preview for head tracking"></video>
  </div>
  <button class="fd-btn fd-restore" data-t="hud" hidden>Show HUD</button>`);
  const q = (s) => root.querySelector(s);
  return {
    hud: q(".fd-hud"), panel: q(".fd-panel"), tip: q(".fd-tip"), status: q(".fd-status"), cam: q(".fd-cam"),
    w: q("#fd-w-range"), layers: root.querySelectorAll(".fd-w-layers li"), scrub: q(".fd-scrub"),
    date: q(".fd-date"), mode: q(".fd-mode"), count: q(".fd-count"), play: q(".fd-play"), restore: q(".fd-restore"),
    nowTick: q(".fd-now"),
    find: q("#fd-find"), findList: q("#fd-find-list"), tour: q(".fd-tour"), tourStep: q(".fd-tour-step"),
    tourTitle: q(".fd-tour-title"), tourText: q(".fd-tour-text"), tourDots: q(".fd-tour-dots"),
    hints: q(".fd-hints"), debug: q(".fd-debug"), sr: q(".fd-sr"),
  };
}

const fmtDate = (ms, o = { day: "numeric", month: "short", year: "numeric" }) => new Date(ms).toLocaleDateString(undefined, o);

function eventRow(e) {
  const g = GROUPS[e.group] || GROUPS.alert;
  return `<li><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">
    <span class="fd-ev-type"><i style="background:${g.color}"></i>${esc(e.label || g.label)}</span>
    <b>${esc(e.title)}</b>
    ${e.detail ? `<span class="fd-ev-detail">${esc(e.detail.length > 170 ? e.detail.slice(0, 170) + "…" : e.detail)}</span>` : ""}
    <small>${esc(fmtDate(e.date))} · ${esc(e.source)} · ${esc(host(e.url))} ↗</small></a></li>`;
}

/** Render the country HUD. */
export function renderCountry(el, { name, iso3, meta, active, history, historyLimit = 20, total = 0, bySource = {}, trend, simMs, nowMs, liveStatus }) {
  const future = simMs > nowMs + DAY_MS;
  let trendHtml = "";
  if (trend) {
    const max = Math.max(1, ...trend.counts);
    const yearsAhead = (simMs - nowMs) / (365.25 * DAY_MS);
    const proj = Math.max(0, trend.mean + trend.slope * (4.5 + Math.max(0, yearsAhead)));
    const dir = trend.slope > 0.05 ? "rising" : trend.slope < -0.05 ? "falling" : "flat";
    trendHtml = `<section><h3>Food-safety records per year</h3>
      <div class="fd-spark" role="img" aria-label="Food-safety records per year ${trend.firstYear} to ${trend.firstYear + 9}: ${trend.counts.join(", ")}">
        ${trend.counts.map((c, i) => `<span style="--h:${(c / max) * 100}%" title="${trend.firstYear + i}: ${c}"></span>`).join("")}
        ${future ? `<span class="ghost" style="--h:${Math.min(100, (proj / max) * 100)}%" title="Trend value for ${new Date(simMs).getUTCFullYear()}: ${proj.toFixed(1)}"></span>` : ""}
      </div>
      <div class="fd-spark-axis"><span>${trend.firstYear}</span><span>${trend.firstYear + 9}</span></div>
      <p class="fd-note">Average ${trend.mean.toFixed(1)} a year, trend ${dir} (${trend.slope >= 0 ? "+" : ""}${trend.slope.toFixed(2)}/yr).
      ${future ? `<b>Trend value for ${new Date(simMs).getUTCFullYear()}: ${proj.toFixed(1)}.</b> ` : ""}A straight-line trend of past records, not a forecast.</p></section>`;
  }
  const sources = meta ? [...meta.authorities.map((a) => ({ ...a, tag: "Government" })), { name: "WHO country office", url: meta.who, tag: "United Nations" }] : [];
  el.innerHTML = `
    <div class="fd-panel-head">
      <div><span class="fd-eyebrow">${esc(meta ? meta.continent : "Territory")} · ${esc(iso3 || "—")}</span><h2>${esc(name)}</h2></div>
      <button class="fd-btn fd-round" data-act="close" aria-label="Close country panel">✕</button>
    </div>
    <p class="fd-records"><b>${total.toLocaleString()}</b> official food-safety record${total === 1 ? "" : "s"}${total ? ": " + Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v.toLocaleString()}`).join(", ") : ". No recall, border rejection, import alert or foodborne outbreak for this country appears in these official sources."}</p>
    <section><h3>${future ? "Food-safety issues up to now" : `Food-safety issues on ${esc(fmtDate(simMs))}`} <em>${active.length}</em></h3>
      ${active.length ? `<ul class="fd-events">${active.slice(0, 12).map(eventRow).join("")}</ul>`
        : `<p class="fd-note">No recall, contamination or foodborne-outbreak record from these sources is active on this date.</p>`}</section>
    ${trendHtml}
    ${history.length ? `<section><h3>Earlier food-safety issues <em>${history.length.toLocaleString()}</em></h3><ul class="fd-events fd-compact">${history.slice(0, historyLimit).map(eventRow).join("")}</ul>
      ${history.length > historyLimit ? `<button class="fd-btn fd-more" data-act="more">Show ${Math.min(20, history.length - historyLimit)} more of ${(history.length - historyLimit).toLocaleString()}</button>` : ""}</section>` : ""}
    ${sources.length ? `<section><h3>Official food-safety sources</h3><ul class="fd-sources">${sources.map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><small>${esc(s.tag)}</small><b>${esc(s.name)}</b><span>${esc(host(s.url))} ↗</span></a></li>`).join("")}</ul></section>` : ""}
    <p class="fd-attrib">Data: EU RASFF (European Commission), U.S. FDA import alerts, openFDA recalls, WHO Disease Outbreak News, ReliefWeb (UN OCHA), CDC, UK FSA, CFIA. ${liveStatus === "live" ? "Live and saved data." : "Saved data."}</p>`;
  el.hidden = false;
}
