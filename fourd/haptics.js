// Tactile patterns via the Vibration API (no-op where unsupported, e.g. desktop & iOS Safari).
// Dependency-free so light pages (device-check) can use it too.
export const haptics = {
  enabled: true,
  _go(p) {
    // browsers only allow vibration after the user has interacted with the page
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (this.enabled && active && navigator.vibrate) try { navigator.vibrate(p); } catch { /* ignore */ }
  },
  tick() { this._go(10); },
  heartbeat() { this._go([28, 90, 42]); },
  rumble() { this._go([12, 18, 22, 18, 34, 18, 48, 24, 34, 18, 22, 18, 12]); },
  scrub() { this._go(4); },
};
