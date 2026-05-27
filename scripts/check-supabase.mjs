import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (process.env[key]) continue;
      process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  } catch {
    // Local env files are optional.
  }
}

await loadEnvFile(path.join(process.cwd(), ".env"));
await loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServerKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const missing = [
  ["SUPABASE_URL", supabaseUrl],
  ["SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", supabaseServerKey]
].filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

async function request(route, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${route}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseServerKey,
      authorization: `Bearer ${supabaseServerKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${text}`);
  }

  return body;
}

async function countRows(route) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${route}`, {
    method: "GET",
    headers: {
      apikey: supabaseServerKey,
      authorization: `Bearer ${supabaseServerKey}`,
      "content-type": "application/json",
      prefer: "count=exact",
      range: "0-0"
    }
  });

  const detail = await response.text();
  if (!response.ok) {
    throw new Error(`${route} count failed with ${response.status}: ${detail}`);
  }

  const contentRange = response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/").at(-1));
  if (!Number.isFinite(total)) {
    throw new Error(`${route} count returned an unexpected content-range: ${contentRange}`);
  }
  return total;
}

async function expectFailure(route, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${route}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseServerKey,
      authorization: `Bearer ${supabaseServerKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const detail = await response.text();
  if (response.ok) {
    throw new Error(`${route} unexpectedly succeeded`);
  }
  return { status: response.status, detail };
}

const checks = [
  ["office seed", "offices?select=id,name,qr_token&limit=1", (rows) => rows.length >= 1],
  ["profiles seed", "profiles?select=id,display_name,is_active&is_active=eq.true", (rows) => rows.length >= 6],
  ["current presence", "current_presence?select=user_id,work_mode,status,entry_method&limit=6", Array.isArray],
  ["attendance sessions", "attendance_sessions?select=id,user_id,entry_method,checked_in_at&order=checked_in_at.desc&limit=1", Array.isArray],
  ["presence events", "presence_events?select=id,user_id,event_type,created_at&order=created_at.desc&limit=1", Array.isArray]
];

for (const [label, route, validate] of checks) {
  const result = await request(route);
  if (!validate(result)) {
    throw new Error(`${label} check returned an unexpected result`);
  }
  console.log(`ok: ${label}`);
}

if (process.argv.includes("--write")) {
  const writeUserId = process.env.SUPABASE_CHECK_USER_ID || "taniguchi-kyoshiro";
  const offices = await request("offices?select=id,name,qr_token&limit=1");
  const qrToken = offices[0]?.qr_token;
  if (!qrToken) {
    throw new Error("office QR token is missing");
  }

  const invalidQr = await expectFailure("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: writeUserId,
      p_work_mode: "office",
      p_status: "active",
      p_entry_method: "office_qr",
      p_qr_token: "invalid-token"
    }
  });
  if (!invalidQr.detail.includes("invalid office qr token")) {
    throw new Error(`invalid QR check failed for an unexpected reason: ${invalidQr.detail}`);
  }
  console.log("ok: invalid office QR rejected");

  await request("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: writeUserId,
      p_work_mode: "office",
      p_status: "active",
      p_entry_method: "office_qr",
      p_qr_token: qrToken
    }
  });
  let current = await request(`current_presence?select=user_id,work_mode,status,entry_method&user_id=eq.${encodeURIComponent(writeUserId)}&limit=1`);
  if (current[0]?.work_mode !== "office" || current[0]?.entry_method !== "office_qr") {
    throw new Error("office QR write check did not persist expected current_presence");
  }
  console.log("ok: office QR check-in RPC");

  await request("rpc/update_presence_status", {
    method: "POST",
    body: {
      p_user_id: writeUserId,
      p_status: "meeting"
    }
  });
  current = await request(`current_presence?select=user_id,work_mode,status,entry_method&user_id=eq.${encodeURIComponent(writeUserId)}&limit=1`);
  if (current[0]?.status !== "meeting") {
    throw new Error("status write check did not persist expected current_presence");
  }
  console.log("ok: status update RPC");

  const encodedWriteUserId = encodeURIComponent(writeUserId);
  const sessionCountBeforeReentry = await countRows(`attendance_sessions?select=id&user_id=eq.${encodedWriteUserId}`);
  const eventCountBeforeReentry = await countRows(`presence_events?select=id&user_id=eq.${encodedWriteUserId}`);
  const sameMode = await request("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: writeUserId,
      p_work_mode: "office",
      p_status: "active",
      p_entry_method: "office_qr",
      p_qr_token: qrToken
    }
  });
  if (!sameMode?.unchanged) {
    throw new Error("same-mode office check-in did not report unchanged");
  }
  current = await request(`current_presence?select=user_id,work_mode,status,entry_method&user_id=eq.${encodedWriteUserId}&limit=1`);
  if (current[0]?.status !== "meeting") {
    throw new Error("same-mode office check-in should preserve the current status");
  }
  const sessionCountAfterReentry = await countRows(`attendance_sessions?select=id&user_id=eq.${encodedWriteUserId}`);
  const eventCountAfterReentry = await countRows(`presence_events?select=id&user_id=eq.${encodedWriteUserId}`);
  if (sessionCountAfterReentry !== sessionCountBeforeReentry || eventCountAfterReentry !== eventCountBeforeReentry) {
    throw new Error("same-mode office check-in should not add sessions or events");
  }
  console.log("ok: same-mode check-in RPC is idempotent");

  await request("rpc/checkout_presence", {
    method: "POST",
    body: { p_user_id: writeUserId }
  });
  current = await request(`current_presence?select=user_id&user_id=eq.${encodeURIComponent(writeUserId)}&limit=1`);
  if (current.length !== 0) {
    throw new Error("checkout write check did not clear current_presence");
  }
  console.log("ok: checkout RPC");

  await request("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: writeUserId,
      p_work_mode: "remote",
      p_status: "active",
      p_entry_method: "remote_manual",
      p_qr_token: null
    }
  });
  current = await request(`current_presence?select=user_id,work_mode,status,entry_method&user_id=eq.${encodeURIComponent(writeUserId)}&limit=1`);
  if (current[0]?.work_mode !== "remote" || current[0]?.entry_method !== "remote_manual") {
    throw new Error("remote write check did not restore expected current_presence");
  }
  console.log("ok: remote check-in RPC");
} else {
  console.log("Skipped write RPC. Run with --write after confirming test data can be touched.");
}

console.log("Supabase persistence check passed.");
