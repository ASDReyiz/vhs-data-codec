// ─── VHS Data Codec — Electron Main Process ────────────────────────────────
// This is the "backend" of the desktop app. Creates the window, handles
// native file dialogs (finally, no more blob URL download jank), and
// manages the IPC bridge to the renderer.
//
// Why Electron? Because browser tabs have a ~2GB blob limit and we're
// generating AVIs that can be 3GB+. Also native save dialogs are nice.
// Yes, I know Electron is heavy. It gets the job done though.
// (ok maybe later)
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// Only one instance allowed. No point having two codec windows fighting
// over the same tape deck. That's just chaos.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 800,
    minWidth: 700,
    minHeight: 600,
    title: "VHS Data Codec",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#030803", // that sweet terminal green-black
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,   // security! we're responsible adults.
      nodeIntegration: false,   // no require() in renderer. learned that lesson.
      sandbox: false,           // need this for preload to work properly
    },
  });

  // Dev mode: load from Vite's hot-reload server (the good life)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load the built index.html from disk
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

// macOS: keep running when all windows closed (standard Mac behavior)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Second instance? Just focus the existing window. Don't be greedy.
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── IPC: Native Save File Dialog ───────────────────────────────────────────
// THIS is the whole reason Electron exists in this project.
// Browser download = blob URL = 2GB limit = sadness.
// Native dialog = user picks location, we write directly = happiness.
ipcMain.handle("save-file", async (event, data, filename, mimeType) => {
  const ext = path.extname(filename).toLowerCase();
  const filters = [];
  if (ext === ".vhsd")      filters.push({ name: "VHSD Archive", extensions: ["vhsd"] });
  else if (ext === ".vhsl") filters.push({ name: "VHSL Manifest", extensions: ["vhsl"] });
  else if (ext === ".avi")  filters.push({ name: "AVI Video", extensions: ["avi"] });
  else                      filters.push({ name: "All Files", extensions: ["*"] });

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: [...filters, { name: "All Files", extensions: ["*"] }],
  });

  if (result.canceled) return { canceled: true };

  const buf = Buffer.from(data); // data arrives as ArrayBuffer from renderer
  fs.writeFileSync(result.filePath, buf);
  return { canceled: false, filePath: result.filePath, size: buf.length };
});

// ─── IPC: Native Open File Dialog ───────────────────────────────────────────
// Drag-and-drop works, but some people are File > Open traditionalists.
// Respect their workflow.
ipcMain.handle("open-file", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", ...(options?.multiple ? ["multiSelections"] : [])],
    filters: options?.filters || [
      { name: "All Supported", extensions: ["vhsd", "vhsl", "avi", "mp4", "mkv", "mov", "webm"] },
      { name: "VHSD Archives", extensions: ["vhsd"] },
      { name: "Video Files", extensions: ["avi", "mp4", "mkv", "mov", "webm"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled) return { canceled: true };

  const files = result.filePaths.map(fp => ({
    path: fp,
    name: path.basename(fp),
    data: fs.readFileSync(fp),
  }));
  return { canceled: false, files };
});

// ─── IPC: App Info ──────────────────────────────────────────────────────────
// Lets the renderer know it's running in Electron. Shows "DESKTOP" badge.
// Mostly for bragging rights.
ipcMain.handle("get-app-info", () => ({
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  isDesktop: true,
}));
