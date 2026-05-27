import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "86-lab-office-"));
const tempDb = path.join(tempDir, "presence-db.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await cp(path.join(root, "data", "presence-db.json"), tempDb);
  process.env.PRESENCE_DB_PATH = tempDb;
  process.env.PRESENCE_DB_FORCE_JSON = "1";
  delete process.env.VERCEL;

  const store = await import(`../api/_lib/store.js?smoke=${Date.now()}`);

  let state = await store.readState();
  assert(state.dataSource === "json", "expected local JSON data source");
  assert(state.members.length === 6, "expected six seed members");

  let result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    action: "checkout"
  });
  assert(result.ok, "checkout should succeed");
  assert(!result.state.currentPresence.some((presence) => presence.userId === "taniguchi-kyoshiro"), "checkout should remove current presence");
  assert(result.state.sessions.some((session) => session.userId === "taniguchi-kyoshiro" && session.status === "checked_out"), "checkout should close active session");

  result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    workMode: "remote",
    status: "active",
    entryMethod: "remote_manual"
  });
  assert(result.ok, "remote check-in should succeed");
  state = result.state;
  let presence = state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.workMode === "remote", "remote check-in should set remote work mode");
  assert(presence?.entryMethod === "remote_manual", "remote check-in should preserve entry method");

  result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    workMode: "office",
    status: "active",
    entryMethod: "office_qr",
    qrToken: "wrong-token"
  });
  assert(!result.ok && result.error === "invalid_qr_token", "office QR check-in should reject an invalid token");

  result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    workMode: "office",
    status: "active",
    entryMethod: "office_qr",
    qrToken: state.office.qrToken
  });
  assert(result.ok, "office QR check-in should succeed");
  state = result.state;
  presence = state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.workMode === "office", "office check-in should set office work mode");
  assert(presence?.entryMethod === "office_qr", "office check-in should preserve QR entry method");
  assert(Boolean(presence?.position), "office check-in should assign a map position");

  result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    action: "status",
    status: "away"
  });
  assert(result.ok, "status update should succeed");
  presence = result.state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.status === "away", "status update should be reflected in current presence");

  const sessionCountBeforeReentry = result.state.sessions.length;
  const eventCountBeforeReentry = result.state.events.length;
  result = await store.updatePresence({
    userId: "taniguchi-kyoshiro",
    workMode: "office",
    status: "active",
    entryMethod: "office_qr",
    qrToken: state.office.qrToken
  });
  assert(result.ok && result.unchanged, "same-mode check-in should be idempotent");
  presence = result.state.currentPresence.find((item) => item.userId === "taniguchi-kyoshiro");
  assert(presence?.status === "away", "same-mode check-in should preserve current status");
  assert(result.state.sessions.length === sessionCountBeforeReentry, "same-mode check-in should not add a session");
  assert(result.state.events.length === eventCountBeforeReentry, "same-mode check-in should not add an event");

  process.env.VERCEL = "1";
  const vercelStore = await import(`../api/_lib/store.js?vercel=${Date.now()}`);
  const blocked = await vercelStore.updatePresence({
    userId: "taniguchi-kyoshiro",
    workMode: "office",
    entryMethod: "office_qr",
    qrToken: state.office.qrToken
  });
  assert(!blocked.ok, "Vercel JSON mode should reject writes without Supabase");
  assert(blocked.error === "persistent_database_required", "Vercel JSON mode should report persistent database requirement");
  assert(blocked.state?.persistence?.writable === false, "Vercel JSON mode should be marked read-only");

  console.log("Smoke test passed: JSON presence flow is working.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
