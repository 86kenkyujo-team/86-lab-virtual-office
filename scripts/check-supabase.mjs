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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const missing = [
  ["SUPABASE_URL", supabaseUrl],
  ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceKey]
].filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

async function request(route, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${route}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseServiceKey,
      authorization: `Bearer ${supabaseServiceKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${route} failed with ${response.status}: ${detail}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
  await request("rpc/update_presence_status", {
    method: "POST",
    body: {
      p_user_id: "taniguchi-kyoshiro",
      p_status: "active"
    }
  });
  console.log("ok: write RPC");
} else {
  console.log("Skipped write RPC. Run with --write after confirming test data can be touched.");
}

console.log("Supabase persistence check passed.");
