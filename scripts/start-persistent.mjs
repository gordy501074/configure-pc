// Persistent dev launcher for the Confi app (survives session/terminal close).
//
// Unlike `npm start` (foreground, tied to the invoking session), this script
// starts the app fully detached:
//   - db:init -> db:seed -> API server (:8787) + Vite dev server (:5173)
//   - detached process tree, so it keeps running after the parent session ends
//   - stdout/stderr redirected to logs/dev-app.log
//   - PID recorded in .run/dev-app.pid so it can be stopped/queried later
//
// Windows specifics: `node spawn(detached:true)` uses CREATE_NEW_PROCESS_GROUP,
// which isolates the child but its grandchildren (Vite/API, spawned by
// dev-app.mjs with stdio:inherit) stay in the same console group and receive
// Ctrl-C when the parent terminal closes (Vite exits with 0xC000013A ->
// STATUS_CONTROL_C_EXIT, which tears the whole tree down). To truly detach the
// whole tree on Windows we launch dev-app.mjs through `Start-Process`, which
// puts it in its own job/console independent of the invoking terminal.
//
// Usage:
//   npm run start:persistent     start (no-op if already running)
//   npm run status:persistent    print running PID
//   npm run stop:persistent      stop the detached app cleanly

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import os from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const VITE_BIN = join(root, "node_modules", "vite", "bin", "vite.js");
const IS_WIN = os.platform() === "win32";

const LOG_DIR = join(root, "logs");
const RUN_DIR = join(root, ".run");
const LOG_FILE = join(LOG_DIR, "dev-app.log");
const OUT_FILE = join(LOG_DIR, "dev-app.out.log");
const ERR_FILE = join(LOG_DIR, "dev-app.err.log");
const PID_FILE = join(RUN_DIR, "dev-app.pid");

const log = (msg) => console.log(`[persistent] ${msg}`);
const die = (msg) => {
  console.error(`[persistent] ${msg}`);
  process.exit(1);
};

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(RUN_DIR, { recursive: true });

// --- stop ---
if (process.argv.includes("stop")) {
  const pid = readPid();
  if (!pid) {
    log("not running (no PID file)");
    process.exit(0);
  }
  if (isAlive(pid)) {
    try {
      if (IS_WIN) {
        // Kill the whole tree (dev-app + API + Vite). /T walks children, /F forces.
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        log(`terminated process tree of PID ${pid}`);
      } else {
        // SIGTERM lets dev-app.mjs shut down its API/Vite children cleanly.
        process.kill(pid, "SIGTERM");
        log(`sent SIGTERM to ${pid}`);
      }
    } catch (e) {
      die(`could not stop ${pid}: ${e.message}`);
    }
  } else {
    log(`stale PID ${pid} (not running); removing PID file`);
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  log("stopped");
  process.exit(0);
}

// --- status ---
if (process.argv.includes("status")) {
  const pid = readPid();
  if (!pid) {
    log("not running (no PID file)");
    process.exit(0);
  }
  if (isAlive(pid)) {
    log(`running (PID ${pid}); logs: ${LOG_DIR}`);
    process.exit(0);
  }
  log(`stale PID ${pid}; process is not running`);
  process.exit(0);
}

// --- start ---
const existing = readPid();
if (existing && isAlive(existing)) {
  log(`already running (PID ${existing}); use npm run stop:persistent to restart`);
  process.exit(0);
}
if (existing) {
  log(`stale PID ${existing} found; starting fresh`);
  unlinkSync(PID_FILE);
}
if (!existsSync(VITE_BIN)) {
  die("vite not found. Run `npm install` first.");
}

let childPid = null;

if (IS_WIN) {
  // Launch via Start-Process so the whole tree gets its own job/console and is
  // never married to the invoking terminal (no Ctrl-C propagation). Redirect
  // output to separate out/err log files and grab the new process PID from the
  // immediate "-PassThru ... Write-Output" line.
  //
  // NOTE: PowerShell with Start-Process -Redirect... keeps its pipe handles open
  // until the spawned process exits, so powershell.exe itself stays alive (in
  // the background) after we return. We therefore read the PID async from the
  // first stdout line and exit immediately rather than blocking on it.
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const psScript =
    `$p = Start-Process -FilePath ${q(NODE)} -ArgumentList ${q(join(root, "scripts", "dev-app.mjs"))} ` +
    `-WorkingDirectory ${q(root)} -WindowStyle Hidden ` +
    `-RedirectStandardOutput ${q(OUT_FILE)} -RedirectStandardError ${q(ERR_FILE)} -PassThru; ` +
    `Write-Output $p.Id`;
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
    windowsHide: true,
  });
  let pidOut = "";
  const timer = setTimeout(() => ps.kill(), 15000);
  ps.stdout.on("data", (d) => {
    if (!pidOut) pidOut += d.toString("utf8");
  });
  ps.on("error", (e) => die(`failed to spawn powershell: ${e.message}`));
  ps.on("close", () => clearTimeout(timer));
  // Wait (bounded) for the PID line, then finalize. We must not wait for the
  // powershell process to fully exit (it lingers on the redirect pipes).
  await new Promise((resolve) => {
    const tries = 100; // 100 * 100ms = 10s max
    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      if (/^\s*\d+\s*$/.test(pidOut) || n >= tries) {
        clearInterval(iv);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
  });
  ps.unref();
  childPid = Number.parseInt(pidOut.trim(), 10);
} else {
  // POSIX: detached + stdio redirected to the log file + unref.
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(
    NODE,
    [join(root, "scripts", "dev-app.mjs")],
    { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", logFd, logFd] }
  );
  closeSync(logFd);
  child.unref();
  childPid = child.pid ?? null;
}

if (childPid && Number.isFinite(childPid)) {
  writeFileSync(PID_FILE, String(childPid), "utf8");
  log(`started detached app (PID ${childPid})`);
  log(`  API  -> http://localhost:8787`);
  log(`  Vite -> http://localhost:5173`);
  log(`  logs -> ${LOG_DIR}`);
  log("give it a few seconds to bind, then: npm run status:persistent");
} else {
  die("failed to spawn the app process");
}