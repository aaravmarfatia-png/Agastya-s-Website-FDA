// Physical inputs for the 4D mode. Everything runs on-device: no video or motion data leaves the browser.
//  * HeadTracker: webcam + MediaPipe face detector -> head position (x, y, distance)
//  * MotionInput: DeviceOrientation (tilt parallax) + DeviceMotion (shake -> shockwave)

export class HeadTracker {
  constructor() {
    this.head = { x: 0, y: 0, z: 1, ok: false };
    this.running = false;
    this.video = null; this.stream = null; this.detector = null; this.timer = 0;
  }

  async start(previewEl) {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(new URL("vendor/lib/@mediapipe/tasks-vision/wasm", document.baseURI).href);
    this.detector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL("vendor/blaze_face_short_range.tflite", document.baseURI).href, delegate: "GPU" },
      runningMode: "VIDEO", minDetectionConfidence: 0.5,
    });
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    this.video = previewEl || document.createElement("video");
    Object.assign(this.video, { muted: true, playsInline: true, autoplay: true });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    let last = -1;
    const loop = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.readyState >= 2 && v.currentTime !== last) {
        last = v.currentTime;
        const res = this.detector.detectForVideo(v, performance.now());
        const d = res.detections && res.detections[0];
        if (d && d.boundingBox) {
          const b = d.boundingBox, W = v.videoWidth || 640, H = v.videoHeight || 480;
          const cx = (b.originX + b.width / 2) / W, cy = (b.originY + b.height / 2) / H;
          const nx = -(cx - 0.5) * 2;             // mirror: moving right = looking from the right
          const ny = -(cy - 0.5) * 2;
          const nz = Math.min(1.8, Math.max(0.55, 0.32 / (b.width / W))); // relative distance (1 ~ normal sitting distance)
          const k = 0.35;
          this.head.x += (nx - this.head.x) * k;
          this.head.y += (ny - this.head.y) * k;
          this.head.z += (nz - this.head.z) * k;
          this.head.ok = true;
        } else this.head.ok = false;
      }
      this.timer = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    if (this.detector) try { this.detector.close(); } catch { /* ignore */ }
    this.stream = null; this.detector = null;
    this.head = { x: 0, y: 0, z: 1, ok: false };
  }
}

export class MotionInput {
  constructor({ onShake, signal }) {
    this.tilt = { x: 0, y: 0, ok: false };
    this.onShake = onShake;
    this.signal = signal;
    this.base = null;
    this.lastShake = 0;
  }

  static supported() { return typeof window.DeviceOrientationEvent !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0); }

  async start() {
    // iOS 13+ requires an explicit permission prompt from a user gesture
    const DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const r = await DOE.requestPermission();
      if (r !== "granted") throw new Error("Motion permission denied");
    }
    if (DME && typeof DME.requestPermission === "function") { try { await DME.requestPermission(); } catch { /* optional */ } }
    window.addEventListener("deviceorientation", (e) => {
      if (e.beta == null) return;
      if (!this.base) this.base = { beta: e.beta, gamma: e.gamma };
      this.tilt.x = Math.max(-1, Math.min(1, (e.gamma - this.base.gamma) / 30));
      this.tilt.y = Math.max(-1, Math.min(1, (e.beta - this.base.beta) / 30));
      this.tilt.ok = true;
    }, { signal: this.signal });
    window.addEventListener("devicemotion", (e) => {
      const a = e.acceleration || e.accelerationIncludingGravity;
      if (!a) return;
      const g = e.acceleration ? 0 : 9.81;
      const mag = Math.abs(Math.hypot(a.x || 0, a.y || 0, a.z || 0) - g);
      const now = performance.now();
      if (mag > 14 && now - this.lastShake > 1200) { this.lastShake = now; this.onShake && this.onShake(mag); }
    }, { signal: this.signal });
  }

  recenter() { this.base = null; }
}
