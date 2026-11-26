// Shared helpers for the 4D mode.
import * as THREE from "three";

export const DEG = Math.PI / 180;
export const DAY_MS = 86400000;

/** lat/lon (degrees) -> point on a sphere, matching THREE.SphereGeometry's UV layout. */
export function latLonToVec3(lat, lon, r = 1, out = new THREE.Vector3()) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const cl = Math.cos(lat * DEG);
  return out.set(-Math.cos(phi) * cl * r, Math.sin(lat * DEG) * r, Math.sin(phi) * cl * r);
}

/** Sub-solar point for a UTC timestamp (NOAA low-precision formulae, ~0.1 deg). */
export function subsolarPoint(ms) {
  const d = ms / DAY_MS + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * DEG;     // mean anomaly
  const q = 280.459 + 0.98564736 * d;             // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * DEG;      // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * DEG; // Greenwich sidereal angle
  let lon = (ra - gmst) / DEG;
  lon = ((lon + 540) % 360) - 180;
  return { lat: dec / DEG, lon };
}

/** Deterministic 0..1 hash of a string (stable beacon jitter). */
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

