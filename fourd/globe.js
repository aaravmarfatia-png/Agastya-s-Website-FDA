// High-detail Earth: real country borders (world-atlas 50m) rasterised into a land/border
// texture and a country-ID texture, a single shader that does solar day/night, ocean specular,
// hover/selection extrusion with glowing edges, gravitational shockwaves and the W-axis layers,
// plus a procedural cloud shell and a Rayleigh-tinted atmosphere.
import * as THREE from "three";
import { feature } from "topojson-client";

const MAX_IDS = 256;

// ------------------------------------------------------------------ texture building
function unwrapRing(ring) {
  const out = [];
  let prev = null, shift = 0;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      const d = lon + shift - prev;
      if (d > 180) shift -= 360; else if (d < -180) shift += 360;
    }
    const L = lon + shift;
    out.push([L, lat]);
    prev = L;
  }
  return out;
}

function tracePolygons(ctx, geom, W, H) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  ctx.beginPath();
  for (const poly of polys) {
    for (const ring of poly) {
      const r = unwrapRing(ring);
      for (const off of [-W, 0, W]) {
        r.forEach(([lon, lat], i) => {
          const x = ((lon + 180) / 360) * W + off, y = ((90 - lat) / 180) * H;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
  }
}

/** rough visual centre: mean of the largest outer ring (by bbox area) */
function centroid(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let best = null, bestA = -1;
  for (const p of polys) {
    const r = unwrapRing(p[0]);
    const xs = r.map((c) => c[0]), ys = r.map((c) => c[1]);
    const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (a > bestA) { bestA = a; best = r; }
  }
  if (!best) return { lat: 0, lon: 0 };
  let lon = best.reduce((s, c) => s + c[0], 0) / best.length;
  const lat = best.reduce((s, c) => s + c[1], 0) / best.length;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

/** fetch JSON while reporting download progress (0..1) for the preloader */
async function fetchJsonProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get("content-length") || 0;
  if (!res.body || !total || !onProgress) return res.json();
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.min(1, got / total));
  }
  return JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()));
}

export async function loadWorld(url, { hiRes, onProgress }) {
  const topo = await fetchJsonProgress(url, onProgress);
  const fc = feature(topo, topo.objects.countries);
  const countries = fc.features.slice(0, MAX_IDS - 1).map((f, i) => ({
    index: i, iso3: f.properties.iso3, name: f.properties.name, feature: f, centroid: centroid(f.geometry),
  }));

  // Land (R) + borders (G)
  const LW = hiRes ? 4096 : 2048, LH = LW / 2;
  const land = document.createElement("canvas");
  land.width = LW; land.height = LH;
  const lc = land.getContext("2d");
  lc.fillStyle = "#000"; lc.fillRect(0, 0, LW, LH);
  lc.fillStyle = "#ff0000";
  for (const c of countries) { tracePolygons(lc, c.feature.geometry, LW, LH); lc.fill("evenodd"); }
  lc.globalCompositeOperation = "lighter";
  lc.strokeStyle = "#00ff00";
  lc.lineWidth = LW / 2048;
  lc.lineJoin = "round";
  for (const c of countries) { tracePolygons(lc, c.feature.geometry, LW, LH); lc.stroke(); }

  // Country IDs: R = index, G = 255 marks a clean (non-antialiased) pixel
  const IW = 2048, IH = 1024;
  const idc = document.createElement("canvas");
  idc.width = IW; idc.height = IH;
  const ic = idc.getContext("2d", { willReadFrequently: true });
  ic.fillStyle = "#000"; ic.fillRect(0, 0, IW, IH);
  for (const c of countries) {
    ic.fillStyle = `rgb(${c.index},255,0)`;
    tracePolygons(ic, c.feature.geometry, IW, IH);
    ic.fill("evenodd");
  }
  const idPixels = ic.getImageData(0, 0, IW, IH).data;

  return { countries, land, idCanvas: idc, idPixels, IW, IH };
}

