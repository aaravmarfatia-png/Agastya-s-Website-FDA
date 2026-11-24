(function () {
  "use strict";

  document.documentElement.classList.add("js");

  const DATA = window.FEED_DATA || { items: [], sources: [], directory: [], generated: null };
  const PAGE = 40;
  const REGION_ORDER = ["India", "United States", "United Kingdom", "Canada", "European Union", "Asia-Pacific", "Global (UN)"];

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const DAY = 86400000;
  const arrow = '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>';

  const state = { q: "", cat: "all", region: "all", agency: "all", period: "30", shown: PAGE, win: null };

  // ---------------- Scroll reveal (IntersectionObserver, no scroll listeners) ----------------
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 })
    : null;
  function observe(root) {
    (root || document).querySelectorAll(".reveal:not(.in)").forEach((el, n) => {
      if (!io) { el.classList.add("in"); return; }
      el.style.transitionDelay = Math.min(n, 6) * 60 + "ms";
      io.observe(el);
    });
  }

  // ---------------- Views & mobile menu ----------------
  const menu = $("#menu"), burger = $("#burger");
  function setMenu(open) {
    menu.classList.toggle("open", open);
    menu.setAttribute("aria-hidden", String(!open));
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.style.overflow = open ? "hidden" : "";
  }
  burger.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  function showView(name) {
    if (!["feed", "sources", "about"].includes(name)) name = "feed";
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-current", t.dataset.view === name ? "page" : "false"));
    if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
    observe($("#view-" + name));
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-view]");
    if (!el) return;
    e.preventDefault();
    setMenu(false);
    showView(el.dataset.view);
    window.scrollTo({ top: 0 });
  });
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

  // ---------------- Header info ----------------
  function renderUpdated() {
    const el = $("#updated");
    if (!DATA.generated) {
      el.innerHTML = "<b>No data yet.</b> Run <code>python3 fetch_feeds.py</code> to collect the latest updates.";
      return;
    }
    const g = new Date(DATA.generated);
    const ageH = (Date.now() - g) / 3600000;
    const ok = DATA.sources.filter((s) => s.ok).length;
    el.innerHTML = `Updated <b>${esc(g.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</b><br>${ok} of ${DATA.sources.length} official feeds responding` +
      (ageH > 48 ? "<br><b>This data may be out of date. Run the updater to refresh it.</b>" : "");
    el.classList.toggle("stale", ageH > 48);
  }

  function renderStats() {
    const now = Date.now();
    const recent = (i, days) => i.date && now - new Date(i.date) <= days * DAY;
    const items = DATA.items;
    const agencies = new Set(items.map((i) => i.agency));
    const stats = [
      ["Recalls in the last 7 days", items.filter((i) => i.category === "Recall" && recent(i, 7)).length, "recall"],
      ["Alerts · 7 days", items.filter((i) => i.category === "Alert" && recent(i, 7)).length, "alert"],
      ["Updates · 30 days", items.filter((i) => recent(i, 30)).length, ""],
      [`Official agencies in the feed · ${DATA.directory.length} in the directory`, agencies.size, ""],
    ];
    $("#stats").innerHTML = stats.map(([k, v, c]) =>
      `<div class="stat ${c} bezel reveal tilt"><div class="core"><dt>${esc(k)}</dt><dd data-count="${v}">${v.toLocaleString()}</dd></div></div>`).join("");
  }

  // ---------------- Filters ----------------
  function fillSelect(sel, values) {
    sel.insertAdjacentHTML("beforeend", values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(""));
  }
  const regions = [...new Set(DATA.items.map((i) => i.region))].sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
  fillSelect($("#region"), regions);
  fillSelect($("#agency"), [...new Set(DATA.items.map((i) => i.agency))].sort());

  $("#cat").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("#cat").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
    state.cat = b.dataset.val;
    reset();
  });
  ["region", "agency", "period"].forEach((id) => $("#" + id).addEventListener("change", (e) => { state[id] = e.target.value; reset(); }));
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); reset(); }, 120); });
  $("#more").addEventListener("click", () => { state.shown += PAGE; renderFeed(); });
  function reset() { state.shown = PAGE; renderFeed(); }

  function filtered() {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const useWin = state.period === "window" && state.win;
    const cutoff = state.period === "all" || useWin ? 0 : Date.now() - Number(state.period) * DAY;
    return DATA.items.filter((i) => {
      if (state.cat !== "all" && i.category !== state.cat) return false;
      if (state.region !== "all" && i.region !== state.region) return false;
      if (state.agency !== "all" && i.agency !== state.agency) return false;
      if (cutoff && (!i.date || new Date(i.date) < cutoff)) return false;
      if (useWin) {
        const t = i.date ? new Date(i.date).getTime() : NaN;
        if (!(t >= state.win.start && t < state.win.end)) return false;
      }
      if (terms.length) {
        const hay = (i.title + " " + i.summary + " " + i.agency).toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  function highlight(text) {
    const safe = esc(text);
    const terms = state.q.split(/\s+/).filter((w) => w.length > 1).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!terms.length) return safe;
    return safe.replace(new RegExp("(" + terms.join("|") + ")", "gi"), "<mark>$1</mark>");
  }

  function dayLabel(d) {
    if (!d) return "Undated";
    const date = new Date(d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(date); that.setHours(0, 0, 0, 0);
    const diff = Math.round((today - that) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: diff < 7 ? "long" : undefined, day: "numeric", month: "long", year: "numeric" });
  }

  const extIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function card(i) {
    const extra = i.extra || {};
    const tags = [
      `<span class="badge ${esc(i.category)}">${esc(i.category)}</span>`,
      `<span class="badge agency">${esc(i.agency)}</span>`,
      extra.classification ? `<span class="badge plain">${esc(extra.classification)}</span>` : "",
      extra.type ? `<span class="badge plain">${esc(extra.type)}</span>` : "",
      `<span>${esc(i.region)}</span>`,
    ].join("");
    return `<article class="bezel reveal tilt"><div class="core card ${esc(i.category)}">
      <div class="meta">${tags}</div>
      <h3><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${highlight(i.title)}</a></h3>
      ${i.summary ? `<p>${highlight(i.summary)}</p>` : ""}
      <div class="domain">${extIcon}Official notice on ${esc(host(i.link))}</div>
    </div></article>`;
  }

  function renderFeed() {
    const list = filtered();
    const page = list.slice(0, state.shown);
    const box = $("#feed-list");
    $("#count").textContent = list.length
      ? `Showing ${page.length.toLocaleString()} of ${list.length.toLocaleString()} updates`
      : "";
    if (!list.length) {
      box.innerHTML = `<div class="bezel"><div class="core empty"><strong>Nothing matches yet.</strong>Try a longer period, another region, or clear the search.</div></div>`;
      $("#more").hidden = true;
      return;
    }
    let html = "", last = null;
    for (const i of page) {
      const lbl = dayLabel(i.date);
      if (lbl !== last) { html += `<h2 class="day">${esc(lbl)}</h2>`; last = lbl; }
      html += card(i);
    }
    box.innerHTML = html;
    $("#more").hidden = list.length <= state.shown;
    observe(box);
  }

  // ---------------- Directory ----------------
  function renderDirectory() {
    const live = new Set(DATA.sources.filter((s) => s.ok).map((s) => s.agency));
    const groups = {};
    for (const d of DATA.directory) (groups[d.region] ||= []).push(d);
    const order = Object.keys(groups).sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    $("#directory").innerHTML = order.map((r) => {
      const list = groups[r];
      return `<section class="region" id="region-${esc(r.toLowerCase().replace(/[^a-z]+/g, "-"))}">
        <div class="region-head reveal"><h2>${esc(r)}<small>${list.length} official source${list.length > 1 ? "s" : ""}</small></h2></div>
        <div class="grid">${list.map((d, n) => {
          const isLive = d.live && live.has(d.agency);
          const wide = list.length % 2 === 1 && n === list.length - 1;
          return `<div class="bezel reveal tilt${wide ? " wide" : ""}"><div class="core src">
            <div class="src-head">
              <h3><small>${esc(d.agency)}</small>${esc(d.name)}</h3>
              <span class="badge ${isLive ? "live" : "link"}">${isLive ? "Live feed" : "Direct link"}</span>
            </div>
            <p>${esc(d.about)}</p>
            <div class="src-links">
              <a class="visit" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(host(d.url))}<span class="cta-icon" aria-hidden="true">${arrow}</span></a>
              ${d.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join("")}
            </div>
          </div></div>`;
        }).join("")}</div>
      </section>`;
    }).join("");
  }

  function renderStatus() {
    if (!DATA.sources.length) { $("#status").innerHTML = "<p>No feeds have been collected yet.</p>"; return; }
    $("#status").innerHTML = `<ul class="status-list">${DATA.sources.map((s) => `<li>
        <span class="pulse${s.ok ? "" : " err"}" title="${s.ok ? "Working" : esc("Unavailable: " + s.error)}"></span>
        <span class="name">${esc(s.name)}</span>
        <span class="num">${s.ok ? s.count + " items" : "Unavailable"}</span></li>`).join("")}</ul>`;
  }

  // Public hooks for explore.js (globe + timeline)
  window.FSW = {
    DATA, state, DAY, REGION_ORDER, esc, showView,
    setRegion(r) {
      const sel = $("#region");
      if (![...sel.options].some((o) => o.value === r)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(r)}">${esc(r)}</option>`);
      sel.value = r; state.region = r; reset();
    },
    setWindow(start, end, label) {
      const sel = $("#period");
      let opt = sel.querySelector('option[value="window"]');
      if (!opt) { opt = document.createElement("option"); opt.value = "window"; sel.appendChild(opt); }
      opt.textContent = label;
      sel.value = "window"; state.period = "window"; state.win = { start, end }; reset();
    },
  };

  renderUpdated();
  renderStats();
  renderFeed();
  renderDirectory();
  renderStatus();
  showView(location.hash.slice(1) || "feed");
  observe();
})();
