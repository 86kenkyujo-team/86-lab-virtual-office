import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

const dbPath = path.resolve(process.env.PRESENCE_DB_PATH || path.join(process.cwd(), "data", "presence-db.json"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const forceJsonStore = process.env.PRESENCE_DB_FORCE_JSON === "1";
const dataSource = !forceJsonStore && supabaseUrl && supabaseServiceKey ? "supabase" : "json";
const isVercel = Boolean(process.env.VERCEL);
const missingSupabaseEnv = [
  ["SUPABASE_URL", supabaseUrl],
  ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceKey]
].filter(([, value]) => !value).map(([key]) => key);
const fallbackOffice = {
  id: "86-lab-osaka",
  name: "86研究所",
  location: "大阪オフィス 6F",
  qrToken: "86-lab-office-main"
};

function localDataSource() {
  return isVercel ? "vercel-json" : "json";
}

function sourceMetadata(source) {
  const isSupabase = source === "supabase";
  const isLocalJson = source === "json";
  const writable = isSupabase || isLocalJson;

  return {
    dataSource: source,
    persistence: {
      persistent: writable,
      writable,
      requiresSupabase: source === "vercel-json",
      missingEnv: source === "vercel-json" ? missingSupabaseEnv : [],
      message: source === "vercel-json"
        ? "VercelではSupabase環境変数が必要です。未設定のため更新は保存されません。"
        : null
    }
  };
}

function nowIso() {
  return new Date().toISOString();
}

function withDataSource(db, source) {
  return { ...db, ...sourceMetadata(source) };
}

function validateOfficeQrToken(expectedToken, providedToken) {
  if (!providedToken) {
    return {
      ok: false,
      error: "qr_token_required",
      message: "QR入室には有効なオフィスQRが必要です。"
    };
  }

  if (providedToken !== expectedToken) {
    return {
      ok: false,
      error: "invalid_qr_token",
      message: "このQRは86研究所の入室QRとして認証できません。"
    };
  }

  return { ok: true };
}

function mapOffice(row) {
  if (!row) return fallbackOffice;
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    qrToken: row.qr_token
  };
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
  return withDataSource(db, localDataSource());
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
  return members.slice().sort((a, b) => {
    const aIndex = memberOrder.indexOf(a.id);
    const bIndex = memberOrder.indexOf(b.id);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return safeA - safeB;
  });
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

  const office = mapOffice(offices[0]);

  return withDataSource({
    office,
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
  const source = dataSource === "supabase" ? "supabase" : localDataSource();
  return {
    ok: true,
    ...sourceMetadata(source),
    supabaseConfigured: dataSource === "supabase",
    vercel: isVercel
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
  if (workMode === "office") {
    const offices = await supabaseRequest("offices?select=id,name,location,qr_token&limit=1");
    const qrCheck = validateOfficeQrToken(mapOffice(offices[0]).qrToken, payload.qrToken);
    if (!qrCheck.ok) return { ...qrCheck, state: await readSupabaseState() };
  }

  await supabaseRequest("rpc/check_in_presence", {
    method: "POST",
    body: {
      p_user_id: payload.userId,
      p_work_mode: workMode,
      p_status: payload.status || "active",
      p_entry_method: payload.entryMethod || (workMode === "office" ? "office_qr" : "remote_manual"),
      p_qr_token: workMode === "office" ? payload.qrToken : null
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
    return { ok: true, state: withDataSource(db, localDataSource()) };
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
    return { ok: true, state: withDataSource(db, localDataSource()) };
  }

  const workMode = payload.workMode === "office" ? "office" : "remote";
  const status = payload.status || "active";
  const entryMethod = payload.entryMethod || (workMode === "office" ? "office_qr" : "remote_manual");
  if (workMode === "office") {
    const qrCheck = validateOfficeQrToken(db.office.qrToken, payload.qrToken);
    if (!qrCheck.ok) return { ...qrCheck, state: withDataSource(db, localDataSource()) };
  }

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
  return { ok: true, state: withDataSource(db, localDataSource()) };
}

export async function updatePresence(payload) {
  if (dataSource === "supabase") {
    return updateSupabasePresence(payload);
  }

  if (isVercel) {
    return {
      ok: false,
      error: "persistent_database_required",
      message: "本番環境ではSupabase環境変数が必要です。SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
      state: await readLocalState()
    };
  }

  return updateJsonPresence(payload);
}