// ------------------------------------------------------------------ shaders
const NOISE = /* glsl */`
float hash3(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i+vec3(0,0,0)),hash3(i+vec3(1,0,0)),f.x), mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x), mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;

const ID_FN = /* glsl */`
uniform sampler2D uId;
float idAt(vec2 uv){ vec4 c = texture2D(uId, uv); return c.g > 0.98 ? floor(c.r*255.0+0.5) : -1.0; }
`;

const globeVert = /* glsl */`
${ID_FN}
uniform float uHover, uSelect, uTime;
uniform vec4 uShock[3];          // xyz = local unit direction, w = start time
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vRing; varying vec3 vLocal;
void main(){
  vUv = uv;
  vec3 n = normalize(position);
  vLocal = n;
  float id = idAt(uv);
  float lift = 0.0;
  if (id >= 0.0 && id == uHover) lift = 0.016;
  if (id >= 0.0 && id == uSelect) lift = 0.026;
  float disp = 0.0, ring = 0.0;
  for (int i = 0; i < 3; i++) {
    float age = uTime - uShock[i].w;
    if (age > 0.0 && age < 3.5) {
      float ang = acos(clamp(dot(n, uShock[i].xyz), -1.0, 1.0));
      float d = ang - age * 1.05;
      float env = exp(-d*d*28.0) * (1.0 - age/3.5);
      disp += env * 0.03 * cos(d * 22.0);
      ring += env;
    }
  }
  vRing = ring;
  vec3 p = position * (1.0 + lift + disp);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const globeFrag = /* glsl */`
${ID_FN}
uniform sampler2D uLand, uData;
uniform vec3 uSun;
uniform float uHover, uSelect, uTime, uW, uTexel;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vRing; varying vec3 vLocal;

vec3 heat(float v){ return mix(mix(vec3(0.05,0.18,0.35), vec3(0.95,0.55,0.12), smoothstep(0.0,0.6,v)), vec3(1.0,0.18,0.1), smoothstep(0.55,1.0,v)); }
vec3 geoc(float v){ return mix(vec3(0.12,0.06,0.25), vec3(0.85,0.35,1.0), v); }

void main(){
  vec4 land = texture2D(uLand, vUv);
  float id = idAt(vUv);
  vec4 data = id >= 0.0 ? texture2D(uData, vec2((id + 0.5) / 256.0, 0.5)) : vec4(0.0);

  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSun);
  float ndl = dot(N, L);
  float day = smoothstep(-0.10, 0.22, ndl);

  // surface
  // linear-light colours (the output pass converts to sRGB)
  vec3 ocean = mix(vec3(0.0006,0.003,0.009), vec3(0.002,0.012,0.032), 0.5 + 0.5*N.y);
  vec3 landC = mix(vec3(0.012,0.032,0.018), vec3(0.045,0.075,0.035), smoothstep(-0.6, 0.6, vLocal.y));
  vec3 base = mix(ocean, landC, land.r);
  vec3 col = base * (0.06 + 1.15 * max(ndl, 0.0));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 180.0) * (1.0 - land.r) * day;
  col += vec3(1.0, 0.92, 0.75) * spec * 0.45;
  // night side: faint land glow so continents stay readable (not city lights)
  col += (1.0 - day) * land.r * vec3(0.002, 0.008, 0.007);
  // twilight band at the terminator
  col += exp(-ndl*ndl*90.0) * vec3(1.0, 0.36, 0.12) * 0.06;

  // W-axis layers: 0 borders & sources, 1 climate hazards, 2 geophysical & energy grid
  float w0 = clamp(1.0 - uW, 0.0, 1.0), w1 = clamp(1.0 - abs(uW - 1.0), 0.0, 1.0), w2 = clamp(uW - 1.0, 0.0, 1.0);
  col = mix(col, heat(data.r) * heat(data.r) * (0.25 + 0.75*day), w1 * land.r * 0.85);
  col = mix(col, geoc(data.g) * geoc(data.g) * (0.25 + 0.75*day), w2 * land.r * 0.8);
  vec2 g = abs(fract(vUv * vec2(72.0, 36.0)) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
  float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vUv.x * 60.0);
  col += w2 * grid * vec3(0.3, 0.12, 0.8) * (0.15 + 0.9 * pulse * data.g);

  // borders glow, stronger in layer 0
  col += land.g * vec3(0.12, 0.55, 0.45) * (0.25 + 0.45 * w0) * (0.35 + 0.65 * day);
  // active crisis tint at current time (data.b) in layer 0
  col += w0 * data.b * land.r * vec3(0.5, 0.08, 0.03) * 0.22;

  // hover / selection: fill + edge glow (edge = neighbouring pixel belongs to another country)
  if (id >= 0.0 && (id == uHover || id == uSelect)) {
    float sel = id == uSelect ? 1.0 : 0.0;
    col += vec3(0.04, 0.32, 0.24) * (0.25 + 0.35 * sel);
    float e = 0.0;
    e += step(0.5, abs(idAt(vUv + vec2(uTexel, 0.0)) - id));
    e += step(0.5, abs(idAt(vUv - vec2(uTexel, 0.0)) - id));
    e += step(0.5, abs(idAt(vUv + vec2(0.0, uTexel)) - id));
    e += step(0.5, abs(idAt(vUv - vec2(0.0, uTexel)) - id));
    col += min(e, 1.0) * vec3(0.5, 1.6, 1.3) * (1.2 + sel);
  }

  // gravitational shockwave ring
  col += vRing * vec3(0.25, 0.55, 0.9) * 0.55;

  // rim (inner atmosphere)
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += rim * vec3(0.06, 0.2, 0.6) * (0.15 + 0.85 * day);

  gl_FragColor = vec4(col, 1.0);
}`;

const cloudVert = /* glsl */`
varying vec3 vN; varying vec3 vW; varying vec3 vLocal;
void main(){ vLocal = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const cloudFrag = /* glsl */`
${NOISE}
uniform vec3 uSun; uniform float uTime, uW;
varying vec3 vN; varying vec3 vW; varying vec3 vLocal;
void main(){
  vec3 p = vLocal * 3.2;
  float a = uTime * 0.012;
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  float n = fbm(p + vec3(0.0, uTime*0.004, 0.0));
  float band = 0.75 + 0.25 * cos(vLocal.y * 9.0);
  float d = smoothstep(0.50, 0.78, n * band);
  float light = 0.08 + 1.1 * max(dot(normalize(vN), normalize(uSun)), 0.0);
  float alpha = d * 0.72 * (1.0 - 0.6 * clamp(uW, 0.0, 1.0));
  gl_FragColor = vec4(vec3(0.85) * light, alpha * 0.85);
}`;

const atmoVert = /* glsl */`
varying vec3 vN; varying vec3 vW;
void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const atmoFrag = /* glsl */`
uniform vec3 uSun;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float facing = dot(N, V);                    // back faces: negative towards the limb
  float limb = pow(clamp(1.0 + facing, 0.0, 1.0), 4.0);
  float sun = dot(N, normalize(uSun));
  // Rayleigh: scattering ~ 1/lambda^4 -> blue dominant; longer path near the terminator reddens it
  vec3 rayleigh = vec3(0.18, 0.42, 1.0);
  vec3 sunset = vec3(1.0, 0.45, 0.18);
  float lit = smoothstep(-0.35, 0.45, sun);
  vec3 c = mix(sunset, rayleigh, smoothstep(-0.05, 0.35, sun)) * lit;
  gl_FragColor = vec4(c * limb * 1.3, limb * lit);
}`;

// ------------------------------------------------------------------ Globe
export class Globe {
  constructor(world, { anisotropy, globeSeg = [384, 192], cloudSeg = [128, 64] }) {
    this.world = world;
    this.group = new THREE.Group();

    this.landTex = new THREE.CanvasTexture(world.land);
    this.landTex.anisotropy = anisotropy;
    this.landTex.colorSpace = THREE.NoColorSpace;

    this.idTex = new THREE.CanvasTexture(world.idCanvas);
    Object.assign(this.idTex, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.NoColorSpace });

    this.data = new Uint8Array(MAX_IDS * 4);
    this.dataTex = new THREE.DataTexture(this.data, MAX_IDS, 1, THREE.RGBAFormat);
    Object.assign(this.dataTex, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.dataTex.needsUpdate = true;

    this.uniforms = {
      uLand: { value: this.landTex }, uId: { value: this.idTex }, uData: { value: this.dataTex },
      uSun: { value: new THREE.Vector3(1, 0.2, 0.4) }, uHover: { value: -1 }, uSelect: { value: -1 },
      uTime: { value: 0 }, uW: { value: 0 }, uTexel: { value: 1 / world.IW },
      uShock: { value: [new THREE.Vector4(0, 1, 0, -99), new THREE.Vector4(0, 1, 0, -99), new THREE.Vector4(0, 1, 0, -99)] },
    };
    this.shockSlot = 0;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, globeSeg[0], globeSeg[1]),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: globeVert, fragmentShader: globeFrag }),
    );
    this.group.add(this.mesh);

    this.cloudUniforms = { uSun: this.uniforms.uSun, uTime: this.uniforms.uTime, uW: this.uniforms.uW };
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.014, cloudSeg[0], cloudSeg[1]),
      new THREE.ShaderMaterial({ uniforms: this.cloudUniforms, vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false }),
    );
    this.group.add(this.clouds);

    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.085, 96, 48),
      new THREE.ShaderMaterial({ uniforms: { uSun: this.uniforms.uSun }, vertexShader: atmoVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.group.add(this.atmo);

    this.byIso = new Map(world.countries.filter((c) => c.iso3).map((c) => [c.iso3, c]));
  }

  /** country index under a uv coordinate, or -1 */
  idAtUv(uv) {
    const { IW, IH, idPixels } = this.world;
    const x = Math.min(IW - 1, Math.max(0, Math.floor(uv.x * IW)));
    const y = Math.min(IH - 1, Math.max(0, Math.floor((1 - uv.y) * IH)));
    const i = (y * IW + x) * 4;
    return idPixels[i + 1] > 250 ? idPixels[i] : -1;
  }

  setCountryData(index, { climate, geo, active, sources }) {
    const o = index * 4;
    if (climate !== undefined) this.data[o] = climate;
    if (geo !== undefined) this.data[o + 1] = geo;
    if (active !== undefined) this.data[o + 2] = active;
    if (sources !== undefined) this.data[o + 3] = sources;
  }
  commitData() { this.dataTex.needsUpdate = true; }

  shock(localDir, time) {
    const s = this.uniforms.uShock.value[this.shockSlot];
    s.set(localDir.x, localDir.y, localDir.z, time);
    this.shockSlot = (this.shockSlot + 1) % 3;
  }

  dispose() {
    for (const m of [this.mesh, this.clouds, this.atmo]) { m.geometry.dispose(); m.material.dispose(); }
    this.landTex.dispose(); this.idTex.dispose(); this.dataTex.dispose();
  }
}
