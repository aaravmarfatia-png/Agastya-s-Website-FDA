// 4D geometry around the globe:
//  * a tesseract (4-cube) rotated in the XW / YW / ZW / XY planes and perspective-projected 4D -> 3D
//  * a spacetime "fabric" grid bent by a mass well under the globe, the cursor and shockwaves
//  * a starfield
import * as THREE from "three";

// ------------------------------------------------------------------ Tesseract
export class Tesseract {
  constructor() {
    this.v4 = [];
    for (let i = 0; i < 16; i++) this.v4.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1]);
    this.edges = [];
    for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (j > i) this.edges.push([i, j]); }

    this.pos = new Float32Array(this.edges.length * 6);
    this.col = new Float32Array(this.edges.length * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;

    this.vpos = new Float32Array(16 * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.vpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, color: new THREE.Color(1.2, 1.7, 1.9), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.points.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.lines, this.points);
    this.scale = 2.15;
    this.p3 = new Array(16).fill(0).map(() => [0, 0, 0, 0]);
  }

  /** angles: { xw, yw, zw, xy } in radians; wShift moves the 4D eye (W-axis depth) */
  update({ xw, yw, zw, xy }, wShift) {
    const cxw = Math.cos(xw), sxw = Math.sin(xw), cyw = Math.cos(yw), syw = Math.sin(yw);
    const czw = Math.cos(zw), szw = Math.sin(zw), cxy = Math.cos(xy), sxy = Math.sin(xy);
    const eye = 3.0 - wShift * 0.55; // 4D camera distance along W
    for (let i = 0; i < 16; i++) {
      let [x, y, z, w] = this.v4[i];
      [x, w] = [x * cxw - w * sxw, x * sxw + w * cxw];
      [y, w] = [y * cyw - w * syw, y * syw + w * cyw];
      [z, w] = [z * czw - w * szw, z * szw + w * czw];
      [x, y] = [x * cxy - y * sxy, x * sxy + y * cxy];
      const f = 1 / Math.max(0.35, eye - w);          // 4D perspective divide
      const p = this.p3[i];
      p[0] = x * f * this.scale; p[1] = y * f * this.scale; p[2] = z * f * this.scale; p[3] = w;
      this.vpos.set([p[0], p[1], p[2]], i * 3);
    }
    this.edges.forEach(([a, b], k) => {
      const A = this.p3[a], B = this.p3[b];
      this.pos.set([A[0], A[1], A[2], B[0], B[1], B[2]], k * 6);
      // colour by W depth: near in W = cyan/bright, far = violet/dim
      for (const [P, o] of [[A, 0], [B, 3]]) {
        const t = (P[3] + 1.6) / 3.2;
        this.col[k * 6 + o] = 0.25 + 0.9 * (1 - t);
        this.col[k * 6 + o + 1] = 0.55 + 0.9 * t * 0.6;
        this.col[k * 6 + o + 2] = 1.1 + 0.5 * t;
      }
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() { this.lines.geometry.dispose(); this.lines.material.dispose(); this.points.geometry.dispose(); this.points.material.dispose(); }
}

// ------------------------------------------------------------------ Spacetime fabric
const fabricVert = /* glsl */`
uniform vec3 uCursor;      // xz on the sheet, z unused; .y = strength
uniform vec4 uShock[3];    // xz origin, z unused, w start time
uniform float uTime, uW, uMass;
varying vec2 vXZ; varying float vDepth; varying float vRing;
void main(){
  vec3 p = position.xzy; // plane is built in XY, we use it as XZ
  vXZ = p.xz;
  float r = length(p.xz);
  float well = -uMass * (1.25 / sqrt(r*r + 0.55));                 // ~1/r potential of the globe
  float cr = length(p.xz - uCursor.xz);
  well -= uCursor.y * 0.55 / sqrt(cr*cr + 0.25);                    // cursor mass
  float ring = 0.0;
  for (int i = 0; i < 3; i++) {
    float age = uTime - uShock[i].w;
    if (age > 0.0 && age < 5.0) {
      float d = length(p.xz - uShock[i].xy) - age * 3.2;
      float env = exp(-d*d*0.9) * (1.0 - age / 5.0);
      well += env * 0.35 * sin(d * 3.0);
      ring += env;
    }
  }
  well += 0.05 * sin(r * 1.4 - uTime * 0.8) * uW;                   // W-axis breathing
  vRing = ring;
  vDepth = well;
  p.y += well;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const fabricFrag = /* glsl */`
uniform float uW, uTime;
varying vec2 vXZ; varying float vDepth; varying float vRing;
float gridLine(vec2 c, float s){ vec2 g = abs(fract(c / s - 0.5) - 0.5) / fwidth(c / s); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){
  float r = length(vXZ);
  float fade = smoothstep(13.0, 4.0, r);
  float l = gridLine(vXZ, 0.5) * 0.7 + gridLine(vXZ, 2.5) * 0.5;
  vec3 a = vec3(0.10, 0.55, 0.85), b = vec3(0.55, 0.25, 1.0);
  vec3 c = mix(a, b, clamp(uW * 0.5, 0.0, 1.0));
  c *= 0.5 + clamp(-vDepth, 0.0, 3.0) * 0.6;                         // deeper well = brighter
  c += vRing * vec3(0.5, 0.9, 1.4);
  gl_FragColor = vec4(c * l * fade, l * fade * 0.9);
}`;

export class Fabric {
  constructor() {
    this.uniforms = {
      uCursor: { value: new THREE.Vector3(0, 0, 0) },
      uShock: { value: [new THREE.Vector4(0, 0, 0, -99), new THREE.Vector4(0, 0, 0, -99), new THREE.Vector4(0, 0, 0, -99)] },
      uTime: { value: 0 }, uW: { value: 0 }, uMass: { value: 1 },
    };
    this.slot = 0;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28, 240, 240),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: fabricVert, fragmentShader: fabricFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.mesh.position.y = -1.55;
    this.mesh.frustumCulled = false;
  }
  shock(x, z, t) { this.uniforms.uShock.value[this.slot].set(x, z, 0, t); this.slot = (this.slot + 1) % 3; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ------------------------------------------------------------------ Stars
export function makeStars(count = 5000) {
  const pos = new Float32Array(count * 3), size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 60 + Math.random() * 40;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
    size[i] = Math.pow(Math.random(), 6) * 3 + 0.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
    vertexShader: `attribute float size; uniform float uTime, uPR; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = 0.55 + 0.45*sin(uTime*1.3 + position.x*7.0);
      gl_PointSize = size * uPR * 1.6; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vec3(0.85,0.92,1.0) * vA * 1.4, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
