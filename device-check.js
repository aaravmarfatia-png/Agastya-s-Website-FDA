// Device check: runs the 4D globe's real modules (GPU tiering, head tracker, motion input, haptics)
// on this device so people can confirm sound, vibration, face tracking, tilt and graphics.
import { detectTier, shortGpuName } from "./fourd/gpu.js";
import { HeadTracker, MotionInput } from "./fourd/sensors.js";
import { haptics } from "./fourd/haptics.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const results = {};
const NAMES = { graphics: "Graphics", sound: "3D sound", vibe: "Vibration", face: "Face tracking", motion: "Tilt and shake" };
const WORD = { pass: "Works", warn: "Partly works", fail: "Doesn't work", na: "Not available here" };

function setResult(key, state, note = "") {
  const li = $(`#t-${key}`);
  li.dataset.state = state;
  li.querySelector(".verdict").textContent = WORD[state] + (note ? `: ${note}` : "");
  results[key] = { state, note };
  const done = Object.keys(results).length;
  $("#tally").textContent = `${done} of ${Object.keys(NAMES).length} checked`;
}

// ------------------------------------------------------------------ 1. graphics
$("#gfx-run").addEventListener("click", async () => {
  const btn = $("#gfx-run"); btn.disabled = true; btn.textContent = "Checking…";
  const gl = document.createElement("canvas").getContext("webgl2");
  const out = $("#gfx-out");
  if (!gl) {
    out.innerHTML = `<div><dt>WebGL 2</dt><dd>Missing</dd></div>`;
    setResult("graphics", "fail", "no WebGL 2, so the 4D globe can't run; the rest of the site still works");
    btn.textContent = "Run again"; btn.disabled = false; return;
  }
  const { tier, gpu } = detectTier({ getContext: () => gl });
  // refresh rate over ~1.5 s
  const fps = await new Promise((resolve) => {
    let n = 0; const t0 = performance.now();
    const f = (t) => { n++; if (t - t0 < 1500) requestAnimationFrame(f); else resolve(Math.round((n * 1000) / (t - t0))); };
    requestAnimationFrame(f);
  });
  const tierText = { low: "Light (simplified scene)", mid: "Standard", high: "Full detail" }[tier];
  out.innerHTML = `
    <div><dt>Graphics chip</dt><dd>${esc(shortGpuName(gpu))}</dd></div>
    <div><dt>4D quality level</dt><dd>${tierText}</dd></div>
    <div><dt>Screen refresh</dt><dd>${fps} fps</dd></div>
    <div><dt>Largest texture</dt><dd>${gl.getParameter(gl.MAX_TEXTURE_SIZE)} px</dd></div>`;
  if (tier === "low") setResult("graphics", "warn", "the globe will use its simplified scene");
  else setResult("graphics", "pass", `${tierText.toLowerCase()} quality`);
  btn.textContent = "Run again"; btn.disabled = false;
});

// ------------------------------------------------------------------ 2. 3D sound (same HRTF panning the globe uses)
let actx = null;
$("#snd-play").addEventListener("click", async () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { setResult("sound", "na", "this browser has no Web Audio"); return; }
  actx = actx || new AC();
  if (actx.state === "suspended") await actx.resume();
  const t = actx.currentTime, dur = 2.4;
  const pan = actx.createPanner();
  Object.assign(pan, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, rolloffFactor: 0.6 });
  const g = actx.createGain(); g.gain.value = 0;
  pan.connect(actx.destination); g.connect(pan);
  for (let i = 0; i < 8; i++) {           // eight pings while the source sweeps from left to right
    const o = actx.createOscillator(); o.type = "sine";
    const at = t + (i * dur) / 8;
    o.frequency.setValueAtTime(880, at); o.frequency.exponentialRampToValueAtTime(520, at + 0.22);
    const e = actx.createGain(); e.gain.setValueAtTime(0.0001, at);
    e.gain.exponentialRampToValueAtTime(0.35, at + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.connect(e).connect(pan); o.start(at); o.stop(at + 0.3);
  }
  if (pan.positionX) {
    pan.positionX.setValueAtTime(-3, t); pan.positionX.linearRampToValueAtTime(3, t + dur);
    pan.positionZ.setValueAtTime(-0.5, t);
  } else pan.setPosition(0, 0, -0.5);
  const dot = $("#sweep-dot");
  dot.animate([{ left: "6%", opacity: 1 }, { left: "90%", opacity: 1 }], { duration: dur * 1000, easing: "linear" });
  $("#snd-ask").hidden = false;
});
/** wire a row of "what happened?" answer buttons to a test result */
function bindAnswers(fieldset, key, note) {
  $(fieldset).addEventListener("click", (e) => {
    const b = e.target.closest("[data-verdict]"); if (!b) return;
    $(fieldset).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    setResult(key, b.dataset.verdict, note(b));
  });
}
bindAnswers("#snd-ask", "sound", (b) => b.textContent.toLowerCase());

// ------------------------------------------------------------------ 3. vibration
if (!navigator.vibrate) {
  setResult("vibe", "na", "this device or browser can't vibrate from a web page; that's normal on iPhones and computers");
  $("#vib-run").disabled = true;
}
$("#vib-run").addEventListener("click", () => {
  haptics.enabled = true;
  haptics.heartbeat();
  $("#vib-ask").hidden = false;
});
bindAnswers("#vib-ask", "vibe", (b) => (b.dataset.verdict === "pass" ? "felt the heartbeat" : "nothing felt"));

