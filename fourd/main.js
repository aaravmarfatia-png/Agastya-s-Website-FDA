// 4D mode orchestrator. mount() builds everything; the returned dispose() tears it all down
// (WebGL resources, webcam stream, AudioContext, listeners, tweens).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { gsap } from "gsap";

import { loadWorld, Globe } from "./globe.js";
import { Tesseract, Fabric, makeStars } from "./lattice.js";
import { loadCrises, refreshLive, buildTrends, Beacons, Arcs, GROUPS } from "./crises.js";
import { HeadTracker, MotionInput } from "./sensors.js";
import { SpatialAudio } from "./audio.js";
import { createHud, renderCountry } from "./hud.js";
import { latLonToVec3, subsolarPoint, haptics, clamp, lerp, esc, DAY_MS } from "./util.js";
import { detectTier, BUDGET } from "./gpu.js";
import { Tour } from "./tour.js";

// Spacetime lens + chromatic aberration + vignette (runs after bloom)
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uRadius: { value: 0.3 },
    uAspect: { value: 1 }, uMass: { value: 0.022 }, uCursor: { value: new THREE.Vector3(0.5, 0.5, 0) },
    uShock: { value: new THREE.Vector4(0.5, 0.5, -99, 0) }, uTime: { value: 0 }, uAb: { value: 0.0016 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uRadius, uAspect, uMass, uTime, uAb;
    uniform vec3 uCursor; uniform vec4 uShock; varying vec2 vUv;
    vec2 asp(vec2 v){ return vec2(v.x * uAspect, v.y); }
    vec2 unasp(vec2 v){ return vec2(v.x / uAspect, v.y); }
    void main(){
      vec2 uv = vUv;
      // gravitational lensing of the background around the globe (deflection ~ M / r), globe itself untouched
      vec2 d = asp(uv - uCenter); float r = length(d) + 1e-5;
      float outside = smoothstep(uRadius * 1.02, uRadius * 1.18, r);
      uv -= unasp(d / r) * (uMass * uRadius / r) * outside;
      // cursor micro-lens
      vec2 dc = asp(uv - uCursor.xy); float rc = length(dc) + 1e-5;
      uv -= unasp(dc / rc) * uCursor.z * 0.012 * exp(-rc * rc * 90.0);
      // shockwave ring in screen space
      float age = uTime - uShock.z;
      if (age > 0.0 && age < 2.2) {
        vec2 ds = asp(uv - uShock.xy); float rs = length(ds) + 1e-5;
        float front = age * 0.55, x = rs - front;
        uv += unasp(ds / rs) * sin(x * 70.0) * 0.006 * exp(-x * x * 260.0) * (1.0 - age / 2.2);
      }
      // chromatic aberration grows towards the edges
      vec2 dir = uv - 0.5; float k = dot(dir, dir);
      vec2 o = dir * uAb * (1.0 + k * 6.0);
      vec3 c = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
      c *= 1.0 - 0.42 * k * 1.6;  // vignette
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const YEAR = 365.25 * DAY_MS;

export async function mount({ onExit, audioCtx }) {
  const ac = new AbortController();
  const { signal } = ac;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(pointer: coarse)").matches;
  const countryMeta = Object.fromEntries(((window.COUNTRIES && window.COUNTRIES.countries) || []).map((c) => [c.iso3, c]));

  // ---------------------------------------------------------------- shell
  const root = document.createElement("div");
  root.className = "fourd";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "4D globe");
  root.innerHTML = `<div class="fd-loading">
      <div class="fd-pre-cube" aria-hidden="true"><i></i><i></i></div>
      <div class="fd-pre-bar" role="progressbar" aria-label="Loading the 4D globe" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
      <p class="fd-pre-stage">Starting the renderer…</p>
      <p class="fd-pre-pct">0%</p>
      <p class="fd-pre-tip">Tip: hold <kbd>Shift</kbd> and scroll to move along the W-axis, or press <kbd>T</kbd> for a guided tour.</p>
    </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add("fourd-open");
  const loading = root.querySelector(".fd-loading");
  // staged progress: each stage owns a slice of the bar
  const progress = (stage, from, to, f = 0) => {
    const pct = Math.round(from + (to - from) * Math.min(1, f));
    loading.querySelector(".fd-pre-stage").textContent = stage;
    loading.querySelector(".fd-pre-pct").textContent = pct + "%";
    loading.querySelector(".fd-pre-bar span").style.transform = `scaleX(${pct / 100})`;
    loading.querySelector(".fd-pre-bar").setAttribute("aria-valuenow", String(pct));
  };

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    loading.innerHTML = `<p>4D mode needs WebGL 2, which this browser or device doesn't provide.</p><button class="fd-btn" data-act="exit">Back to the site</button>`;
    loading.querySelector("button").addEventListener("click", () => onExit());
    return { dispose() { root.remove(); document.documentElement.classList.remove("fourd-open"); ac.abort(); } };
  }
  const { tier, gpu } = detectTier(renderer);
  const B = BUDGET[tier];
  const maxPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2, B.maxPR);
  let pr = Math.min(maxPR, tier === "low" ? 0.85 : 1.5);
  renderer.info.autoReset = false; // count every pass of a frame (draw-call budget)
  progress("Starting the renderer…", 0, 6, 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x02060a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = "fd-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(0, 0.5, 3.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.06, enablePan: false, minDistance: 1.22, maxDistance: 7.5, rotateSpeed: 0.55, zoomSpeed: 0.7,
    autoRotate: !reduced, autoRotateSpeed: 0.25,
    minPolarAngle: 0.18, maxPolarAngle: Math.PI - 0.18,  // never flip over the poles
  });
  // Responsive framing: wider FOV in portrait, and a distance that always fits the globe + atmosphere
  let fitDist = 3.6;
  function frameCamera() {
    const portrait = innerHeight > innerWidth * 1.05;
    camera.fov = portrait ? 52 : innerWidth / innerHeight > 2.1 ? 34 : 40;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    fitDist = 1.3 / Math.sin(Math.min(vf, hf) / 2);
    controls.maxDistance = Math.max(6, fitDist * 1.9);
  }
  frameCamera();

  // ---------------------------------------------------------------- content
  progress("Downloading country borders…", 6, 55);
  const world = await loadWorld("data/world-50m.json", {
    hiRes: B.hiRes && !mobile && renderer.capabilities.maxTextureSize >= 4096,
    onProgress: (f) => progress("Downloading country borders…", 6, 55, f),
  });
  progress("Drawing 241 borders into textures…", 55, 72, 1);
  await new Promise((r) => setTimeout(r, 0));
  const globe = new Globe(world, { anisotropy: renderer.capabilities.getMaxAnisotropy(), globeSeg: B.globeSeg, cloudSeg: B.cloudSeg });
  const earth = new THREE.Group();
  earth.add(globe.group);
  scene.add(earth);

  const tesseract = new Tesseract();
  scene.add(tesseract.group);
  const fabric = new Fabric(B.fabricSeg);
  scene.add(fabric.mesh);
  const stars = makeStars(mobile ? Math.min(2500, B.stars) : B.stars);
  scene.add(stars);

  const beacons = new Beacons();
  const arcs = new Arcs();
  earth.add(beacons.group, arcs.group);

  // Data is streamed in after the globe is on screen (staged loading)
  const store = { events: [], yearly: {}, generated: null, liveStatus: "loading" };
  let trends = new Map();
  function applyLayers() {
    // static per-country layers for the W-axis: recall & alert density (R) and outbreak density (G)
    const fam = new Map();
    for (const e of store.events) {
      for (const iso of e.iso3 || []) {
        const f = fam.get(iso) || { recall: 0, outbreak: 0 };
        if (e.group === "outbreak") f.outbreak++; else f.recall++;
        fam.set(iso, f);
      }
    }
    const maxR = Math.max(1, ...[...fam.values()].map((f) => f.recall)), maxO = Math.max(1, ...[...fam.values()].map((f) => f.outbreak));
    for (const c of world.countries) {
      const f = fam.get(c.iso3) || { recall: 0, outbreak: 0 };
      globe.setCountryData(c.index, {
        climate: Math.round(Math.sqrt(f.recall / maxR) * 255), geo: Math.round(Math.sqrt(f.outbreak / maxO) * 255),
        active: 0, sources: countryMeta[c.iso3]?.authorities?.length ? 255 : 0,
      });
    }
    globe.commitData();
  }

  // ---------------------------------------------------------------- post-processing
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 2.6, aperture: 0.0022, maxblur: 0.005 });
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.78);
  composer.addPass(bloom);
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  // compile shaders before the first frame so the entry animation doesn't stutter
  progress("Compiling shaders…", 72, 96, 0.2);
  try { await renderer.compileAsync(scene, camera); } catch { /* falls back to compile-on-first-draw */ }
  progress("Ready", 96, 100, 1);
  loading.classList.add("done");
  setTimeout(() => loading.remove(), reduced ? 0 : 650);

  // ---------------------------------------------------------------- HUD
  const ui = createHud(root, { motionSupported: MotionInput.supported(), touch: mobile });
  arcs.setResolution(innerWidth * pr, innerHeight * pr);

  // ---------------------------------------------------------------- time (4th dimension)
  const t0Real = Date.now();
  const PAST = 10 * YEAR, FUTURE = 3 * YEAR;
  const time = { sim: t0Real, live: true, speed: 0 };   // speed in days per second
  const nowReal = () => Date.now();
  const toSlider = (ms) => Math.round(((ms - (nowReal() - PAST)) / (PAST + FUTURE)) * 1000);
  const fromSlider = (v) => nowReal() - PAST + (v / 1000) * (PAST + FUTURE);
  ui.nowTick.style.left = `${(PAST / (PAST + FUTURE)) * 100}%`;

  // ---------------------------------------------------------------- state
  const st = { hover: -1, select: -1, selectIso: null, W: 0, hudOn: true, quality: "auto", holo: false, motion: false, audio: false };
  const head = new HeadTracker();
  let motion = null;
  const audio = new SpatialAudio();
  const eye = { x: 0, y: 0, z: 1 };
  const timer = new THREE.Timer();
  let elapsed = 0, lastActiveKey = "", raf = 0, frameEMA = 16, qualityTimer = 0, scrubbing = false;
  const vel = { x: 0, y: 0, last: null, boost: 0 };   // pointer velocity (px/ms), drives cursor-reactive physics
  let tour = null, debugOn = new URLSearchParams(location.search).has("debug"), lastPointerTime = 0;
  const tweens = [];

  // ---------------------------------------------------------------- helpers
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
  function countryDir(idx) {
    const c = world.countries[idx];
    const m = c.iso3 && countryMeta[c.iso3];
    const ll = m ? { lat: m.lat, lon: m.lon } : c.centroid;
    return latLonToVec3(ll.lat, ll.lon, 1);
  }
  function toCameraSpace(localDir) {
    return v3b.copy(localDir).applyMatrix4(earth.matrixWorld).sub(camera.position).normalize().transformDirection(camera.matrixWorldInverse);
  }
  function activeAt(ms) {
    return store.events.filter((e) => e.date <= ms && ms <= e.end);
  }

  function rebuildBeacons(force) {
    const future = time.sim > nowReal() + DAY_MS;
    const ms = future ? nowReal() : time.sim;
    const key = Math.floor(ms / (DAY_MS / 4)) + (future ? "f" + Math.floor(time.sim / (30 * DAY_MS)) : "");
    if (!force && key === lastActiveKey) return;
    lastActiveKey = key;
    let items = activeAt(ms).map((e) => ({ lat: e.lat, lon: e.lon, weight: e.weight, group: e.group, iso3: e.iso3 }));
    if (future) {
      const yrs = (time.sim - nowReal()) / YEAR;
      for (const [iso, tr] of trends) {
        const m = countryMeta[iso]; if (!m) continue;
        const v = Math.max(0, tr.mean + tr.slope * (4.5 + yrs));
        if (v < 0.4) continue;
        items.push({ lat: m.lat, lon: m.lon, weight: Math.min(1, v / 6), group: "recall", iso3: [iso], ghost: true });
      }
    }
    beacons.set(items);
    // per-country active severity (shader tint)
    const sev = new Map();
    for (const e of activeAt(ms)) for (const iso of e.iso3 || []) sev.set(iso, Math.min(1, (sev.get(iso) || 0) + e.weight * 0.6));
    for (const c of world.countries) globe.setCountryData(c.index, { active: Math.round((sev.get(c.iso3) || 0) * 255) });
    globe.commitData();
    const n = items.filter((i) => !i.ghost).length;
    ui.count.textContent = future ? `${items.filter((i) => i.ghost).length} countries with a rising/steady trend` : `${n} active food-safety issue${n === 1 ? "" : "s"}`;
    if (st.select >= 0) openPanel(st.select, false);
  }

  function updateReadout() {
    const future = time.sim > nowReal() + DAY_MS, past = time.sim < nowReal() - DAY_MS;
    ui.date.textContent = new Date(time.sim).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
    ui.mode.textContent = time.live ? "LIVE" : future ? "TREND" : past ? "PAST" : "NOW";
    ui.mode.dataset.mode = ui.mode.textContent.toLowerCase();
    if (!scrubbing) ui.scrub.value = String(toSlider(time.sim));
    ui.play.setAttribute("aria-pressed", String(time.speed !== 0));
  }

  function openPanel(idx, fly = true) {
    const c = world.countries[idx];
    const iso = c.iso3, meta = iso && countryMeta[iso];
    const now = nowReal(), future = time.sim > now + DAY_MS, ms = future ? now : time.sim;
    const mine = store.events.filter((e) => e.iso3 && e.iso3.includes(iso)).sort((a, b) => b.date - a.date);
    const active = mine.filter((e) => e.date <= ms && ms <= e.end);
    const history = mine.filter((e) => !active.includes(e) && e.date <= ms);
    renderCountry(ui.panel, { name: meta?.name || c.name, iso3: iso, meta, active, history, trend: trends.get(iso), simMs: time.sim, nowMs: now, liveStatus: store.liveStatus });
    if (fly) {
      // arcs to other countries sharing the same events (multi-country disasters & outbreaks)
      const home = countryMeta[iso] ? { lat: countryMeta[iso].lat, lon: countryMeta[iso].lon } : c.centroid;
      const seen = new Set(), pairs = [];
      for (const e of mine.slice(0, 40)) for (const other of e.iso3) {
        if (other === iso || seen.has(other) || !countryMeta[other]) continue;
        seen.add(other); pairs.push({ from: home, to: { lat: countryMeta[other].lat, lon: countryMeta[other].lon }, group: e.group });
      }
      arcs.set(pairs);
    }
  }

  function select(idx) {
    st.select = idx;
    globe.uniforms.uSelect.value = idx;
    controls.autoRotate = false;
    const dirLocal = countryDir(idx);
    // fly into low orbit
    const target = dirLocal.clone().applyMatrix4(earth.matrixWorld).normalize();
    const from = camera.position.clone();
    const r0 = from.length(), r1 = Math.max(1.9, fitDist * 0.55);
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), target);
    const proxy = { t: 0 };
    tweens.push(gsap.to(proxy, {
      t: 1, duration: reduced ? 0.01 : 1.6, ease: "power3.inOut",
      onUpdate: () => {
        const q = q0.clone().slerp(q1, proxy.t);
        camera.position.copy(from).normalize().applyQuaternion(q).multiplyScalar(lerp(r0, r1, proxy.t) + Math.sin(proxy.t * Math.PI) * 0.35);
        camera.lookAt(0, 0, 0);
      },
    }));
    // gravitational shockwave (skipped for reduced motion: no flashing ripples)
    if (!reduced) {
      globe.shock(dirLocal, elapsed);
      const w = dirLocal.clone().applyMatrix4(earth.matrixWorld);
      fabric.shock(w.x * 2.2, w.z * 2.2, elapsed);
      const sp = w.clone().project(camera);
      lens.uniforms.uShock.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, elapsed, 0);
    }
    haptics.heartbeat();
    setTimeout(() => haptics.rumble(), 260);
    audio.shock(toCameraSpace(dirLocal));
    openPanel(idx, true);
    const c = world.countries[idx];
    ui.sr.textContent = `Selected ${countryMeta[c.iso3]?.name || c.name}. Details are in the country panel.`;
  }

  function deselect() {
    st.select = -1; globe.uniforms.uSelect.value = -1;
    ui.panel.hidden = true; arcs.clear();
    controls.autoRotate = !reduced;
  }

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const sheet = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.55);
  const unitSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
  const hitP = new THREE.Vector3();
  let pointer = null, downAt = null;
  function pick() {
    if (!pointer) return;
    ndc.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // analytic ray-sphere hit (much cheaper than ray-casting 147k triangles every frame)
    let idx = -1;
    if (ray.ray.intersectSphere(unitSphere, hitP)) {
      const l = earth.worldToLocal(hitP).normalize();
      const lat = Math.asin(clamp(l.y, -1, 1)) * 180 / Math.PI;
      let phi = Math.atan2(l.z, -l.x); if (phi < 0) phi += Math.PI * 2;
      const lon = (phi / (Math.PI * 2)) * 360 - 180;
      idx = globe.idAtUv({ x: (lon + 180) / 360, y: (lat + 90) / 180 });
    }
    if (idx !== st.hover) {
      st.hover = idx;
      globe.uniforms.uHover.value = idx;
      if (idx >= 0) {
        haptics.tick();
        audio.ping(toCameraSpace(countryDir(idx)), 700 + (idx % 12) * 45, 0.08);
      }
    }
    if (idx >= 0) {
      const c = world.countries[idx], meta = c.iso3 && countryMeta[c.iso3];
      const n = activeAt(time.sim > nowReal() ? nowReal() : time.sim).filter((e) => e.iso3?.includes(c.iso3)).length;
      ui.tip.innerHTML = `<b>${esc(meta?.name || c.name)}</b><span>${n} active food-safety issue${n === 1 ? "" : "s"} · ${meta?.authorities?.length ? meta.authorities.length + 1 : meta ? 1 : 0} food-safety source${meta?.authorities?.length ? "s" : ""}</span>`;
      ui.tip.style.transform = `translate(${pointer.x + 16}px, ${pointer.y + 16}px)`;
      ui.tip.hidden = false;
      renderer.domElement.style.cursor = "pointer";
    } else { ui.tip.hidden = true; renderer.domElement.style.cursor = ""; }
    // spacetime fabric cursor mass
    const p = ray.ray.intersectPlane(sheet, v3);
    if (p) { fabric.uniforms.uCursor.value.x = p.x; fabric.uniforms.uCursor.value.z = p.z; }   // strength (.y) follows pointer speed
    lens.uniforms.uCursor.value.set(pointer.x / innerWidth, 1 - pointer.y / innerHeight, 1);
  }
  const cv = renderer.domElement;
  cv.addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (vel.last) {
      const dtp = Math.max(8, now - vel.last.t);
      vel.x = lerp(vel.x, (e.clientX - vel.last.x) / dtp, 0.35);
      vel.y = lerp(vel.y, (e.clientY - vel.last.y) / dtp, 0.35);
    }
    vel.last = { x: e.clientX, y: e.clientY, t: now };
    pointer = { x: e.clientX, y: e.clientY };
    lastPointerTime = now;
  }, { signal });
  cv.addEventListener("pointerleave", () => { pointer = null; st.hover = -1; globe.uniforms.uHover.value = -1; ui.tip.hidden = true; fabric.uniforms.uCursor.value.y = 0; lens.uniforms.uCursor.value.z = 0; }, { signal });
  cv.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; dismissHints(); }, { signal });
  cv.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    pointer = { x: e.clientX, y: e.clientY }; pick();
    if (st.hover >= 0) select(st.hover);
  }, { signal });

  // ---------------------------------------------------------------- HUD events
  function setPressed(sel, on) { root.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(on))); }
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act],[data-t]");
    if (!b) return;
    const act = b.dataset.act, t = b.dataset.t;
    audio.click(b.getAttribute("aria-pressed") !== "true");
    if (act === "exit") return onExit();
    if (act === "hints-close") return dismissHints();
    if (t === "tour" || act === "tour-end") return toggleTour(t === "tour" ? !tour : false);
    if (act === "tour-next") return tour && tour.next();
    if (act === "tour-prev") return tour && tour.prev();
    if (act === "close") return deselect();
    if (act === "live") { time.live = true; time.speed = 0; time.sim = nowReal(); haptics.tick(); }
    if (act === "play") { time.live = false; time.speed = time.speed > 0 ? 0 : 30; }
    if (act === "ff") { time.live = false; time.speed = time.speed >= 30 ? Math.min(time.speed * 2, 480) : 120; }
    if (act === "rew") { time.live = false; time.speed = time.speed <= -30 ? Math.max(time.speed * 2, -480) : -120; }
    if (t === "hud") {
      st.hudOn = !st.hudOn;
      ui.hud.dataset.hud = st.hudOn ? "on" : "off";
      ui.restore.hidden = st.hudOn;
      if (st.hudOn) root.querySelector('.fd-toggles [data-t="hud"]').focus();
      else ui.restore.focus();
    }
    if (t === "haptics") { haptics.enabled = !haptics.enabled; setPressed('[data-t="haptics"]', haptics.enabled); haptics.tick(); }
    if (t === "audio") {
      if (!st.audio) { b.textContent = "Starting audio…"; await audio.start(audioCtx); st.audio = true; b.textContent = "4D audio on"; audio.click(true); }
      else { await audio.stop(); st.audio = false; b.textContent = "Enable 4D audio"; }
      setPressed('[data-t="audio"]', st.audio);
    }
    if (t === "holo") {
      if (!st.holo) {
        b.textContent = "Starting camera…"; b.disabled = true;
        try { ui.cam.hidden = false; await head.start(ui.cam); st.holo = true; b.textContent = "Hologram on (webcam)"; }
        catch (err) { ui.cam.hidden = true; head.stop(); b.textContent = "Hologram unavailable"; flash(`Head tracking couldn't start: ${err.message || err}`); }
        b.disabled = false;
      } else { head.stop(); st.holo = false; ui.cam.hidden = true; b.textContent = "Hologram (webcam)"; }
      setPressed('[data-t="holo"]', st.holo);
    }
    if (t === "motion") {
      if (!st.motion) {
        try {
          motion = new MotionInput({ signal, onShake: () => { const d = camera.position.clone().normalize(); globe.shock(earth.worldToLocal(d.clone()).normalize(), elapsed); fabric.shock(0, 0, elapsed); haptics.rumble(); audio.shock(new THREE.Vector3(0, 0, -1)); } });
          await motion.start(); st.motion = true;
        } catch (err) { flash(`Motion sensors unavailable: ${err.message || err}`); }
      } else { st.motion = false; motion = null; }
      setPressed('[data-t="motion"]', st.motion);
    }
    updateReadout();
  }, { signal });
  root.querySelector('[data-t="quality"]').addEventListener("change", (e) => { st.quality = e.target.value; applyQuality(true); }, { signal });

  ui.scrub.addEventListener("input", () => {
    scrubbing = true; time.live = false; time.speed = 0;
    const prev = time.sim; time.sim = fromSlider(+ui.scrub.value);
    if (Math.abs(time.sim - nowReal()) < 3 * DAY_MS) { time.sim = nowReal(); time.live = true; }
    scrubVel = (time.sim - prev) / DAY_MS;
    haptics.scrub();
  }, { signal });
  ui.scrub.addEventListener("change", () => { scrubbing = false; }, { signal });
  let scrubVel = 0;

  ui.w.addEventListener("input", () => setW(+ui.w.value), { signal });
  function setW(w) {
    st.W = clamp(w, 0, 2);
    ui.w.value = String(st.W);
    const L = Math.round(st.W);
    ui.layers.forEach((li) => li.classList.toggle("on", +li.dataset.l === L));
    ui.w.setAttribute("aria-valuetext", ["Borders and food-safety sources", "Recall and alert density", "Foodborne outbreak density"][L]);
  }
  root.addEventListener("wheel", (e) => {
    if (tour && !e.target.closest(".fd-panel, .fd-find-list")) { e.preventDefault(); tour.nudge(clamp(e.deltaY, -120, 120) / 380); return; }   // scroll drives the tour timeline
    if (e.shiftKey && e.target === cv) { e.preventDefault(); setW(st.W + e.deltaY * 0.002); }
  }, { signal, passive: false });
  // swipe drives the tour on touch screens
  let touchY = null;
  root.addEventListener("touchstart", (e) => { if (tour) touchY = e.touches[0].clientY; }, { signal, passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!tour || touchY === null) return;
    const y = e.touches[0].clientY; tour.nudge((touchY - y) / 260); touchY = y;
  }, { signal, passive: true });

  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, select, textarea")) { if (e.key !== "Escape") return; }
    if (e.key === "Escape") { e.preventDefault(); if (tour) toggleTour(false); else if (st.select >= 0) deselect(); else onExit(); }
    else if (e.key === " ") { e.preventDefault(); time.live = false; time.speed = time.speed ? 0 : 30; }
    else if (e.key.toLowerCase() === "l") { time.live = true; time.speed = 0; time.sim = nowReal(); }
    else if (e.key.toLowerCase() === "h") root.querySelector('[data-t="hud"]').click();
    else if (e.key === "/" ) { e.preventDefault(); ui.find.focus(); }
    else if (e.key.toLowerCase() === "t") toggleTour(!tour);
    else if (tour && ["ArrowDown", "ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); tour.next(); }
    else if (tour && ["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); tour.prev(); }
    else if (e.code === "Backquote" || e.key === "`") { debugOn = !debugOn; ui.debug.hidden = !debugOn; }   // physical key, works on any layout
    else if (e.key === "[") setW(st.W - 0.1);
    else if (e.key === "]") setW(st.W + 0.1);
    updateReadout();
  }, { signal });

  function flash(msg) {
    ui.status.textContent = msg;
    ui.status.classList.add("flash");
    setTimeout(() => ui.status.classList.remove("flash"), 4000);
  }

  // ---------------------------------------------------------------- quality / resize
  let bokehOn = B.bokeh && !mobile;
  function applyQuality(force) {
    if (st.quality === "high") { pr = maxPR; bokehOn = true; bloom.strength = 0.9; }
    else if (st.quality === "low") { pr = Math.min(maxPR, 0.8); bokehOn = false; bloom.strength = 0.7; }
    else if (force) { pr = Math.min(maxPR, tier === "low" ? 0.85 : 1.5); bokehOn = B.bokeh && !mobile; bloom.strength = tier === "low" ? 0.7 : 0.85; }
    bokeh.enabled = bokehOn;
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    resize();
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    frameCamera();
    renderer.setSize(w, h); composer.setSize(w, h);
    bloom.setSize(w * pr, h * pr);
    arcs.setResolution(w * pr, h * pr);
    lens.uniforms.uAspect.value = w / h;
    stars.material.uniforms.uPR.value = pr;
  }
  window.addEventListener("resize", resize, { signal });
  applyQuality(true);

  // ---------------------------------------------------------------- off-axis (holographic) projection
  function applyEye() {
    // eye offset in units of half-screen; z = relative distance to the screen
    const D = camera.position.length();
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * D, halfW = halfH * camera.aspect;
    const ox = eye.x * halfW * 0.9, oy = eye.y * halfH * 0.9, Dz = D * eye.z;
    const right = v3.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = v3b.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(right, ox).addScaledVector(up, oy).addScaledVector(fwd, D - Dz);
    camera.updateMatrixWorld();
    const n = camera.near, k = n / Dz;
    camera.projectionMatrix.makePerspective((-halfW - ox) * k, (halfW - ox) * k, (halfH - oy) * k, (-halfH - oy) * k, n, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    return { right: right.clone(), up: up.clone(), fwd, ox, oy, d: D - Dz };
  }
  function restoreEye(s) {
    camera.position.addScaledVector(s.right, -s.ox).addScaledVector(s.up, -s.oy).addScaledVector(s.fwd, -s.d);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- staged data stream (after first frame)
  ui.status.textContent = "Loading food-safety data…";
  function streamData() {
    loadCrises(countryMeta, { signal }).then((snap) => {
      Object.assign(store, snap);
      trends = buildTrends(store, nowReal());
      applyLayers();
      rebuildBeacons(true);
      ui.status.textContent = `Saved food-safety snapshot ${new Date(store.generated).toLocaleDateString()} · checking for live updates…`;
      return refreshLive(store, countryMeta, { signal }).then((n) => {
        trends = buildTrends(store, nowReal());
        applyLayers();
        rebuildBeacons(true);
        ui.status.textContent = `${store.liveStatus === "live" ? `Live FDA & WHO data · ${n} new` : "Live update unavailable · using saved snapshot"} · snapshot ${new Date(store.generated).toLocaleDateString()}`;
      });
    }).catch((err) => { if (!signal.aborted) ui.status.textContent = "Couldn't load food-safety data: " + (err.message || err); });
  }

  // ---------------------------------------------------------------- finder (keyboard & screen-reader parity for 3D hotspots)
  const norm = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const findable = world.countries.map((c) => ({ idx: c.index, name: countryMeta[c.iso3]?.name || c.name, iso: c.iso3 || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let findResults = [], findActive = -1;
  function renderFind() {
    ui.findList.innerHTML = findResults.map((r, i) => `<li role="option" id="fd-opt-${r.idx}" data-idx="${r.idx}" aria-selected="${i === findActive}">${esc(r.name)}<small>${esc(r.iso)}</small></li>`).join("")
      || (ui.find.value.trim() ? '<li class="none">No match</li>' : "");
    ui.findList.hidden = !ui.find.value.trim();
    ui.find.setAttribute("aria-expanded", String(!ui.findList.hidden));
    ui.find.setAttribute("aria-activedescendant", findActive >= 0 ? `fd-opt-${findResults[findActive].idx}` : "");
  }
  ui.find.addEventListener("input", () => {
    const q = norm(ui.find.value.trim());
    findResults = q ? findable.filter((r) => norm(r.name).startsWith(q) || r.iso.toLowerCase() === q).concat(findable.filter((r) => !norm(r.name).startsWith(q) && norm(r.name).includes(q))).slice(0, 7) : [];
    findActive = findResults.length ? 0 : -1; renderFind();
  }, { signal });
  ui.find.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && findResults.length) {
      e.preventDefault(); e.stopPropagation();
      findActive = (findActive + (e.key === "ArrowDown" ? 1 : -1) + findResults.length) % findResults.length; renderFind();
    } else if (e.key === "Enter" && findActive >= 0) { e.preventDefault(); chooseFind(findResults[findActive].idx); }
  }, { signal });
  ui.findList.addEventListener("pointerdown", (e) => { const li = e.target.closest("[data-idx]"); if (li) { e.preventDefault(); chooseFind(+li.dataset.idx); } }, { signal });
  ui.find.addEventListener("blur", () => setTimeout(() => { ui.findList.hidden = true; ui.find.setAttribute("aria-expanded", "false"); }, 150), { signal });
  function chooseFind(idx) { ui.find.value = ""; findResults = []; findActive = -1; renderFind(); if (tour) toggleTour(false); select(idx); }

  // ---------------------------------------------------------------- first-visit hints (contextual cues)
  let hintTimer = 0;
  function dismissHints() {
    if (ui.hints.hidden) return;
    ui.hints.classList.add("bye");
    setTimeout(() => { ui.hints.hidden = true; }, reduced ? 0 : 450);
    try { localStorage.setItem("fsw4d-hints", "1"); } catch { /* private mode */ }
    clearTimeout(hintTimer);
  }
  try { if (!localStorage.getItem("fsw4d-hints")) { ui.hints.hidden = false; hintTimer = setTimeout(dismissHints, 12000); } } catch { ui.hints.hidden = false; }

  // ---------------------------------------------------------------- guided tour (scroll-linked timeline)
  function buildChapters() {
    const now = nowReal();
    const counts = new Map();
    for (const e of activeAt(now)) counts.set(e.home, (counts.get(e.home) || 0) + 1);
    const top = [...counts].filter(([iso]) => countryMeta[iso] && world.countries.some((c) => c.iso3 === iso))
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const camDir = earth.worldToLocal(camera.position.clone()).normalize();
    const camLat = Math.asin(clamp(camDir.y, -1, 1)) * 180 / Math.PI;
    let phi = Math.atan2(camDir.z, -camDir.x); if (phi < 0) phi += Math.PI * 2;
    const camLon = (phi / (Math.PI * 2)) * 360 - 180;
    const totalActive = activeAt(now).length;
    const ch = [{ title: "The world's food-safety picture", text: `${totalActive} recalls, contamination findings and foodborne outbreaks are active right now. Every beacon links to an official source.`, lat: camLat, lon: camLon, dist: fitDist * 1.02, W: 0, yearsBack: 0 }];
    for (const [iso, n] of top) {
      const m = countryMeta[iso];
      const latest = activeAt(now).filter((e) => e.home === iso).sort((a, b) => b.date - a.date)[0];
      ch.push({ title: m.name, text: `${n} active issue${n === 1 ? "" : "s"}. Latest: ${latest ? latest.title : ""}`, lat: m.lat, lon: m.lon, dist: Math.max(2.1, fitDist * 0.62), W: 0, yearsBack: 0, iso });
    }
    ch.push({ title: "Where recalls & alerts cluster", text: "The W-axis shifts the globe into a density layer: brighter countries have more recalls and safety alerts in the record.", lat: 30, lon: -40, dist: fitDist * 1.05, W: 1, yearsBack: 0 });
    ch.push({ title: "Foodborne outbreak density", text: "Further along the W-axis: cholera, typhoid, hepatitis A/E, Salmonella and other food- and waterborne outbreaks reported by WHO and ReliefWeb.", lat: 5, lon: 25, dist: fitDist * 1.05, W: 2, yearsBack: 0 });
    ch.push({ title: "Five years ago", text: "Time is the 4th dimension: the scene rewinds to the issues active five years ago. The Earth and sunlight move with it.", lat: 15, lon: 40, dist: fitDist, W: 0, yearsBack: 5 });
    ch.push({ title: "Now explore on your own", text: "Drag to orbit, click any country, or search for one. Press T to replay this tour.", lat: 25, lon: -20, dist: fitDist * 1.02, W: 0, yearsBack: 0 });
    return ch;
  }
  function toggleTour(on) {
    if (on && !tour) {
      dismissHints();
      if (st.select >= 0) deselect();
      tour = new Tour(buildChapters(), {
        reduced,
        onChapter: (i, c) => {
          ui.tourStep.textContent = `Chapter ${i + 1} of ${tour.count}`;
          ui.tourTitle.textContent = c.title;
          ui.tourText.textContent = c.text;
          ui.tourDots.innerHTML = tour.chapters.map((_, k) => `<li class="${k === i ? "on" : ""}"></li>`).join("");
          haptics.tick();
          if (c.iso) {
            const idx = world.countries.findIndex((w) => w.iso3 === c.iso);
            if (idx >= 0) { st.select = idx; globe.uniforms.uSelect.value = idx; openPanel(idx, true); }
          } else if (st.select >= 0) { st.select = -1; globe.uniforms.uSelect.value = -1; ui.panel.hidden = true; arcs.clear(); }
        },
      });
      controls.enabled = false; controls.autoRotate = false;
      ui.tour.hidden = false;
      setPressed('[data-t="tour"]', true);
    } else if (!on && tour) {
      tour.dispose(); tour = null;
      controls.enabled = true; controls.autoRotate = !reduced;
      ui.tour.hidden = true;
      time.live = true; time.speed = 0;
      setPressed('[data-t="tour"]', false);
      if (st.select >= 0) deselect();
    }
  }

  // ---------------------------------------------------------------- battery: stop the loop while the tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { timer.update(); raf = requestAnimationFrame(frame); }
  }, { signal });
  ui.debug.hidden = !debugOn;

  // ---------------------------------------------------------------- loop
  const sunLocal = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    renderer.info.reset();
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    elapsed += dt;
    const ft = dt * 1000; frameEMA = frameEMA * 0.95 + ft * 0.05;

    // time
    if (time.live) time.sim = nowReal();
    else if (time.speed) {
      time.sim = clamp(time.sim + time.speed * dt * DAY_MS, nowReal() - PAST, nowReal() + FUTURE);
      if (time.sim >= nowReal() + FUTURE || time.sim <= nowReal() - PAST) time.speed = 0;
    }
    const daysFromStart = (time.sim - t0Real) / DAY_MS;
    // one turn per solar day: the sun stays put on screen while the Earth (and its terminator) spins under it
    earth.rotation.y = daysFromStart * Math.PI * 2;
    earth.updateMatrixWorld();
    const ss = subsolarPoint(time.sim);
    latLonToVec3(ss.lat, ss.lon, 1, sunLocal);
    globe.uniforms.uSun.value.copy(sunLocal).applyMatrix4(earth.matrixWorld).normalize();

    // 4D lattice: rotation planes coupled to elapsed time, simulated time and W depth
    const yearsOff = (time.sim - nowReal()) / YEAR;
    const spin = reduced ? 0.25 : 1;
    // pointer velocity -> extra 4D spin, decays like momentum
    const speedPx = Math.hypot(vel.x, vel.y);
    if (!reduced) vel.boost = lerp(vel.boost, Math.min(2.5, speedPx), 0.08);
    vel.x *= 0.9; vel.y *= 0.9;
    if (performance.now() - lastPointerTime > 120) { vel.x *= 0.8; vel.y *= 0.8; }
    tesseract.update({ xw: elapsed * 0.17 * spin + yearsOff * 0.9 + st.W * 0.6 + vel.boost * 0.4, yw: elapsed * 0.11 * spin + vel.boost * 0.25, zw: st.W * 1.1 + yearsOff * 0.5, xy: elapsed * 0.05 * spin }, st.W);
    tesseract.group.rotation.y = elapsed * 0.02 * spin;

    const W = st.W;
    globe.uniforms.uTime.value = elapsed; globe.uniforms.uW.value = W;
    fabric.uniforms.uTime.value = elapsed; fabric.uniforms.uW.value = W;
    stars.material.uniforms.uTime.value = reduced ? 0 : elapsed;
    // cursor-reactive physics: stars drift against pointer motion (depth parallax), fabric well deepens with speed
    if (!reduced) {
      stars.material.uniforms.uDrift.value.set(lerp(stars.material.uniforms.uDrift.value.x, -vel.x * 0.35, 0.1), lerp(stars.material.uniforms.uDrift.value.y, vel.y * 0.35, 0.1));
      if (pointer) fabric.uniforms.uCursor.value.y = 0.6 + Math.min(2.4, speedPx * 1.6);
    }

    // guided tour drives camera, W-axis and time from the scroll-linked timeline
    if (tour) {
      const t = tour.update(dt);
      const d = latLonToVec3(t.lat, ((t.lon + 540) % 360) - 180, 1).applyMatrix4(earth.matrixWorld).normalize();
      camera.position.copy(d.multiplyScalar(t.dist));
      camera.lookAt(0, 0, 0);
      if (Math.abs(t.W - st.W) > 0.004) setW(t.W);
      if (t.yearsBack > 0.01) { time.live = false; time.speed = 0; time.sim = nowReal() - t.yearsBack * YEAR; }
      else if (!time.live) { time.live = true; }
    }

    rebuildBeacons(false);
    beacons.update(elapsed, st.select >= 0 ? world.countries[st.select].iso3 : null);
    arcs.update(dt);
    if (pointer) pick();

    // speed-driven aberration
    const speed = time.live ? 0 : (time.speed || scrubVel * 8);
    scrubVel *= 0.9;
    lens.uniforms.uAb.value = reduced ? 0.0006 : 0.0010 + Math.min(0.0028, Math.abs(speed) * 0.00001);
    if (reduced) lens.uniforms.uCursor.value.z = 0;
    else if (pointer) lens.uniforms.uCursor.value.z = 0.5 + Math.min(1.5, speedPx);
    lens.uniforms.uTime.value = elapsed;

    updateReadout();
    if (!tour) controls.update();

    // globe screen centre & radius for the lens
    const c = v3.set(0, 0, 0).project(camera);
    lens.uniforms.uCenter.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
    const dist = camera.position.length();
    lens.uniforms.uRadius.value = Math.tan(Math.asin(1 / Math.max(dist, 1.0001))) / Math.tan((camera.fov * Math.PI) / 360) * 0.5;
    bokeh.uniforms.focus.value = Math.max(0.2, dist - 1);

    // holographic / motion eye
    let tx = 0, ty = 0, tz = 1;
    if (st.holo && head.head.ok) { tx = head.head.x; ty = head.head.y; tz = head.head.z; }
    else if (st.motion && motion && motion.tilt.ok) { tx = motion.tilt.x * 0.8; ty = -motion.tilt.y * 0.8; }
    eye.x = lerp(eye.x, tx, 0.2); eye.y = lerp(eye.y, ty, 0.2); eye.z = lerp(eye.z, tz, 0.2);
    const useEye = Math.abs(eye.x) + Math.abs(eye.y) + Math.abs(eye.z - 1) > 0.002;

    audio.update(-earth.rotation.y + Math.atan2(camera.position.x, camera.position.z), W, speed);

    const s = useEye ? applyEye() : null;
    composer.render(dt);
    if (s) restoreEye(s);

    if (debugOn && (qualityTimer > 0.5 || qualityTimer < dt)) {
      const i = renderer.info.render;
      ui.debug.textContent = `${(1000 / frameEMA).toFixed(0)} fps · ${frameEMA.toFixed(1)} ms · ${i.calls} draw calls · ${(i.triangles / 1000).toFixed(0)}k tris · DPR ${pr.toFixed(2)} · tier ${tier} · ${gpu.replace(/^ANGLE \(|\)$/g, "").slice(0, 48)}`;
    }

    // adaptive quality: aim for 60 fps
    if (st.quality === "auto" && (qualityTimer += dt) > 1) {
      qualityTimer = 0;
      if (frameEMA > 19 && pr > 0.6) { pr = Math.max(0.6, pr - 0.15); if (pr <= 0.9) bokehOn = false; applyQuality(false); }
      else if (frameEMA < 12.5 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); applyQuality(false); }
    }
  }
  setW(0);
  rebuildBeacons(true);
  updateReadout();
  // start looking at the daylit side
  const ss0 = subsolarPoint(time.sim);
  camera.position.copy(latLonToVec3(ss0.lat * 0.5 + 15, ss0.lon - 35, fitDist));
  camera.lookAt(0, 0, 0);
  frame();
  requestAnimationFrame(() => streamData()); // hero scene first, data second
  root.querySelector(".fd-exit").focus({ preventScroll: true });

  // ---------------------------------------------------------------- teardown
  return {
    dispose() {
      cancelAnimationFrame(raf);
      ac.abort();
      tweens.forEach((t) => t.kill());
      if (tour) tour.dispose();
      clearTimeout(hintTimer);
      head.stop();
      audio.stop();
      controls.dispose();
      beacons.dispose(); arcs.dispose(); globe.dispose(); tesseract.dispose(); fabric.dispose();
      stars.geometry.dispose(); stars.material.dispose();
      composer.passes.forEach((p) => p.dispose && p.dispose());
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
      document.documentElement.classList.remove("fourd-open");
    },
  };
}
