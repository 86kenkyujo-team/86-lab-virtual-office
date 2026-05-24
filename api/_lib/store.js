import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dbPath = path.join(process.cwd(), "data", "presence-db.json");
const memberOrder = [
  "hachiro-motoki",
  "marubayashi-yuto",
  "taniguchi-kyoshiro",
  "miyabe-keishi",
  "kashima-sakuto",
  "kajita-koki"
];

let memoryDb = null;

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
    // Environment files are optional.
  }
}

await loadEnvFile(path.join(process.cwd(), ".env"));
await loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const dataSource = supabaseUrl && supabaseServiceKey ? "supabase" : "json";

function nowIso() {
  return new Date().toISOString();
}

function withDataSource(db, source) {
  return { ...db, dataSource: source };
}

async function readDb() {
  if (memoryDb) return structuredClone(memoryDb);
  const raw = await readFile(dbPath, "utf8");
  memoryDb = JSON.parse(raw);
  return structuredClone(memoryDb);
}

async function writeDb(db) {
  memoryDb = structuredClone(db);
  if (!process.env.VERCEL) {
    await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }
}

async function readLocalState() {
  const db = await readDb();
  return withDataSource(db, process.env.VERCEL ? "vercel-json" : "json");
}

async function supabaseRequest(route, options = {}) {
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
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function sortMembers(members) {
  return members.slice().sort((a, b) => memberOrder.indexOf(a.id) - memberOrder.indexOf(b.id));
}

function mapProfile(row) {
  return {
    id: row.id,
    name: row.display_name,
    role: row.role,
    team: row.team,
    avatarUrl: row.avatar_url,
    seatLabel: row.seat_label
  };
}

function mapPresence(row) {
  return {
    userId: row.user_id,
    workMode: row.work_mode,
    status: row.status,
    entryMethod: row.entry_method,
    since: row.since,
    lastSeenAt: row.last_seen_at,
    seatLabel: row.seat_label,
    ...(row.position_x !== null && row.position_y !== null
      ? { position: { x: Number(row.position_x), y: Number(row.position_y) } }
      : {})
  };
}

function mapSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    workMode: row.work_mode,
    entryMethod: row.entry_method,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    status: row.status,
    memo: row.memo,
    checkoutReason: row.checkout_reason
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.event_type,
    workMode: row.work_mode,
    createdAt: row.created_at,
    message: row.message
  };
}

async function readSupabaseState() {
  const [offices, profiles, presences, sessions, events] = await Promise.all([
    supabaseRequest("offices?select=*&limit=1"),
    supabaseRequest("profiles?select=*&is_active=eq.true"),
    supabaseRequest("current_presence?select=*"),
    supabaseRequest("attendance_sessions?select=*&order=checked_in_at.desc&limit=50"),
    supabaseRequest("presence_events?select=*&order=created_at.desc&limit=50")
  ]);

  const office = offices[0] || {
    id: "86-lab-osaka",
    name: "86研究所",
    location: "大阪オフィス 6F",
    qr_token: "86-lab-office-main"
  };

  return withDataSource({
    office: {
      id: office.id,
      name: office.name,
      location: office.location,
      qrToken: office.qr_token
    },
    members: sortMembers(profiles.map(mapProfile)),
    currentPresence: presences.map(mapPresence),
    sessions: sessions.map(mapSession),
    events: events.map(mapEvent)
  }, "supabase");
}

export async function readState() {
  return dataSource === "supabase" ? readSupabaseState() : readLocalState();
}

export function getHealth() {
  return {
    ok: true,
    dataSource,
    supabaseConfigured: dataSource === "supabase"
  };
}

function createEvent(user, workMode, type) {
  const modeLabel = workMode === "office" ? "オフィス" : "リモート";
  const actionLabel = {
    check_in: "入りました",
    remote_in: "入りました",
    checkout: "退室しました",
    away: "離席中になりました",
    meeting: "会議中になりました",
    active: "作業中になりました"
  }[type] || "更新しました";

  return {
    id: `event-${Date.now()}`,
    userId: user.id,
    type,
    workMode,
    createdAt: nowIso(),
    message: `${user.name}さんが${modeLabel}で${actionLabel}`
  };
}

