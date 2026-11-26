// Device tiering ("graceful degradation") without third-party benchmark lookups:
// reads the GPU name the browser exposes, plus CPU cores, memory and screen type.
//   low  -> software renderers and old/entry mobile GPUs: simplified scene, no depth of field
//   mid  -> default
//   high -> discrete / Apple-silicon class GPUs
export function detectTier(renderer) {
  const gl = renderer.getContext();
  let name = "";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* some browsers hide it */ }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8; // GB, Chromium only
  const mobile = matchMedia("(pointer: coarse)").matches;
  const n = name.toLowerCase();

  const software = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(n);
  const weakGpu = /mali-[2-7]\d{2}|mali-t|adreno \(tm\) [1-5]\d{2}|adreno [1-5]\d{2}|powervr|intel\(r\) hd graphics( [2-5]\d{3})?$|intel.*gma|sgx/.test(n);
  const strongGpu = /apple m\d|apple gpu|rtx|gtx 1[06-9]|gtx [2-9]\d|radeon rx|radeon pro|arc a\d|adreno \(tm\) [7-8]\d{2}|adreno [7-8]\d{2}/.test(n);

  let tier = "mid";
  if (software || weakGpu || (cores <= 4 && mem <= 4) || (mobile && mem <= 3)) tier = "low";
  else if (strongGpu && cores >= 8 && !mobile) tier = "high";
  return { tier, gpu: name || "unknown GPU", software };
}

// Per-tier scene budget
export const BUDGET = {
  low: { globeSeg: [192, 96], cloudSeg: [64, 32], fabricSeg: 110, stars: 1500, bokeh: false, maxPR: 1, hiRes: false, clouds: true },
  mid: { globeSeg: [320, 160], cloudSeg: [96, 48], fabricSeg: 180, stars: 3500, bokeh: true, maxPR: 1.5, hiRes: true, clouds: true },
  high: { globeSeg: [384, 192], cloudSeg: [128, 64], fabricSeg: 240, stars: 5000, bokeh: true, maxPR: 2, hiRes: true, clouds: true },
};
