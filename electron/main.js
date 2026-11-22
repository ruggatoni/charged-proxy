// Charged Browser — a desktop browser for the Charged Proxy.
// Starts the proxy on localhost (or reuses one that's already running there)
// and opens it in a themed window with browser-style shortcuts.

import { app, BrowserWindow, Menu, dialog, session } from "electron";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.js";

const ICON = fileURLToPath(new URL("./icon.png", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const FIRST_PORT = Number(process.env.PORT) || 8080;
const MAC = process.platform === "darwin";

const BG = "#06070d";          // --bg in style.css
const BAR = "#090a16";         // .appbar in style.css
const BAR_HEIGHT = 36;         // --appbar-h in style.css

let origin = "";

// Present as plain Chrome: some sites turn away browsers that say "Electron".
const UA_PLATFORM = {
  win32: "Windows NT 10.0; Win64; x64",
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
}[process.platform] || "X11; Linux x86_64";
const CHROME_MAJOR = process.versions.chrome.split(".")[0];
app.userAgentFallback =
  `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

if (process.platform === "win32") app.setAppUserModelId("Charged Browser");

/* ---------------- the local proxy ---------------- */

async function isChargedProxy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/charged.json`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json()).name === "charged-proxy";
  } catch {
    return false;
  }
}

// Use port 8080 so settings and history carry over between launches. If a
// Charged Proxy is already running there (npm start), connect to it instead.
async function connect() {
  for (let port = FIRST_PORT; port < FIRST_PORT + 10; port++) {
    try {
      await startServer({ port, host: "127.0.0.1" });
      return port;
    } catch (err) {
      if (err.code !== "EADDRINUSE" && err.code !== "EACCES") throw err;
      if (await isChargedProxy(port)) return port;
    }
  }
  throw new Error(`Ports ${FIRST_PORT}–${FIRST_PORT + 9} are all in use.`);
}

/* ---------------- routing ---------------- */

const PROXY_PATHS = ["/scramjet/", "/uv/service/"];

// Where a link or popup should land inside the app, or null to ignore it.
function appUrlFor(url) {
  if (url.startsWith(origin + "/")) {
    const path = url.slice(origin.length);
    if (PROXY_PATHS.some((p) => path.startsWith(p))) {
      return `${origin}/#open=${encodeURIComponent(path)}`;
    }
    return url;
  }
  if (/^https?:\/\//i.test(url)) return `${origin}/#go=${encodeURIComponent(url)}`;
  return null;
}

function isAppShell(url) {
  return url === origin + "/" || url.startsWith(origin + "/#");
}

/* ---------------- windows ---------------- */

function createWindow(url = origin + "/") {
  const from = BrowserWindow.getFocusedWindow();
  const bounds = from && !from.isMaximized() && !from.isFullScreen() ? from.getBounds() : null;

  const win = new BrowserWindow({
    width: bounds ? bounds.width : 1280,
    height: bounds ? bounds.height : 820,
    ...(bounds ? { x: bounds.x + 28, y: bounds.y + 28 } : {}),
    minWidth: 480,
    minHeight: 360,
    title: "Charged Browser",
    icon: ICON,
    backgroundColor: BG,
    show: false,
    titleBarStyle: "hidden",
    ...(MAC
      ? { trafficLightPosition: { x: 14, y: 11 } }
      : { titleBarOverlay: { color: BAR, symbolColor: "#c5cbf5", height: BAR_HEIGHT } }),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  const wc = win.webContents;

  // Popups and target=_blank links open as new Charged Browser windows.
  wc.setWindowOpenHandler(({ url }) => {
    const target = appUrlFor(url);
    if (target) createWindow(target);
    return { action: "deny" };
  });

  // The window itself only ever shows the app. If a proxied page tries to
  // take over the whole window, load it in the app's frame instead.
  wc.on("will-navigate", (event, url) => {
    if (isAppShell(url)) return;
    event.preventDefault();
    const target = appUrlFor(url);
    if (target && target !== url) wc.send("charged:cmd", "hash", new URL(target).hash);
  });

  wc.on("before-input-event", (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    event.preventDefault();
    run(win, action);
  });

  // Mouse back/forward buttons (Windows).
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") run(win, "back");
    if (cmd === "browser-forward") run(win, "forward");
  });

  win.loadURL(url);
  return win;
}

/* ---------------- keyboard shortcuts ---------------- */

function shortcutFor(input) {
  if (input.type !== "keyDown") return null;
  const mod = MAC ? input.meta : input.control;
  const key = input.key.toLowerCase();

  if (mod && !input.alt) {
    if (key === "l") return "address";
    if (key === "r") return input.shift ? "reload-app" : "reload";
    if (key === "t" || key === "n") return "new-window";
    if (key === "w") return "close";
    if (key === "=" || key === "+") return "zoom-in";
    if (key === "-") return "zoom-out";
    if (key === "0") return "zoom-reset";
    if (input.shift && key === "i") return "devtools";
  }
  if (input.alt && !mod) {
    if (key === "arrowleft") return "back";
    if (key === "arrowright") return "forward";
    if (key === "home") return "home";
  }
  if (MAC && mod && key === "[") return "back";
  if (MAC && mod && key === "]") return "forward";
  if (key === "f5") return "reload";
  if (key === "f11") return "fullscreen";
  if (key === "f12") return "devtools";
  return null;
}

function run(win, action) {
  const wc = win.webContents;
  switch (action) {
    case "new-window": return createWindow();
    case "close": return win.close();
    case "reload-app": return wc.reload();
    case "fullscreen": return win.setFullScreen(!win.isFullScreen());
    case "devtools": return wc.toggleDevTools();
    case "zoom-in": return wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    case "zoom-out": return wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
    case "zoom-reset": return wc.setZoomLevel(0);
    default: return wc.send("charged:cmd", action); // address, reload, back, forward, home
  }
}

/* ---------------- permissions ---------------- */

// Every proxied site shares the app's localhost origin, so never hand out
// camera, mic, location or notifications. Allow only harmless ones.
function lockPermissions() {
  const ALLOWED = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
}

/* ---------------- start up ---------------- */

function startUrl(argv) {
  const link = argv.find((a) => /^https?:\/\//i.test(a));
  return link ? appUrlFor(link) : origin + "/";
}

async function boot() {
  Menu.setApplicationMenu(
    MAC ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null
  );
  lockPermissions();

  let port;
  try {
    port = await connect();
  } catch (err) {
    dialog.showErrorBox("Charged Browser couldn't start", `The proxy couldn't start on localhost.\n\n${err.message}`);
    app.quit();
    return;
  }

  origin = `http://localhost:${port}`;
  createWindow(startUrl(process.argv));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching it again opens a new window in the running app.
  app.on("second-instance", (_e, argv) => {
    if (origin) createWindow(startUrl(argv));
  });
  app.on("window-all-closed", () => {
    if (!MAC) app.quit();
  });
  app.whenReady().then(boot);
}
