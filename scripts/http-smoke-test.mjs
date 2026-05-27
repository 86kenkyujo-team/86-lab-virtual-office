import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "86-lab-office-http-"));
const tempDb = path.join(tempDir, "presence-db.json");
const port = 3300 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

async function waitForServer(serverProcess) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) break;
    try {
      const { response, body } = await readJson("/api/health");
      if (response.ok && body.ok) return body;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`server did not become ready${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopServer(serverProcess) {
  if (serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  const timeout = delay(2000).then(() => {
    if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
  });
  await Promise.race([once(serverProcess, "close"), timeout]);
}

await cp(path.join(root, "data", "presence-db.json"), tempDb);

const env = {
  ...process.env,
  PORT: String(port),
  PRESENCE_DB_PATH: tempDb,
  PRESENCE_DB_FORCE_JSON: "1"
};
delete env.VERCEL;

const serverProcess = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
serverProcess.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const health = await waitForServer(serverProcess);
  assert(health.dataSource === "json", "health should report local JSON data source");
  assert(health.persistence?.writable === true, "local JSON data source should be writable");

  let result = await readJson("/api/state");
  assert(result.response.ok, "state endpoint should respond successfully");
  const state = result.body;
  assert(state.members.length === 6, "state endpoint should return six seed members");
  assert(state.office.qrToken, "state endpoint should include office QR token");

  result = await readJson("/api/presence", {
    method: "POST",
    body: JSON.stringify({
      userId: "taniguchi-kyoshiro",
      workMode: "office",
      status: "active",
      entryMethod: "office_qr",
      qrToken: "wrong-token"
    })
  });
  assert(result.response.status === 400, "invalid QR should return HTTP 400");
  assert(result.body.error === "invalid_qr_token", "invalid QR should return invalid_qr_token");

  result = await readJson("/api/presence", {
    method: "POST",
    body: JSON.stringify({
      userId: "taniguchi-kyoshiro",
      workMode: "office",
      status: "active",
      entryMethod: "office_qr",
      qrToken: state.office.qrToken
    })
  });
  assert(result.response.ok && result.body.ok, "office QR check-in should succeed");
  let presence = result.body.state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.workMode === "office", "office QR check-in should set office mode");
  assert(presence?.entryMethod === "office_qr", "office QR check-in should preserve entry method");

  result = await readJson("/api/presence", {
    method: "POST",
    body: JSON.stringify({
      userId: "taniguchi-kyoshiro",
      action: "status",
      status: "meeting"
    })
  });
  assert(result.response.ok && result.body.ok, "status update should succeed");
  presence = result.body.state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.status === "meeting", "status update should be visible through HTTP API");

  const sessionCountBeforeReentry = result.body.state.sessions.length;
  const eventCountBeforeReentry = result.body.state.events.length;
  result = await readJson("/api/presence", {
    method: "POST",
    body: JSON.stringify({
      userId: "taniguchi-kyoshiro",
      workMode: "office",
      status: "active",
      entryMethod: "office_qr",
      qrToken: state.office.qrToken
    })
  });
  assert(result.response.ok && result.body.ok && result.body.unchanged, "same-mode HTTP check-in should be idempotent");
  presence = result.body.state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.status === "meeting", "same-mode HTTP check-in should preserve current status");
  assert(result.body.state.sessions.length === sessionCountBeforeReentry, "same-mode HTTP check-in should not add a session");
  assert(result.body.state.events.length === eventCountBeforeReentry, "same-mode HTTP check-in should not add an event");

  result = await readJson("/api/presence", {
    method: "POST",
    body: JSON.stringify({
      userId: "taniguchi-kyoshiro",
      action: "checkout"
    })
  });
  assert(result.response.ok && result.body.ok, "checkout should succeed");
  assert(!result.body.state.currentPresence.some((item) => item.userId === "taniguchi-kyoshiro"), "checkout should clear current presence");

  console.log("HTTP smoke test passed: local server API is usable.");
} catch (error) {
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  throw error;
} finally {
  await stopServer(serverProcess);
  await rm(tempDir, { recursive: true, force: true });
}
