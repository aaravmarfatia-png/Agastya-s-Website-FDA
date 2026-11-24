// Lazy launcher: the 4D engine (Three.js, shaders, MediaPipe…) is only downloaded when opened.
let inst = null, busy = false, returnFocus = null;

function toast(msg) {
  const t = document.createElement("div");
  t.className = "fd-toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}

async function enter() {
  if (inst || busy) return;
  if (location.protocol === "file:") {
    toast("4D mode needs the local web server. Run: python3 -m http.server 8000, then open http://localhost:8000");
    return;
  }
  busy = true;
  returnFocus = document.activeElement;
  try {
    let mod;
    try { mod = await import("./main.js"); }
    catch { await new Promise((r) => setTimeout(r, 600)); mod = await import("./main.js?retry=" + Date.now()); } // one retry for flaky dev servers
    const { mount } = mod;
    inst = await mount({ onExit: exit });
    const u = new URL(location.href); u.searchParams.set("4d", ""); history.replaceState(null, "", u.toString().replace("4d=", "4d"));
  } catch (err) {
    console.error(err);
    document.querySelectorAll(".fourd").forEach((el) => el.remove());
    document.documentElement.classList.remove("fourd-open");
    toast("The 4D globe couldn't start: " + (err && err.message ? err.message : err));
  }
  busy = false;
}

function exit() {
  if (!inst) return;
  inst.dispose();
  inst = null;
  const u = new URL(location.href); u.searchParams.delete("4d"); history.replaceState(null, "", u.toString());
  if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-enter-4d]")) {
    e.preventDefault();
    const menu = document.getElementById("menu");
    if (menu && menu.classList.contains("open")) document.getElementById("burger").click();
    enter();
  }
});
if (new URLSearchParams(location.search).has("4d")) enter();