function closeActiveSessions(db, userId, checkedOutAt, reason = "manual_checkout") {
  db.sessions = db.sessions.map((session) => {
    if (session.userId === userId && session.checkedOutAt === null) {
      return {
        ...session,
        checkedOutAt,
        status: "checked_out",
        checkoutReason: reason
      };
    }
    return session;
  });
}

async function updateSupabasePresence(payload) {
  if (payload.action === "checkout") {
    await supabaseRequest("rpc/checkout_presence", {
      method: "POST",
      body: { p_user_id: payload.userId }
    });
    return { ok: true, state: await readSupabaseState() };
  }

  if (payload.action === "status") {
    await supabaseRequest("rpc/update_presence_status", {
      method: "POST",
      body: {
        p_user_id: payload.userId,
        p_status: payload.status || "active"
      }
    });
    return { ok: true, state: await readSupabaseState() };
  }

  const workMode = payload.workMode === "office" ? "office" : "remote";
  await supabaseRequest("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: payload.userId,
      p_work_mode: workMode,
      p_status: payload.status || "active",
      p_entry_method: payload.entryMethod || (workMode === "office" ? "office_qr" : "remote_manual")
    }
  });
  return { ok: true, state: await readSupabaseState() };
}

async function updateJsonPresence(payload) {
  const db = await readDb();
  const user = db.members.find((member) => member.id === payload.userId);

  if (!user) {
    return { ok: false, error: "member_not_found" };
  }

  const checkedAt = nowIso();

  if (payload.action === "checkout") {
    const existing = db.currentPresence.find((presence) => presence.userId === user.id);
    closeActiveSessions(db, user.id, checkedAt);
    db.currentPresence = db.currentPresence.filter((presence) => presence.userId !== user.id);
    db.events.unshift(createEvent(user, existing?.workMode || payload.workMode || "office", "checkout"));
    await writeDb(db);
    return { ok: true, state: withDataSource(db, process.env.VERCEL ? "vercel-json" : "json") };
  }

  if (payload.action === "status") {
    const existing = db.currentPresence.find((presence) => presence.userId === user.id);

    if (!existing) {
      return { ok: false, error: "presence_not_found" };
    }

    const nextStatus = payload.status || "active";
    db.currentPresence = db.currentPresence.map((presence) => {
      if (presence.userId !== user.id) return presence;
      return {
        ...presence,
        status: nextStatus,
        lastSeenAt: checkedAt
      };
    });
    db.sessions = db.sessions.map((session) => {
      if (session.userId === user.id && session.checkedOutAt === null) {
        return {
          ...session,
          status: nextStatus
        };
      }
      return session;
    });
    db.events.unshift(createEvent(user, existing.workMode, nextStatus));
    await writeDb(db);
    return { ok: true, state: withDataSource(db, process.env.VERCEL ? "vercel-json" : "json") };
  }

  const workMode = payload.workMode === "office" ? "office" : "remote";
  const status = payload.status || "active";
  const entryMethod = payload.entryMethod || (workMode === "office" ? "office_qr" : "remote_manual");
  const existing = db.currentPresence.find((presence) => presence.userId === user.id);
  const position = workMode === "office"
    ? existing?.position || { x: 47, y: 61 }
    : undefined;

  closeActiveSessions(db, user.id, checkedAt, "mode_switch");

  db.currentPresence = [
    ...db.currentPresence.filter((presence) => presence.userId !== user.id),
    {
      userId: user.id,
      workMode,
      status,
      entryMethod,
      since: checkedAt,
      lastSeenAt: checkedAt,
      seatLabel: workMode === "office" ? "デスク C-1" : "リモートブース 1",
      ...(position ? { position } : {})
    }
  ];

  db.sessions.unshift({
    id: `session-${Date.now()}`,
    userId: user.id,
    workMode,
    entryMethod,
    checkedInAt: checkedAt,
    checkedOutAt: null,
    status,
    memo: workMode === "office" ? "QR入室" : "リモート入室"
  });

  db.events.unshift(createEvent(user, workMode, workMode === "office" ? "check_in" : "remote_in"));
  await writeDb(db);
  return { ok: true, state: withDataSource(db, process.env.VERCEL ? "vercel-json" : "json") };
}

export async function updatePresence(payload) {
  return dataSource === "supabase" ? updateSupabasePresence(payload) : updateJsonPresence(payload);
}
