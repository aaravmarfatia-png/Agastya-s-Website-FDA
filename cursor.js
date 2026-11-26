/* =========================================================================
   Food Safety Watch — pointer-reactive layer
   • cursor follower (dot + lagging ring that morphs and labels targets)
   • background spotlight that tracks the pointer
   • magnetic buttons / chips
   • mouse parallax on hero + globe layers
   Runs only for a fine pointer (mouse/trackpad) and when motion is allowed.
   Uses one requestAnimationFrame loop that sleeps when everything has settled.
   ========================================================================= */
(function () {
  "use strict";
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!fine || reduced) return;

  document.documentElement.classList.add("has-cursor");

  // ---------- build layers ----------
  const spot = document.createElement("div");
  spot.className = "spotlight"; spot.setAttribute("aria-hidden", "true");
  const ring = document.createElement("div");
  ring.className = "cursor-ring"; ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = '<span class="cursor-label"></span>';
  const dot = document.createElement("div");
  dot.className = "cursor-dot"; dot.setAttribute("aria-hidden", "true");
  document.body.append(spot, ring, dot);
  const label = ring.firstChild;

  // ---------- state ----------
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  const ringPos = { x: mouse.x, y: mouse.y };
  const spotPos = { x: mouse.x, y: mouse.y };
  let ringScale = 1, ringTarget = 1, visible = false, raf = 0;
  const lerp = (a, b, t) => a + (b - a) * t;

  // what the cursor is over → ring size + label
  const TARGETS = [
    ["#globe", 2.2, "Drag"],
    [".chart .hit", 1.6, "Jump"],
    [".feed .tilt", 2.0, "Open"],
    [".wcard", 1.9, "View"],
    [".srow", 1.8, "Visit"],
    ["#dice", 1.8, "Roll"],
    [".src .visit", 1.8, "Visit"],
    ["input, select, textarea", 0, ""],
    ["a, button, summary, [role=radio]", 1.7, ""],
  ];
  function classify(el) {
    for (const [sel, scale, text] of TARGETS) if (el && el.closest(sel)) return [scale, text];
    return [1, ""];
  }

  // ---------- magnetic elements ----------
  const MAG_SEL = ".cta, .play, .tab, .rchip, .burger, .src-links a.visit, .seg button, .dice, .drawer-close";
  const mags = new Map(); // el -> {x, y, tx, ty}

  // ---------- parallax layers (depth in px at the viewport edge) ----------
  const PARALLAX = [
    [".hero-copy .eyebrow", 6],
    [".hero-copy h1", 12],
    [".hero-copy .lede", 5],
    ["#stats", -14],
    [".globe-stage", 16],
    [".atlas h2", 6],
    [".page-hero h1", 10],
  ];
  const layers = [];
  function collectLayers() {
    layers.length = 0;
    for (const [sel, depth] of PARALLAX) document.querySelectorAll(sel).forEach((el) => layers.push({ el, depth, x: 0, y: 0 }));
  }
  collectLayers();
  window.addEventListener("hashchange", collectLayers);

  // ---------- events ----------
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!visible) {
      visible = true; ring.classList.add("on"); dot.classList.add("on"); spot.classList.add("on");
      ringPos.x = spotPos.x = mouse.x; ringPos.y = spotPos.y = mouse.y;
    }
    const [scale, text] = classify(e.target);
    ringTarget = scale;
    ring.classList.toggle("hidden", scale === 0);
    dot.classList.toggle("hidden", scale === 0);
    ring.classList.toggle("labelled", !!text);
    if (text && label.textContent !== text) label.textContent = text;
    // register magnetic elements near the pointer
    document.querySelectorAll(MAG_SEL).forEach((el) => { if (!mags.has(el)) mags.set(el, { x: 0, y: 0, tx: 0, ty: 0 }); });
    wake();
  }, { passive: true });

  document.addEventListener("pointerdown", () => ring.classList.add("press"));
  document.addEventListener("pointerup", () => ring.classList.remove("press"));
  document.documentElement.addEventListener("pointerleave", () => {
    visible = false; ring.classList.remove("on"); dot.classList.remove("on"); spot.classList.remove("on");
    for (const m of mags.values()) { m.tx = 0; m.ty = 0; }
    wake();
  });

  function wake() { if (!raf && !document.documentElement.classList.contains("fourd-open")) raf = requestAnimationFrame(tick); }

  // ---------- the loop ----------
  function tick() {
    raf = 0;
    let busy = false;

    // dot sticks to the pointer, ring trails, spotlight drifts slower
    dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
    ringPos.x = lerp(ringPos.x, mouse.x, 0.18); ringPos.y = lerp(ringPos.y, mouse.y, 0.18);
    spotPos.x = lerp(spotPos.x, mouse.x, 0.08); spotPos.y = lerp(spotPos.y, mouse.y, 0.08);
    ringScale = lerp(ringScale, ringTarget || 1, 0.2);
    ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) scale(${ringScale.toFixed(3)})`;
    label.style.transform = `scale(${(1 / ringScale).toFixed(3)})`;
    spot.style.transform = `translate3d(${spotPos.x}px, ${spotPos.y}px, 0)`;
    if (Math.abs(ringPos.x - mouse.x) + Math.abs(ringPos.y - mouse.y) > 0.3 ||
        Math.abs(spotPos.x - mouse.x) + Math.abs(spotPos.y - mouse.y) > 0.3 ||
        Math.abs(ringScale - (ringTarget || 1)) > 0.002) busy = true;

    // magnetic pull: within 48px of an element, drift up to 35% of the offset (max 12px)
    for (const [el, m] of mags) {
      if (!el.isConnected) { mags.delete(el); continue; }
      if (visible && el.offsetParent !== null) {
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const dx = mouse.x - cx, dy = mouse.y - cy;
        const reach = 48;
        const inside = Math.abs(dx) < b.width / 2 + reach && Math.abs(dy) < b.height / 2 + reach;
        const cap = Math.min(12, b.width * 0.18);
        m.tx = inside ? Math.max(-cap, Math.min(cap, dx * 0.35)) : 0;
        m.ty = inside ? Math.max(-cap, Math.min(cap, dy * 0.35)) : 0;
      }
      m.x = lerp(m.x, m.tx, 0.2); m.y = lerp(m.y, m.ty, 0.2);
      el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
      if (Math.abs(m.x - m.tx) + Math.abs(m.y - m.ty) > 0.05) busy = true;
      else if (!m.tx && !m.ty) { el.style.translate = ""; mags.delete(el); }
    }

    // parallax: offset from viewport centre, each layer at its own depth
    const nx = visible ? (mouse.x / innerWidth - 0.5) * 2 : 0;
    const ny = visible ? (mouse.y / innerHeight - 0.5) * 2 : 0;
    for (const l of layers) {
      if (l.el.offsetParent === null) continue;
      const tx = -nx * l.depth, ty = -ny * l.depth * 0.6;
      l.x = lerp(l.x, tx, 0.07); l.y = lerp(l.y, ty, 0.07);
      l.el.style.translate = `${l.x.toFixed(2)}px ${l.y.toFixed(2)}px`;
      if (Math.abs(l.x - tx) + Math.abs(l.y - ty) > 0.05) busy = true;
    }

    if (busy) wake();
  }
})();