// ------------------------------------------------------------------ 4. face tracking (the globe's own HeadTracker)
const tracker = new HeadTracker();
let faceRaf = 0, faceFrames = 0, faceStart = 0, range = { x: [0, 0], y: [0, 0], z: [1, 1] };
function faceLoop() {
  const h = tracker.head;
  const cross = $("#cross");
  if (h.ok) {
    faceFrames++;
    cross.classList.remove("lost");
    cross.style.left = `${50 + h.x * 50}%`;
    cross.style.top = `${50 - h.y * 50}%`;
    $("#f-found").textContent = "found";
    range.x = [Math.min(range.x[0], h.x), Math.max(range.x[1], h.x)];
    range.y = [Math.min(range.y[0], h.y), Math.max(range.y[1], h.y)];
    range.z = [Math.min(range.z[0], h.z), Math.max(range.z[1], h.z)];
  } else { cross.classList.add("lost"); $("#f-found").textContent = "searching"; }
  $("#f-x").textContent = h.x.toFixed(2);
  $("#f-y").textContent = h.y.toFixed(2);
  $("#f-z").textContent = h.z.toFixed(2);
  $("#f-zbar").style.width = `${Math.max(4, Math.min(100, ((1.8 - h.z) / 1.25) * 100))}%`;
  const moved = range.x[1] - range.x[0] > 0.35 || range.y[1] - range.y[0] > 0.35;
  if (!results.face || results.face.state !== "pass") {
    if (faceFrames > 30 && moved) setResult("face", "pass", "your face was found and followed");
    else if (faceFrames > 30) setResult("face", "warn", "face found; now move your head to confirm tracking");
    else if (performance.now() - faceStart > 12000) setResult("face", "warn", "camera works, but no face found; try more light");
  }
  faceRaf = requestAnimationFrame(faceLoop);
}
async function stopFace() {
  cancelAnimationFrame(faceRaf);
  tracker.stop();
  $("#face-run").textContent = "Start camera";
}
$("#face-run").addEventListener("click", async () => {
  const btn = $("#face-run");
  if (tracker.running) { stopFace(); return; }
  btn.disabled = true; btn.textContent = "Starting camera…";
  $("#face-box").hidden = false;
  try {
    await tracker.start($("#cam"));
    faceFrames = 0; faceStart = performance.now(); range = { x: [0, 0], y: [0, 0], z: [1, 1] };
    btn.textContent = "Stop camera";
    faceLoop();
  } catch (err) {
    tracker.stop();
    const msg = err && err.name === "NotAllowedError" ? "camera permission was blocked; allow it in the browser's site settings"
      : err && err.name === "NotFoundError" ? "no camera found" : (err && err.message) || String(err);
    setResult("face", "fail", msg);
    btn.textContent = "Try again";
    $("#face-box").hidden = true;
  }
  btn.disabled = false;
});
addEventListener("pagehide", () => tracker.stop());

// ------------------------------------------------------------------ 5. tilt & shake (the globe's own MotionInput)
const motionAbort = new AbortController();
if (!MotionInput.supported()) {
  setResult("motion", "na", "no motion sensors on this device; that's normal for computers");
  $("#mot-run").disabled = true;
}
$("#mot-run").addEventListener("click", async () => {
  let shakes = 0;
  const m = new MotionInput({ signal: motionAbort.signal, onShake: () => { shakes++; $("#shakes").textContent = shakes; haptics.tick(); setResult("motion", "pass", "tilt and shake detected"); } });
  try {
    await m.start();
    $("#mot-run").disabled = true; $("#mot-run").textContent = "Sensors on";
    $("#tilt-box").hidden = false; $("#shake-note").hidden = false;
    let maxTilt = 0, readings = 0, raf = 0;
    const loop = () => {
      if (m.tilt.ok) {
        readings++;
        $("#tilt-dot").style.transform = `translate(${m.tilt.x * 70}px, ${m.tilt.y * 70}px)`;
        maxTilt = Math.max(maxTilt, Math.abs(m.tilt.x), Math.abs(m.tilt.y));
        if (maxTilt > 0.3 && (!results.motion || results.motion.state !== "pass")) setResult("motion", shakes ? "pass" : "warn", shakes ? "tilt and shake detected" : "tilt works; now give it a shake");
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    addEventListener("pagehide", () => { cancelAnimationFrame(raf); motionAbort.abort(); }, { once: true });
    // only a sensor that never reports is broken; one that simply hasn't been tilted yet is fine
    setTimeout(() => {
      if (results.motion) return;
      if (!readings) setResult("motion", "fail", "permission given, but the sensors sent no readings");
      else setResult("motion", "warn", "sensors respond; tilt the device further to confirm");
    }, 6000);
  } catch (err) {
    setResult("motion", "fail", (err && err.message) || String(err));
  }
});

// ------------------------------------------------------------------ copy results
$("#copy").addEventListener("click", async () => {
  const ua = navigator.userAgentData ? `${navigator.userAgentData.platform}, ${navigator.userAgentData.brands.map((b) => b.brand).filter((b) => !/not/i.test(b)).join("/")}` : navigator.userAgent;
  const lines = [`Food Safety Watch device check (${new Date().toLocaleString()})`, `Device: ${ua}`, ""];
  for (const k of Object.keys(NAMES)) {
    const r = results[k];
    lines.push(`${NAMES[k]}: ${r ? WORD[r.state] + (r.note ? ` (${r.note})` : "") : "not checked"}`);
  }
  const gfx = [...document.querySelectorAll("#gfx-out div")].map((d) => `${d.querySelector("dt").textContent}: ${d.querySelector("dd").textContent}`);
  if (gfx.length) lines.push("", ...gfx);
  const text = lines.join("\n");
  const btn = $("#copy");
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); btn.textContent = "Copied";
  }
  setTimeout(() => { btn.textContent = "Copy results"; }, 2000);
});
