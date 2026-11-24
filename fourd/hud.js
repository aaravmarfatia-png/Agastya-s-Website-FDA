// HUD markup + rendering for the 4D mode (plain DOM, glassmorphic panels styled in styles.css).
import { esc, host, DAY_MS } from "./util.js";
import { GROUPS } from "./crises.js";

export function createHud(root, { motionSupported }) {
  root.insertAdjacentHTML("beforeend", `
  <div class="fd-hud" data-hud="on">
    <header class="fd-top fd-glass">
      <button class="fd-btn fd-exit" data-act="exit" aria-label="Exit 4D mode (Esc)"><span aria-hidden="true">←</span> Exit 4D</button>
      <div class="fd-title"><b>Food Safety Watch <i>4D</i></b><span>Food-safety issues · official government &amp; UN sources</span></div>
      <div class="fd-toggles" role="toolbar" aria-label="4D controls">
        <button class="fd-btn" data-t="holo" aria-pressed="false" title="Uses your webcam on this device only to track your head">Hologram (webcam)</button>
        ${motionSupported ? '<button class="fd-btn" data-t="motion" aria-pressed="false">Motion</button>' : ""}
        <button class="fd-btn" data-t="audio" aria-pressed="false">Enable 4D audio</button>
        <button class="fd-btn" data-t="haptics" aria-pressed="true" title="Vibration on supported phones">Haptics</button>
        <label class="fd-select"><span class="sr-only">Render quality</span>
          <select data-t="quality"><option value="auto">Auto quality</option><option value="high">High</option><option value="low">Low</option></select></label>
        <button class="fd-btn" data-t="hud" aria-pressed="true" title="Hide panels (H)">Hide HUD</button>
      </div>
    </header>

    <aside class="fd-panel fd-glass" hidden aria-live="polite"></aside>

    <div class="fd-w fd-glass">
      <label for="fd-w-range" class="fd-w-title">W-axis depth</label>
      <input id="fd-w-range" type="range" min="0" max="2" step="0.01" value="0" aria-valuetext="Borders and food-safety sources">
      <ol class="fd-w-layers">
        <li data-l="2">Foodborne outbreak density</li>
        <li data-l="1">Recall &amp; alert density</li>
        <li data-l="0" class="on">Borders &amp; food-safety sources</li>
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
        <div class="fd-ticks"><span>Past issues</span><span class="fd-now">Live present</span><span>Trend projection</span></div>
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
  };
}

const fmtDate = (ms, o = { day: "numeric", month: "short", year: "numeric" }) => new Date(ms).toLocaleDateString(undefined, o);

function eventRow(e) {
  const g = GROUPS[e.group] || GROUPS.humanitarian;
  return `<li><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">
    <span class="fd-ev-type"><i style="background:${g.color}"></i>${esc(e.label)}${e.level ? ` · ${esc(e.level)} alert` : ""}</span>
    <b>${esc(e.title)}</b>
    ${e.detail ? `<span class="fd-ev-detail">${esc(e.detail.length > 170 ? e.detail.slice(0, 170) + "…" : e.detail)}</span>` : ""}
    <small>${esc(fmtDate(e.date))} · ${esc(e.source)} · ${esc(host(e.url))} ↗</small></a></li>`;
}

/** Render the country HUD. */
export function renderCountry(el, { name, iso3, meta, active, history, trend, simMs, nowMs, liveStatus }) {
  const future = simMs > nowMs + DAY_MS;
  let trendHtml = "";
  if (trend) {
    const max = Math.max(1, ...trend.counts);
    const yearsAhead = (simMs - nowMs) / (365.25 * DAY_MS);
    const proj = Math.max(0, trend.mean + trend.slope * (4.5 + Math.max(0, yearsAhead)));
    const dir = trend.slope > 0.05 ? "rising" : trend.slope < -0.05 ? "falling" : "flat";
    trendHtml = `<section><h3>Food-safety records per year</h3>
      <div class="fd-spark" role="img" aria-label="Disasters per year ${trend.firstYear} to ${trend.firstYear + 9}: ${trend.counts.join(", ")}">
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
    <section><h3>${future ? "Food-safety issues up to now" : `Food-safety issues on ${esc(fmtDate(simMs))}`} <em>${active.length}</em></h3>
      ${active.length ? `<ul class="fd-events">${active.slice(0, 8).map(eventRow).join("")}</ul>`
        : `<p class="fd-note">No recall, contamination or foodborne-outbreak record from these sources is active on this date.</p>`}</section>
    ${trendHtml}
    ${history.length ? `<section><h3>Earlier food-safety issues</h3><ul class="fd-events fd-compact">${history.slice(0, 6).map(eventRow).join("")}</ul></section>` : ""}
    ${sources.length ? `<section><h3>Official food-safety sources</h3><ul class="fd-sources">${sources.map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><small>${esc(s.tag)}</small><b>${esc(s.name)}</b><span>${esc(host(s.url))} ↗</span></a></li>`).join("")}</ul></section>` : ""}
    <p class="fd-attrib">Data: U.S. FDA (openFDA &amp; recalls), WHO Disease Outbreak News, ReliefWeb (UN OCHA), CDC, UK FSA, CFIA · ${liveStatus === "live" ? "live + snapshot" : "saved snapshot"}</p>`;
  el.hidden = false;
}
