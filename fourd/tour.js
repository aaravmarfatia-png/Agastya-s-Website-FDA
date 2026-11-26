// Scroll-linked guided tour (the "temporal choreography" layer).
// A paused GSAP timeline holds one keyframe per chapter (camera lat/lon/distance, W-axis depth,
// years back in time). Scroll / swipe / arrow keys move a *target* progress; the actual progress
// follows it with damped inertia and snaps to the nearest chapter when input stops.
import { gsap } from "gsap";

export class Tour {
  /** chapters: [{ title, text, lat, lon, dist, W, yearsBack, iso? }] */
  constructor(chapters, { reduced, onChapter }) {
    this.chapters = chapters;
    this.reduced = reduced;
    this.onChapter = onChapter;
    // unwrap longitudes so the camera always takes the short way round
    let prev = chapters[0].lon;
    const lons = chapters.map((c, i) => {
      if (!i) return prev;
      let L = c.lon;
      while (L - prev > 180) L -= 360;
      while (L - prev < -180) L += 360;
      prev = L;
      return L;
    });
    const first = chapters[0];
    this.state = { lat: first.lat, lon: lons[0], dist: first.dist, W: first.W, yearsBack: first.yearsBack };
    this.tl = gsap.timeline({ paused: true });
    chapters.slice(1).forEach((c, i) => {
      this.tl.to(this.state, { lat: c.lat, lon: lons[i + 1], dist: c.dist, W: c.W, yearsBack: c.yearsBack, duration: 1, ease: "power2.inOut" });
    });
    this.p = 0; this.target = 0; this.lastInput = 0; this.chapter = -1; this.anchor = null;
  }
  get count() { return this.chapters.length; }
  nudge(delta) {
    if (this.anchor === null) this.anchor = Math.round(this.target); // chapter where this scroll gesture began
    this.target = Math.max(0, Math.min(this.count - 1, this.target + delta));
    this.lastInput = performance.now();
  }
  goto(i) { this.target = Math.max(0, Math.min(this.count - 1, i)); this.lastInput = 0; this.anchor = null; }
  next() { this.goto(Math.round(this.target) + 1); }
  prev() { this.goto(Math.round(this.target) - 1); }

  update(dt) {
    // when scrolling pauses, snap in the direction of travel: any deliberate scroll (>= 0.2 chapter)
    // moves at least one whole chapter, so a single mouse-wheel notch works; tiny nudges spring back
    if (performance.now() - this.lastInput > 220) {
      if (this.anchor !== null) {
        const d = this.target - this.anchor;
        const steps = Math.abs(d) < 0.2 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d)));
        this.target = Math.max(0, Math.min(this.count - 1, this.anchor + steps));
        this.anchor = null;
      } else this.target = Math.round(this.target);
    }
    if (this.reduced) this.p = Math.round(this.target);
    else this.p += (this.target - this.p) * (1 - Math.exp(-dt * 5.5)); // critically-damped follow = inertia
    if (Math.abs(this.target - this.p) < 0.0005) this.p = this.target;
    this.tl.progress(this.count > 1 ? this.p / (this.count - 1) : 0);
    const ch = Math.round(this.p);
    if (ch !== this.chapter) { this.chapter = ch; this.onChapter(ch, this.chapters[ch]); }
    return this.state;
  }
  dispose() { this.tl.kill(); }
}
