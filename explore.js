/* =========================================================================
   Food Safety Watch — 4D explorer
   3D globe (drag / inertia / click-to-filter) + time scrubber (4th dimension)
   + 3D tilt cards + count-up stats. No libraries.
   ========================================================================= */
(function () {
  "use strict";
  const F = window.FSW;
  if (!F) return;
  const { DATA, state, DAY, REGION_ORDER, esc } = F;
  const $ = (s) => document.querySelector(s);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rad = Math.PI / 180;

  // Where each region sits on the globe. "Global (UN)" is drawn as an orbiting satellite.
  const PLACES = {
    "United States": { lat: 39, lon: -98, label: "right" },
    "Canada": { lat: 58, lon: -104, label: "right" },
    "United Kingdom": { lat: 54, lon: -3, label: "left" },
    "European Union": { lat: 49, lon: 14, label: "right" },
    "India": { lat: 22, lon: 79, label: "right" },
    "Asia-Pacific": { lat: -27, lon: 140, label: "left" },
  };
  const UN = "Global (UN)";
  const liveRegions = new Set(DATA.items.map((i) => i.region));
  const SHORT = { "United States": "USA", "United Kingdom": "UK", "European Union": "EU", "Global (UN)": "UN" };

  // ======================= TIME (4th dimension) =======================
  const DAYS = 60, WIN = 7;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const dayStart = (i) => today0.getTime() - (DAYS - 1 - i) * DAY;
  const buckets = Array.from({ length: DAYS }, () => ({ Recall: 0, News: 0, Alert: 0, total: 0 }));
  for (const it of DATA.items) {
    if (!it.date) continue;
    const d = new Date(it.date); d.setHours(0, 0, 0, 0);
    const i = DAYS - 1 - Math.round((today0 - d) / DAY);
    if (i < 0 || i >= DAYS) continue;
    buckets[i][it.category] = (buckets[i][it.category] || 0) + 1;
    buckets[i].total++;
  }

  let winEnd = DAYS - 1;           // index of the last day in the window
  let userTouchedTime = false;     // don't filter the feed until the user scrubs
  const fmt = (t, o) => new Date(t).toLocaleDateString(undefined, o);

  function windowRange() {
    const startIdx = Math.max(0, winEnd - WIN + 1);
    return { startIdx, start: dayStart(startIdx), end: dayStart(winEnd) + DAY };
  }
  function windowCounts() {
    const { start, end } = windowRange();
    const byRegion = {}, byCat = { Recall: 0, News: 0, Alert: 0 };
    let total = 0;
    for (const it of DATA.items) {
      const t = it.date ? new Date(it.date).getTime() : NaN;
      if (!(t >= start && t < end)) continue;
      byRegion[it.region] = (byRegion[it.region] || 0) + 1;
      byCat[it.category]++;
      total++;
    }
    return { byRegion, byCat, total };
  }
  function windowLabel() {
    const { start, end } = windowRange();
    const a = fmt(start, { day: "numeric", month: "short" });
    const b = fmt(end - 1, { day: "numeric", month: "short", year: "numeric" });
    return `${a} – ${b}`;
  }

  // ---------- Chart (stacked daily bars, validated palette) ----------
  const W = 600, H = 132, BASE = 108, PLOT = 96, BW = W / DAYS;
  const ORDER = ["Recall", "News", "Alert"]; // blue sits between red & amber
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));

  function drawChart() {
    const { startIdx } = windowRange();
    let bars = "";
    buckets.forEach((b, i) => {
      let y = BASE;
      const x = i * BW + 1;
      ORDER.forEach((c) => {
        const v = b[c] || 0;
        if (!v) return;
        const h = (v / maxTotal) * PLOT;
        const hh = Math.max(h - 2, 1.5);
        y -= h;
        bars += `<rect class="seg-${c.toLowerCase()}" x="${x.toFixed(1)}" y="${(y + (h - hh)).toFixed(1)}" width="${(BW - 2).toFixed(1)}" height="${hh.toFixed(1)}" rx="2"/>`;
      });
    });
    const hits = buckets.map((_, i) => `<rect class="hit" data-i="${i}" x="${(i * BW).toFixed(1)}" y="0" width="${BW.toFixed(1)}" height="${BASE}"/>`).join("");
    const ticks = [0, 29, DAYS - 1].map((i) => {
      const anchor = i === 0 ? "start" : i === DAYS - 1 ? "end" : "middle";
      const x = i === 0 ? 0 : i === DAYS - 1 ? W : i * BW + BW / 2;
      return `<text x="${x}" y="${H - 4}" text-anchor="${anchor}">${i === DAYS - 1 ? "Today" : esc(fmt(dayStart(i), { day: "numeric", month: "short" }))}</text>`;
    }).join("");
    $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Official updates per day over the last 60 days, stacked by recalls, news and alerts. The highlighted band is the selected 7-day window.">
      <rect class="win" x="${(startIdx * BW).toFixed(1)}" y="2" width="${((winEnd - startIdx + 1) * BW).toFixed(1)}" height="${BASE - 2}" rx="6"/>
      <line class="base" x1="0" x2="${W}" y1="${BASE + 0.5}" y2="${BASE + 0.5}"/>
      ${bars}${ticks}${hits}</svg>`;
  }

  const chartTip = $("#chart-tip");
  $("#chart").addEventListener("pointermove", (e) => {
    const r = e.target.closest(".hit");
    if (!r) { chartTip.hidden = true; return; }
    const i = +r.dataset.i, b = buckets[i];
    chartTip.innerHTML = `<b>${esc(fmt(dayStart(i), { weekday: "short", day: "numeric", month: "short" }))}</b>
      <span><i class="sw recall"></i>Recalls<em>${b.Recall || 0}</em></span>
      <span><i class="sw news"></i>News<em>${b.News || 0}</em></span>
      <span><i class="sw alert"></i>Alerts<em>${b.Alert || 0}</em></span>`;
    const box = $("#chart").getBoundingClientRect();
    const wrap = $("#chart").parentElement.getBoundingClientRect();
    const x = box.left - wrap.left + ((i + 0.5) / DAYS) * box.width;
    chartTip.style.left = Math.min(Math.max(x, 70), wrap.width - 70) + "px";
    chartTip.hidden = false;
  });
  $("#chart").addEventListener("pointerleave", () => (chartTip.hidden = true));
  $("#chart").addEventListener("click", (e) => {
    const r = e.target.closest(".hit");
    if (!r) return;
    setWinEnd(Math.max(+r.dataset.i, WIN - 1), true);
  });

  function drawTable() {
    const rows = buckets.map((b, i) => [i, b]).filter(([, b]) => b.total).reverse();
    $("#chart-table").innerHTML = rows.length
      ? `<table><thead><tr><th>Date</th><th>Recalls</th><th>News</th><th>Alerts</th></tr></thead><tbody>${rows.map(([i, b]) =>
          `<tr><td>${esc(fmt(dayStart(i), { day: "numeric", month: "short", year: "numeric" }))}</td><td>${b.Recall || 0}</td><td>${b.News || 0}</td><td>${b.Alert || 0}</td></tr>`).join("")}</tbody></table>`
      : "<p>No dated updates in the last 60 days.</p>";
  }

  // ---------- Readout + region list ----------
  let counts = windowCounts();
  function drawReadout() {
    $("#win-label").textContent = windowLabel();
    const c = counts.byCat;
    $("#win-sum").innerHTML = `<b>${counts.total}</b> updates · ${c.Recall} recalls · ${c.Alert} alerts · ${c.News} news`;
  }
  function drawRegionList() {
    $("#region-list").innerHTML = REGION_ORDER.map((r) => {
      const n = counts.byRegion[r] || 0;
      const live = liveRegions.has(r);
      return `<button class="rchip${state.region === r ? " on" : ""}" data-region="${esc(r)}" aria-pressed="${state.region === r}">
        <span class="rname">${esc(r)}</span><span class="rcount">${live ? n : "links"}</span></button>`;
    }).join("");
  }
  $("#region-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-region]");
    if (b) selectRegion(b.dataset.region);
  });

  function selectRegion(r) {
    if (!liveRegions.has(r)) {
      // No automatic feed for this region (e.g. FSSAI, BIS): jump to its directory entries.
      F.showView("sources");
      requestAnimationFrame(() => {
        const el = document.getElementById("region-" + r.toLowerCase().replace(/[^a-z]+/g, "-"));
        if (el) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      });
      return;
    }
    F.setRegion(state.region === r ? "all" : r);
    drawRegionList();
    const target = $(".controls-shell");
    if (target) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
  $("#region").addEventListener("change", drawRegionList);

  // ---------- Scrubber + play ----------
  const scrub = $("#scrub"), play = $("#play");
  scrub.min = String(WIN - 1);
  let applyRaf = 0;
  function setWinEnd(i, fromUser) {
    winEnd = Math.min(DAYS - 1, Math.max(WIN - 1, i));
    scrub.value = String(winEnd);
    scrub.style.setProperty("--p", ((winEnd - (WIN - 1)) / (DAYS - WIN)) * 100 + "%");
    counts = windowCounts();
    drawChart(); drawReadout(); drawRegionList();
    if (fromUser) userTouchedTime = true;
    if (userTouchedTime) {
      cancelAnimationFrame(applyRaf);
      applyRaf = requestAnimationFrame(() => {
        const { start, end } = windowRange();
        F.setWindow(start, end, "Timeline: " + windowLabel());
      });
    }
  }
  scrub.addEventListener("input", () => { stopPlay(); setWinEnd(+scrub.value, true); });

  let playTimer = 0;
  function stopPlay() {
    clearInterval(playTimer); playTimer = 0;
    play.setAttribute("aria-pressed", "false"); play.setAttribute("aria-label", "Play timeline");
  }
  play.addEventListener("click", () => {
    if (playTimer) return stopPlay();
    if (winEnd >= DAYS - 1) setWinEnd(WIN - 1, true);
    play.setAttribute("aria-pressed", "true"); play.setAttribute("aria-label", "Pause timeline");
    playTimer = setInterval(() => {
      if (winEnd >= DAYS - 1) return stopPlay();
      setWinEnd(winEnd + 1, true);
    }, reduced ? 900 : 380);
  });

  // ======================= 3D GLOBE =======================
  const canvas = $("#globe"), ctx = canvas.getContext("2d"), stage = $("#globe-stage"), tip = $("#globe-tip");
  let size = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let yaw = 40, pitch = 12, vYaw = reduced ? 0 : 0.06, vPitch = 0;
  let dragging = false, moved = 0, lastX = 0, lastY = 0, hover = null, idleAt = 0;
  let colors = {};
  const COUNTRIES = (window.COUNTRIES && window.COUNTRIES.countries) || [];
  const byIso = Object.fromEntries(COUNTRIES.map((c) => [c.iso3, c]));
  let selectedIso = null, fly = null;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { ink: v("--ink"), ink3: v("--ink-3"), sage: v("--sage"), core: v("--core"), bg: v("--bg"), recall: v("--c-recall"), dark: matchMedia("(prefers-color-scheme: dark)").matches };
  }
  readColors();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

  // Fibonacci sphere of dots
  const DOTS = [];
  const N = 1300, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    DOTS.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }

  function resize() {
    const w = stage.clientWidth;
    size = Math.min(w, 560);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = size + "px"; canvas.style.height = size + "px";
    R = size * 0.36; cx = size / 2; cy = size / 2;
    draw(performance.now());
  }

  // rotate a unit vector (x right, y up, z toward viewer) by yaw then pitch
  function rot(x, y, z) {
    const cy_ = Math.cos(yaw * rad), sy = Math.sin(yaw * rad);
    const x1 = x * cy_ + z * sy, z1 = -x * sy + z * cy_;
    const cp = Math.cos(pitch * rad), sp = Math.sin(pitch * rad);
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  }
  const fromLatLon = (lat, lon) => [Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad), Math.cos(lat * rad) * Math.cos(lon * rad)];

  let markers = [];
  function draw(now) {
    if (!size) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const dark = colors.dark;

    // satellite orbit (behind part first)
    const a = reduced ? 0.9 : now * 0.00018;
    const orbit = (t) => {
      const ox = Math.cos(t) * 1.32, oz = Math.sin(t) * 1.32, oy = Math.sin(t) * 0.42;
      return [cx + R * ox, cy - R * oy, oz];
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark ? "rgba(255,245,235,.10)" : "rgba(42,36,32,.10)";
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.05) { const [x, y] = orbit(t); t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.setLineDash([]);
    const sat = orbit(a);

    // atmosphere glow + sphere body
    const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.25);
    glow.addColorStop(0, dark ? "rgba(143,194,170,.16)" : "rgba(38,77,64,.12)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.fill();

    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, dark ? "#2a3430" : "#ffffff");
    body.addColorStop(1, dark ? "#151b19" : "#ece6da");
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    if (sat[2] < 0) drawSatellite(sat, true);

    // graticule (front halves only)
    ctx.strokeStyle = dark ? "rgba(255,245,235,.07)" : "rgba(42,36,32,.07)";
    ctx.lineWidth = 0.8;
    const line = (pts) => {
      ctx.beginPath(); let pen = false;
      for (const [x, y, z] of pts) {
        const p = rot(x, y, z);
        if (p[2] > 0) { const sx = cx + R * p[0], sy = cy - R * p[1]; pen ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); pen = true; }
        else pen = false;
      }
      ctx.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) { const pts = []; for (let lon = -180; lon <= 180; lon += 5) pts.push(fromLatLon(lat, lon)); line(pts); }
    for (let lon = -180; lon < 180; lon += 30) { const pts = []; for (let lat = -90; lat <= 90; lat += 5) pts.push(fromLatLon(lat, lon)); line(pts); }

    // dots with depth shading
    for (const d of DOTS) {
      const p = rot(d[0], d[1], d[2]);
      if (p[2] <= 0) continue;
      const s = 0.5 + p[2] * 1.1;
      ctx.globalAlpha = 0.12 + p[2] * 0.4;
      ctx.fillStyle = colors.ink3;
      ctx.fillRect(cx + R * p[0] - s / 2, cy - R * p[1] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // every country: a pin (filled = verified national authority, ring = WHO page only)
    markers = [];
    for (const c of COUNTRIES) {
      const p = rot(...fromLatLon(c.lat, c.lon));
      if (p[2] <= 0.04) continue;
      const sx = cx + R * p[0], sy = cy - R * p[1];
      const key = "c:" + c.iso3, on = hover === key || selectedIso === c.iso3;
      const r = (c.authorities.length ? 2.6 : 2) * (on ? 1.8 : 1);
      ctx.globalAlpha = Math.min(1, 0.25 + p[2] * 0.9);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (c.authorities.length) { ctx.fillStyle = colors.sage; ctx.fill(); }
      else { ctx.strokeStyle = colors.sage; ctx.lineWidth = 1.1; ctx.stroke(); }
      markers.push({ name: key, x: sx, y: sy, r: 7 });
    }
    ctx.globalAlpha = 1;

    // region markers
    const pulse = reduced ? 0 : (now % 2400) / 2400;
    const list = Object.entries(PLACES).map(([name, pl]) => {
      const p = rot(...fromLatLon(pl.lat, pl.lon));
      return { name, pl, p };
    }).sort((m, n) => m.p[2] - n.p[2]);
    for (const { name, pl, p } of list) {
      if (p[2] <= 0.02) continue;
      const sx = cx + R * p[0], sy = cy - R * p[1];
      const live = liveRegions.has(name);
      const n = counts.byRegion[name] || 0;
      const r = live ? 5 + Math.sqrt(n) * 2.4 : 5;
      const fade = Math.min(1, p[2] * 3);
      const sel = state.region === name, hov = hover === name;
      ctx.globalAlpha = fade;
      if (live && n > 0 && !reduced) {
        ctx.strokeStyle = colors.recall; ctx.lineWidth = 1.5;
        ctx.globalAlpha = fade * (1 - pulse) * 0.7;
        ctx.beginPath(); ctx.arc(sx, sy, r + pulse * 18, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = fade;
      }
      // 2px surface ring keeps overlapping marks legible
      ctx.fillStyle = colors.core;
      ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (live) { ctx.fillStyle = n ? colors.recall : colors.ink3; ctx.fill(); }
      else { ctx.strokeStyle = colors.sage; ctx.lineWidth = 2; ctx.stroke(); }
      if (sel || hov) {
        ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
      // label
      ctx.font = `600 ${size < 380 ? 10.5 : 11.5}px "Plus Jakarta Sans", system-ui, sans-serif`;
      const text = `${SHORT[name] || name} ${live ? n : "↗"}`;
      const tw = ctx.measureText(text).width;
      const lx = pl.label === "left" ? sx - r - 10 - tw : sx + r + 10;
      ctx.fillStyle = colors.core;
      ctx.globalAlpha = fade * 0.85;
      roundRect(lx - 6, sy - 10, tw + 12, 20, 10); ctx.fill();
      ctx.globalAlpha = fade;
      ctx.fillStyle = colors.ink; ctx.textBaseline = "middle";
      ctx.fillText(text, lx, sy + 0.5);
      ctx.globalAlpha = 1;
      markers.push({ name, x: sx, y: sy, r: Math.max(r, 8) + 6 });
    }

    // selected country: beacon + label
    const sc = selectedIso && byIso[selectedIso];
    if (sc) {
      const p = rot(...fromLatLon(sc.lat, sc.lon));
      if (p[2] > 0.04) {
        const sx = cx + R * p[0], sy = cy - R * p[1];
        const beat = reduced ? 0.5 : (now % 1600) / 1600;
        ctx.strokeStyle = colors.sage; ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - beat;
        ctx.beginPath(); ctx.arc(sx, sy, 6 + beat * 22, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.ink;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.font = `600 ${size < 380 ? 11 : 12.5}px "Plus Jakarta Sans", system-ui, sans-serif`;
        const tw = ctx.measureText(sc.name).width;
        ctx.fillStyle = colors.ink;
        roundRect(sx - tw / 2 - 10, sy - 38, tw + 20, 24, 12); ctx.fill();
        ctx.fillStyle = colors.core; ctx.textBaseline = "middle"; ctx.textAlign = "center";
        ctx.fillText(sc.name, sx, sy - 26);
        ctx.textAlign = "start";
      }
    }

    if (sat[2] >= 0) drawSatellite(sat, false);
  }

  function drawSatellite([sx, sy, z], behind) {
    const n = counts.byRegion[UN] || 0;
    const r = 6 + Math.sqrt(n) * 1.8;
    ctx.globalAlpha = behind ? 0.35 : 1;
    ctx.fillStyle = colors.core;
    ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors.sage;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    if (state.region === UN || hover === UN) {
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (!behind) {
      ctx.font = `600 ${size < 380 ? 10.5 : 11.5}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.fillStyle = colors.ink; ctx.textBaseline = "middle";
      ctx.fillText(`UN · WHO / FAO ${n}`, sx + r + 9, sy + 0.5);
      markers.push({ name: UN, x: sx, y: sy, r: r + 8 });
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // animation loop: runs only while the globe is on screen and the tab is visible
  let visible = false, raf = 0;
  function frame(now) {
    raf = 0;
    if (fly && !dragging) {
      const t = Math.min(1, (now - fly.t0) / fly.dur);
      const e = 1 - Math.pow(1 - t, 4);
      yaw = fly.y0 + (fly.y1 - fly.y0) * e;
      pitch = fly.p0 + (fly.p1 - fly.p0) * e;
      vYaw = 0; vPitch = 0; idleAt = now + 5000;
      if (t >= 1) fly = null;
    } else if (!dragging) {
      yaw += vYaw; pitch = clampPitch(pitch + vPitch);
      vPitch *= 0.94;
      const auto = reduced ? 0 : 0.06;
      if (now > idleAt) vYaw += (auto - vYaw) * 0.03; else vYaw *= 0.95;
    }
    draw(now);
    if (visible && !document.hidden && !covered()) raf = requestAnimationFrame(frame);
  }
  // the 2D globe sleeps while the full-screen 4D mode covers it
  const covered = () => document.documentElement.classList.contains("fourd-open");
  const start = () => { if (!raf && visible && !covered()) raf = requestAnimationFrame(frame); };
  new MutationObserver(() => start()).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const clampPitch = (p) => Math.max(-55, Math.min(65, p));
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(stage);
  document.addEventListener("visibilitychange", start);
  new ResizeObserver(resize).observe(stage);

  // fly the camera so a lat/lon sits in the centre of the globe
  function flyTo(lat, lon) {
    let target = -lon;
    let d = ((target - yaw) % 360 + 540) % 360 - 180; // shortest way round
    fly = { y0: yaw, y1: yaw + d, p0: pitch, p1: clampPitch(lat), t0: performance.now(), dur: reduced ? 1 : 1300 };
    if (reduced) { yaw = fly.y1; pitch = fly.p1; fly = null; }
    if (!raf) { draw(performance.now()); start(); }
  }
  window.FSWGlobe = {
    flyTo,
    select(iso) {
      selectedIso = iso;
      const c = byIso[iso];
      if (c) flyTo(c.lat, c.lon);
      else if (!raf) draw(performance.now());
    },
  };

  // pointer: drag with inertia, hover tooltips, click to filter
  function hit(x, y) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      if ((x - m.x) ** 2 + (y - m.y) ** 2 <= m.r ** 2) return m.name;
    }
    return null;
  }
  function local(e) { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; [lastX, lastY] = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId); canvas.classList.add("grabbing");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      [lastX, lastY] = [e.clientX, e.clientY];
      fly = null;
      yaw += dx * 0.35; pitch = clampPitch(pitch + dy * 0.3);
      vYaw = dx * 0.35; vPitch = dy * 0.3;
      idleAt = performance.now() + 2500;
      if (!raf) draw(performance.now());
      tip.hidden = true;
      return;
    }
    const [x, y] = local(e);
    const h = hit(x, y);
    if (h !== hover) { hover = h; if (!raf) draw(performance.now()); }
    canvas.style.cursor = h ? "pointer" : "";
    if (h && h.startsWith("c:")) {
      const c = byIso[h.slice(2)];
      const n = c.authorities.length;
      tip.innerHTML = `<b>${esc(c.name)}</b>${n ? `${n} national authorit${n === 1 ? "y" : "ies"} + WHO` : "WHO country page"}<br><span>Click to open its official sources</span>`;
      tip.style.left = x + "px"; tip.style.top = y + "px";
      tip.hidden = false;
    } else if (h) {
      const n = counts.byRegion[h] || 0;
      tip.innerHTML = liveRegions.has(h)
        ? `<b>${esc(h)}</b>${n} update${n === 1 ? "" : "s"} in this window<br><span>Click to ${state.region === h ? "clear the filter" : "filter the feed"}</span>`
        : `<b>${esc(h)}</b>Direct-link sources only<br><span>Click to open them</span>`;
      tip.style.left = x + "px"; tip.style.top = y + "px";
      tip.hidden = false;
    } else tip.hidden = true;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; canvas.classList.remove("grabbing");
    if (moved < 6) { const [x, y] = local(e); const h = hit(x, y); if (h) {
      tip.hidden = true;
      if (h.startsWith("c:")) document.dispatchEvent(new CustomEvent("fsw:country", { detail: h.slice(2) }));
      else selectRegion(h);
    } }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (!dragging) { hover = null; tip.hidden = true; } });
  canvas.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key];
    if (!k) return;
    e.preventDefault();
    yaw += k[0]; pitch = clampPitch(pitch + k[1]); idleAt = performance.now() + 3000;
    if (!raf) draw(performance.now());
  });

  // ======================= 3D TILT CARDS =======================
  if (!reduced && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    let cur = null, pending = null, tRaf = 0;
    const reset = (el) => { const c = el.querySelector(":scope > .core"); if (c) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); } el.classList.remove("tilting"); };
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest(".tilt");
      if (cur && cur !== el) reset(cur);
      cur = el;
      if (!el) return;
      pending = e;
      if (tRaf) return;
      tRaf = requestAnimationFrame(() => {
        tRaf = 0;
        if (!cur || !pending) return;
        const c = cur.querySelector(":scope > .core");
        if (!c) return;
        const b = c.getBoundingClientRect();
        const px = (pending.clientX - b.left) / b.width, py = (pending.clientY - b.top) / b.height;
        const amp = b.height > 220 ? 4 : 6;
        c.style.setProperty("--rx", ((0.5 - py) * amp).toFixed(2) + "deg");
        c.style.setProperty("--ry", ((px - 0.5) * amp * 1.3).toFixed(2) + "deg");
        c.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
        c.style.setProperty("--my", (py * 100).toFixed(1) + "%");
        cur.classList.add("tilting");
      });
    }, { passive: true });
    document.addEventListener("pointerleave", () => { if (cur) reset(cur); cur = null; });
  }

  // ======================= COUNT-UP STATS =======================
  if (!reduced) {
    const els = [...document.querySelectorAll("#stats dd[data-count]")];
    const t0 = performance.now(), dur = 1400;
    const ease = (t) => 1 - Math.pow(2, -10 * t);
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      for (const el of els) el.textContent = Math.round(+el.dataset.count * ease(t)).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // initial paint
  setWinEnd(DAYS - 1, false);
  drawTable();
})();
