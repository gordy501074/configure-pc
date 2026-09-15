// Dev launcher: runs the Confi API server (Express + SQLite) and the Vite
// frontend concurrently so the app is reachable at http://localhost:5173
// (Vite proxies /api to :8787).
//
// Order:
//   1. db:init  -> idempotent schema + user_account migration
//   2. db:seed  -> catalog + admin/seller roles (after init)
//   3. API server + Vite dev server in parallel (the long-lived "services")
//
// The app exits when EITHER long-lived service terminates. Setup steps run
// first so the DB is ready before the servers bind.
//
// Cross-platform: spawns node directly (no shell), which correctly handles an
// executable path containing spaces (e.g. "C:\Program Files\nodejs\node.exe"),
// and forwards SIGINT/SIGTERM so children shut down cleanly.
//
// Usage: npm run dev:app   (or: npm start)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const STRIP_TYPES = "--experimental-strip-types";
const VITE_BIN = join(root, "node_modules", "vite", "bin", "vite.js");

function runNode(args) {
  return spawn(NODE, args, { stdio: "inherit" });
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null && !c.killed) {
      try {
        c.kill();
      } catch {
        /* ignore */
      }
    }
  }
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}

const children = [];

/** Register a long-lived child; when it exits, tear the whole app down. */
function service(name, child) {
  children.push(child);
  child.on("exit", (code) => {
    // eslint-disable-next-line no-console
    console.log(`[dev-app] ${name} exited (code ${code ?? "signal"})`);
    shutdown(code ?? 0);
  });
}

// Refuse to run if deps are not installed.
if (!existsSync(VITE_BIN)) {
  // eslint-disable-next-line no-console
  console.error("[dev-app] vite not found. Run `npm install` first.");
  process.exit(1);
}

// 1. db:init
// 2. db:seed
// 3. server + vite in parallel
const init = runNode(["db/init.js"]);
init.on("exit", (code) => {
  void code;
  const seed = runNode(["db/seed.js"]);
  seed.on("exit", (seedCode) => {
    void seedCode;
    const server = runNode([STRIP_TYPES, "src/server/index.ts"]);
    const vite = runNode([VITE_BIN]);
    service("API server (:8787)", server);
    service("Vite dev server (:5173)", vite);
  });
});