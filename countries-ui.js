/* =========================================================================
   Food Safety Watch — every country
   • country finder (combobox) + "surprise me" on the globe panel
   • slide-in country drawer with its official sources
   • "Every country" directory on the Trusted sources page
   ========================================================================= */
(function () {
  "use strict";
  const DATA = window.COUNTRIES;
  const F = window.FSW;
  if (!DATA || !F) return;
  const { esc } = F;
  const $ = (s) => document.querySelector(s);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const all = [...DATA.countries].sort((a, b) => a.name.localeCompare(b.name));
  const byIso = Object.fromEntries(all.map((c) => [c.iso3, c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const arrow = '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>';
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Countries whose alerts are pulled into the live feed
  const EU = "AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE".split(" ");
  const liveRegions = new Set(F.DATA.items.map((i) => i.region));
  function feedRegion(iso) {
    const r = { USA: "United States", GBR: "United Kingdom", CAN: "Canada" }[iso] || (EU.includes(iso) ? "European Union" : null);
    return r && liveRegions.has(r) ? r : null;
  }

  // ---------------- Finder (combobox) ----------------
  const q = $("#country-q"), list = $("#country-results");
  let results = [], active = -1;
  function search(term) {
    const t = norm(term.trim());
    if (!t) return [];
    const starts = [], has = [];
    const aliases = window.FSW_ALIASES || {};
    for (const c of all) {
      const n = norm(c.name), aka = (aliases[c.iso3] || []).map(norm);
      if (n.startsWith(t) || c.iso3.toLowerCase() === t || aka.some((a) => a.startsWith(t))) starts.push(c);
      else if (n.includes(t) || aka.some((a) => a.includes(t))) has.push(c);
    }
    return starts.concat(has).slice(0, 7);
  }
  function renderResults() {
    if (!results.length) {
      list.hidden = !q.value.trim();
      list.innerHTML = q.value.trim() ? '<li class="none">No country matches that name.</li>' : "";
      q.setAttribute("aria-expanded", String(!list.hidden));
      return;
    }
    list.innerHTML = results.map((c, i) => `<li role="option" id="opt-${c.iso3}" data-iso="${c.iso3}" aria-selected="${i === active}">
      <span>${esc(c.name)}</span><small>${esc(c.continent)} · ${c.authorities.length ? c.authorities.length + 1 : 1} source${c.authorities.length ? "s" : ""}</small></li>`).join("");
    list.hidden = false;
    q.setAttribute("aria-expanded", "true");
    q.setAttribute("aria-activedescendant", active >= 0 ? "opt-" + results[active].iso3 : "");
  }
  q.addEventListener("input", () => { results = search(q.value); active = results.length ? 0 : -1; renderResults(); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      renderResults();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); choose(results[active].iso3);
    } else if (e.key === "Escape") { list.hidden = true; q.setAttribute("aria-expanded", "false"); }
  });
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest("[data-iso]");
    if (li) { e.preventDefault(); choose(li.dataset.iso); }
  });
  q.addEventListener("blur", () => setTimeout(() => { list.hidden = true; q.setAttribute("aria-expanded", "false"); }, 120));
  function choose(iso) {
    q.value = ""; results = []; list.hidden = true; q.setAttribute("aria-expanded", "false");
    openCountry(iso);
  }

  $("#dice").addEventListener("click", () => {
    const btn = $("#dice");
    btn.classList.remove("roll"); void btn.offsetWidth; btn.classList.add("roll");
    openCountry(all[Math.floor(Math.random() * all.length)].iso3);
  });

  // ---------------- Drawer ----------------
  const drawer = $("#drawer"), backdrop = $("#drawer-backdrop"), body = $("#drawer-body");
  let current = null, returnFocus = null;

  function sourceRow(name, url, tag) {
    return `<a class="srow" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      <span class="srow-text"><span class="srow-tag">${esc(tag)}</span><b>${esc(name)}</b><small>${esc(host(url))}</small></span>
      <span class="cta-icon" aria-hidden="true">${arrow}</span></a>`;
  }

  function openCountry(iso) {
    const c = byIso[iso];
    if (!c) return;
    if (!drawer.classList.contains("open")) returnFocus = document.activeElement;
    current = iso;
    if (window.FSWGlobe) window.FSWGlobe.select(iso);

    const peers = all.filter((x) => x.continent === c.continent);
    const idx = peers.indexOf(c);
    const region = feedRegion(iso);
    const recent = region ? F.DATA.items.filter((i) => i.region === region && i.date && Date.now() - new Date(i.date) < 30 * F.DAY).length : 0;

    body.innerHTML = `
      <div class="drawer-top">
        <span class="eyebrow">${esc(c.continent)}</span>
        <button class="drawer-close" data-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <h2 id="drawer-title">${esc(c.name)}</h2>
      <p class="drawer-sub">${c.authorities.length
        ? `${c.authorities.length} verified national authorit${c.authorities.length === 1 ? "y" : "ies"} and the WHO country office.`
        : "No national food safety site could be verified automatically, so the WHO country page is listed. It links to the national health authorities."}</p>
      ${region ? `<button class="cta drawer-feed" data-feed="${esc(region)}">
          <span>See ${recent} ${esc(region)} alert${recent === 1 ? "" : "s"} from the last 30 days</span>
          <span class="cta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg></span>
        </button>` : ""}
      <div class="srows">
        ${c.authorities.map((a) => sourceRow(a.name, a.url, "Government")).join("")}
        ${sourceRow("WHO country office: " + c.name, c.who, "United Nations")}
      </div>
      <section class="drawer-issues" aria-live="polite"><h3>Food-safety issues</h3><p class="drawer-sub">Loading official records…</p></section>
      <div class="drawer-nav">
        <button data-go="${esc(peers[(idx - 1 + peers.length) % peers.length].iso3)}"><span aria-hidden="true">←</span> ${esc(peers[(idx - 1 + peers.length) % peers.length].name)}</button>
        <span>${idx + 1} / ${peers.length} in ${esc(c.continent)}</span>
        <button data-go="${esc(peers[(idx + 1) % peers.length].iso3)}">${esc(peers[(idx + 1) % peers.length].name)} <span aria-hidden="true">→</span></button>
      </div>`;

    loadIssues(iso);
    body.classList.remove("swap"); void body.offsetWidth; body.classList.add("swap");
    drawer.classList.add("open"); backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    setTimeout(() => body.querySelector("[data-close]").focus({ preventScroll: true }), reduced ? 0 : 60);
    document.querySelectorAll(".wcard.on").forEach((el) => el.classList.remove("on"));
    const card = document.querySelector(`.wcard[data-iso="${iso}"]`);
    if (card) card.classList.add("on");
  }

  // Recent food-safety issues for the country, from data/issues/<ISO3>.json (built by fetch_crises.py)
  const issueCache = new Map();
  async function loadIssues(iso) {
    const box = body.querySelector(".drawer-issues");
    try {
      if (!issueCache.has(iso)) issueCache.set(iso, fetch(`data/issues/${iso}.json`).then((r) => (r.ok ? r.json() : { items: [] })));
      const data = await issueCache.get(iso);
      if (current !== iso || !box.isConnected) return;
      const items = data.items || [];
      const bySource = {};
      for (const i of items) bySource[i.source] = (bySource[i.source] || 0) + 1;
      let shown = 10;
      const render = () => {
        box.innerHTML = `<h3>Food-safety issues <span class="issue-total">${items.length.toLocaleString()}</span></h3>
          <p class="drawer-sub">${items.length ? Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: ${v.toLocaleString()}`).join("<br>")
            : "No recall, border rejection, import alert or foodborne outbreak for this country appears in the official sources this site reads."}</p>
          <ol class="issue-list">${items.slice(0, shown).map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
            <b>${esc(i.title)}</b><small>${esc(new Date(i.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }))}, ${esc(i.label || i.source)}</small></a></li>`).join("")}</ol>
          ${items.length > shown ? `<button class="issue-more" type="button">Show ${Math.min(20, items.length - shown)} more</button>` : ""}`;
        const more = box.querySelector(".issue-more");
        if (more) more.addEventListener("click", () => { shown += 20; render(); });
      };
      render();
    } catch {
      box.innerHTML = `<h3>Food-safety issues</h3><p class="drawer-sub">Couldn't load the records. Check the connection and open the country again.</p>`;
    }
  }

  function closeDrawer() {
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open"); backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    current = null;
    if (window.FSWGlobe) window.FSWGlobe.select(null);
    document.querySelectorAll(".wcard.on").forEach((el) => el.classList.remove("on"));
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
  }

  drawer.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeDrawer();
    const go = e.target.closest("[data-go]");
    if (go) return openCountry(go.dataset.go);
    const fb = e.target.closest("[data-feed]");
    if (fb) {
      closeDrawer();
      F.showView("feed");
      F.setRegion(fb.dataset.feed);
      const sel = $("#period"); sel.value = "30"; F.state.period = "30"; sel.dispatchEvent(new Event("change"));
      requestAnimationFrame(() => $(".controls-shell").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
    }
  });
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (!current) return;
    if (e.key === "Escape") closeDrawer();
    if (e.key === "Tab") { // keep focus inside the dialog
      const f = [...drawer.querySelectorAll("a, button")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  document.addEventListener("fsw:country", (e) => openCountry(e.detail));

  // ---------------- "Every country" directory ----------------
  const CONTS = ["All", "Africa", "Americas", "Asia", "Europe", "Oceania"];
  const ws = { cont: "All", q: "", verifiedOnly: false };
  const verified = all.filter((c) => c.authorities.length).length;
  $("#world").innerHTML = `
    <section class="world">
      <div class="world-head">
        <div>
          <span class="eyebrow">Worldwide</span>
          <h2>Every country, <em>one official source at least.</em></h2>
          <p>All ${all.length} WHO member states. ${verified} also link to a national food safety, health or consumer authority that we checked automatically. The rest link to their WHO country office.</p>
        </div>
        <div class="world-tools">
          <label class="search world-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <span class="sr-only">Filter countries</span>
            <input id="world-q" type="search" placeholder="Filter countries…" autocomplete="off">
          </label>
          <div class="seg" id="world-cont" role="radiogroup" aria-label="Continent">
            ${CONTS.map((c, i) => `<button role="radio" data-val="${c}" aria-checked="${i === 0}">${c}</button>`).join("")}
          </div>
          <label class="toggle"><input type="checkbox" id="world-verified"><span class="track"><span class="knob"></span></span>National authority only</label>
        </div>
      </div>
      <p class="world-count" id="world-count" aria-live="polite"></p>
      <div class="world-grid" id="world-grid"></div>
    </section>`;

  function renderWorld() {
    const t = norm(ws.q);
    const rows = all.filter((c) =>
      (ws.cont === "All" || c.continent === ws.cont) &&
      (!ws.verifiedOnly || c.authorities.length) &&
      (!t || norm(c.name).includes(t) || ((window.FSW_ALIASES || {})[c.iso3] || []).some((a) => norm(a).includes(t))));
    $("#world-count").textContent = `${rows.length} ${rows.length === 1 ? "country" : "countries"}`;
    $("#world-grid").innerHTML = rows.length ? rows.map((c) => `
      <button class="wcard${current === c.iso3 ? " on" : ""}" data-iso="${c.iso3}">
        <span class="wcard-iso">${c.iso3}</span>
        <span class="wcard-name">${esc(c.name)}</span>
        <span class="wcard-src">${c.authorities.length ? esc(c.authorities[0].name) : "WHO country office"}</span>
        <span class="wcard-n" title="${c.authorities.length + 1} official links">${c.authorities.length + 1}</span>
      </button>`).join("") : '<p class="world-empty">No countries match.</p>';
  }
  $("#world-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-iso]"); if (b) openCountry(b.dataset.iso); });
  $("#world-q").addEventListener("input", (e) => { ws.q = e.target.value; renderWorld(); });
  $("#world-verified").addEventListener("change", (e) => { ws.verifiedOnly = e.target.checked; renderWorld(); });
  $("#world-cont").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#world-cont").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    ws.cont = b.dataset.val; renderWorld();
  });
  renderWorld();
})();
