// ─── dev-electron.js ────────────────────────────────────────────────────────
// Starts Vite dev server, waits for it, then launches Electron.
// No extra dependencies (no concurrently, wait-on, cross-env).
// Usage:  node scripts/dev-electron.js
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require("child_process");
const http = require("http");

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

// 1. Start Vite dev server
console.log("[dev] Starting Vite...");
const vite = spawn("npx", ["vite", "--port", String(VITE_PORT), "--strictPort"], {
  stdio: "pipe",
  shell: true,
  env: { ...process.env },
});

vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
vite.on("close", (code) => {
  console.log(`[dev] Vite exited (${code})`);
  process.exit(code);
});

// 2. Poll until Vite is ready
function waitForVite(retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(VITE_URL, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= retries) {
          reject(new Error("Vite did not start in time"));
        } else {
          setTimeout(check, 500);
        }
      });
      req.end();
    };
    check();
  });
}

// 3. Launch Electron
async function main() {
  try {
    await waitForVite();
    console.log(`[dev] Vite ready at ${VITE_URL}`);
    console.log("[dev] Starting Electron...");

    const electron = spawn("npx", ["electron", "."], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL },
    });

    electron.on("close", (code) => {
      console.log(`[dev] Electron exited (${code})`);
      vite.kill();
      process.exit(code);
    });
  } catch (err) {
    console.error("[dev]", err.message);
    vite.kill();
    process.exit(1);
  }
}

main();
