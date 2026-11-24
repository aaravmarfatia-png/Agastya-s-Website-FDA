// Food Safety Watch — desktop app (Electron).
// Serves the website from inside the app on a private 127.0.0.1 port (ES modules, the 4D engine's
// WebAssembly and data files all need http://), then shows it in a native window.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".wasm": "application/wasm", ".tflite": "application/octet-stream",
  ".map": "application/json",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === "/") pathname = "/index.html";
    const file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; } // no escaping the app folder
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let win = null;

async function createWindow() {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Only this app's own pages may use the webcam (Hologram mode); everything else is refused.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = (details.requestingUrl || "").startsWith(origin);
    callback(own && (permission === "media" || permission === "fullscreen"));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => requestingOrigin === origin && (permission === "media" || permission === "fullscreen"));

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: "Food Safety Watch", backgroundColor: "#fdfbf7", show: false, autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });

  // Links to agencies open in the user's normal browser
  const external = (url) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); external(url); } });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; server.close(); });
  await win.loadURL(origin + "/");

  if (process.env.FSW_SMOKE_TEST) {
    const title = await win.webContents.executeJavaScript("document.title");
    console.log("SMOKE OK:", title);
    app.quit();
  }
}

const menu = Menu.buildFromTemplate([
  { label: "File", submenu: [{ role: "quit", label: "Exit" }] },
  { label: "View", submenu: [
    { label: "Open 4D globe", accelerator: "CmdOrCtrl+4", click: () => win && win.webContents.executeJavaScript('document.querySelector("[data-enter-4d]")?.click()') },
    { type: "separator" },
    { role: "reload" }, { role: "togglefullscreen" },
    { type: "separator" },
    { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" },
  ] },
  { label: "Help", submenu: [
    { label: "About the data sources", click: () => win && win.webContents.executeJavaScript('location.hash = "about"') },
  ] },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(menu); createWindow(); });
  app.on("window-all-closed", () => app.quit());
}
