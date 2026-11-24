// Copies the exact library files the 4D globe needs from node_modules into vendor/lib/,
// so the site works on any static host (GitHub Pages) and in the desktop app without node_modules.
// It follows every `import` from the entry points below and copies only what is reachable.
// Run after `npm install` or after upgrading a library:   node scripts/vendor-libs.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NM = join(ROOT, "node_modules");
const OUT = join(ROOT, "vendor", "lib");

// bare specifier -> file in node_modules (mirrors the import map in index.html)
const BARE = {
  three: "three/build/three.module.js",
  gsap: "gsap/index.js",
  "topojson-client": "topojson-client/src/index.js",
  "@mediapipe/tasks-vision": "@mediapipe/tasks-vision/vision_bundle.mjs",
};
const ENTRIES = [
  ...Object.values(BARE),
  "three/examples/jsm/controls/OrbitControls.js",
  "three/examples/jsm/postprocessing/EffectComposer.js",
  "three/examples/jsm/postprocessing/RenderPass.js",
  "three/examples/jsm/postprocessing/UnrealBloomPass.js",
  "three/examples/jsm/postprocessing/ShaderPass.js",
  "three/examples/jsm/postprocessing/BokehPass.js",
  "three/examples/jsm/postprocessing/OutputPass.js",
  "three/examples/jsm/lines/Line2.js",
  "three/examples/jsm/lines/LineGeometry.js",
  "three/examples/jsm/lines/LineMaterial.js",
];
// non-JS assets loaded at runtime
const ASSETS = [
  "@mediapipe/tasks-vision/wasm/vision_wasm_internal.js",
  "@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
];
const LICENSES = ["three/LICENSE", "gsap/README.md", "topojson-client/LICENSE", "@mediapipe/tasks-vision/README.md"];

const IMPORT_RE = /(?:import|export)\s*(?:[\w*{}\s,]*?\s*from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpec(spec, fromFile) {
  if (BARE[spec]) return join(NM, BARE[spec]);
  if (spec.startsWith("three/addons/")) return join(NM, "three/examples/jsm", spec.slice("three/addons/".length));
  if (spec.startsWith(".")) return resolve(dirname(fromFile), spec);
  throw new Error(`Unmapped import "${spec}" in ${relative(ROOT, fromFile)}`);
}

rmSync(OUT, { recursive: true, force: true });
const seen = new Set();
const queue = ENTRIES.map((e) => join(NM, e));
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  if (!existsSync(file)) throw new Error(`Missing ${relative(ROOT, file)} — run npm install`);
  seen.add(file);
  if (/\.m?js$/.test(file)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2];
      if (!spec || /^(https?:|data:|node:)/.test(spec)) continue;
      queue.push(resolveSpec(spec, file));
    }
  }
}
for (const a of [...ASSETS, ...LICENSES]) seen.add(join(NM, a));

let bytes = 0;
for (const file of seen) {
  const dest = join(OUT, relative(NM, file));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
  bytes += statSync(file).size;
}
writeFileSync(join(OUT, "README.md"), "Copied from node_modules by scripts/vendor-libs.mjs — do not edit by hand.\nLicences: see each package folder.\n");
console.log(`vendor/lib: ${seen.size} files, ${(bytes / 1048576).toFixed(1)} MB`);
