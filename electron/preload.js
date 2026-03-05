// ─── VHS Data Codec — Electron Preload ──────────────────────────────────────
// The bridge between main process (Node.js land) and renderer (browser land).
// contextBridge is the bouncer — only lets approved functions through.
// This is Electron security 101. Don't skip it or you get pwned.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Save file via native dialog — the killer feature. No blob limits.
  saveFile: (data, filename, mimeType) =>
    ipcRenderer.invoke("save-file", data, filename, mimeType),

  // Open file via native dialog — for the File > Open crowd
  openFile: (options) =>
    ipcRenderer.invoke("open-file", options),

  // Platform info — so the UI can show "DESKTOP" badge
  getAppInfo: () =>
    ipcRenderer.invoke("get-app-info"),

  // Quick check: are we in Electron or a regular browser?
  // The codec uses this to decide between native dialog vs blob download.
  isElectron: true,
});
