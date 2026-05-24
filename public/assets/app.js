let selectedUserId = localStorage.getItem("selectedMemberId") || "taniguchi-kyoshiro";

const labels = {
  workMode: {
    office: "オフィス",
    remote: "リモート"
  },
  status: {
    active: "在籍中",
    away: "離席中",
    meeting: "会議中",
    checked_out: "退室済み"
  },
  entryMethod: {
    office_qr: "QR",
    remote_manual: "手動",
    admin_edit: "管理",
    auto_timeout: "自動"
  }
};

const state = {
  db: null,
  scanToken: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toDate(value) {
  return value ? new Date(value) : null;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function elapsedText(value) {
  const date = toDate(value);
  if (!date) return "--";
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 1) return `${rest}分`;
  return `${hours}時間${rest}分`;
}

function memberById(id) {
  return state.db.members.find((member) => member.id === id);
}

function selectedMember() {
  return memberById(selectedUserId) || state.db.members[0];
}

function presenceByUser(id) {
  return state.db.currentPresence.find((presence) => presence.userId === id);
}

function selectedPresence() {
  return presenceByUser(selectedUserId);
}

function activePresence() {
  return state.db.currentPresence.filter((presence) => presence.status !== "checked_out");
}

function statusClass(presence) {
  if (presence.status === "checked_out" || presence.status === "auto_checked_out") return "status-pill--checked-out";
  if (presence.status === "away") return "status-pill--away";
  if (presence.status === "meeting") return "status-pill--meeting";
  return presence.workMode === "office" ? "status-pill--office" : "status-pill--remote";
}

function createStatusPill(presence) {
  return `<span class="status-pill ${statusClass(presence)}">${labels.workMode[presence.workMode]}・${labels.status[presence.status]}</span>`;
}

function pinMotionStyle(presence, index) {
  const duration = {
    active: "3.2s",
    away: "5.4s",
    meeting: "2.4s"
  }[presence.status] || "3.6s";

  return [
    `--x:${presence.position?.x || 50}%`,
    `--y:${presence.position?.y || 50}%`,
    `--delay:${(-0.45 * index).toFixed(2)}s`,
    `--duration:${duration}`
  ].join(";");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

async function loadState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "状態を取得できませんでした");
  }
  state.db = result;
}

function scanTokenFromPath() {
  const prefix = "/scan/";
  if (!window.location.pathname.startsWith(prefix)) return null;
  const token = window.location.pathname.slice(prefix.length).split("/")[0];
  return token ? decodeURIComponent(token) : null;
}

async function updatePresence(payload, message) {
  if (!state.db) {
    showToast("読み込み中です");
    return;
  }

  if (state.db.persistence?.writable === false) {
    showToast(state.db.persistence.message || "本番DB未設定のため更新できません");
    return;
  }

  const response = await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: selectedUserId, ...payload })
  });
  const result = await response.json();
  if (!result.ok) {
    showToast(result.message || "更新できませんでした");
    if (result.state) {
      state.db = result.state;
      render();
    }
    return;
  }
  state.db = result.state;
  render();
  showToast(message);
}

function setSelectedUser(userId) {
  selectedUserId = userId;
  localStorage.setItem("selectedMemberId", selectedUserId);
  render();
}

function renderToday() {
  const now = new Date();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(now);
}

function renderSummary() {
  const presences = activePresence();
  const officeCount = presences.filter((presence) => presence.workMode === "office").length;
  const remoteCount = presences.filter((presence) => presence.workMode === "remote").length;
  const awayCount = presences.filter((presence) => presence.status === "away" || presence.status === "meeting").length;
  const total = state.db.members.length;
  const firstCheckIn = presences
    .map((presence) => presence.since)
    .sort()[0];

  $("#summaryGrid").innerHTML = [
    { label: "オフィス", value: `${officeCount}人`, note: "QR入室済み" },
    { label: "リモート", value: `${remoteCount}人`, note: "アプリから入室" },
    { label: "在籍合計", value: `${presences.length}/${total}`, note: "ライブ更新" },
    { label: "最初の入室", value: formatTime(firstCheckIn), note: "表示中データの開始時刻" }
  ].map((item) => `
    <article class="summary-card">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <em>${item.note}${awayCount && item.label === "在籍合計" ? `・離席/会議 ${awayCount}` : ""}</em>
    </article>
  `).join("");

  $("#miniStatus").textContent = `オフィス ${officeCount}人 / リモート ${remoteCount}人`;
  $("#presenceCount").textContent = `${presences.length} / ${total}人`;
}

function renderMemberSelector() {
  const options = state.db.members.map((member) => `
    <option value="${member.id}" ${member.id === selectedUserId ? "selected" : ""}>${member.name}</option>
  `).join("");
  $("#memberSelect").innerHTML = options;
  $("#mobileMemberSelect").innerHTML = options;
}

function renderOperator() {
  const member = selectedMember();
  const presence = selectedPresence();
  const statusText = presence
    ? `${labels.workMode[presence.workMode]}・${labels.status[presence.status]}・${formatTime(presence.since)}〜`
    : "未入室";

  $("#currentUserAvatar").src = member.avatarUrl;
  $("#currentUserAvatar").alt = member.name;
  $("#operatorAvatar").src = member.avatarUrl;
  $("#operatorAvatar").alt = member.name;
  $("#operatorName").textContent = member.name;
  $("#operatorStatus").textContent = statusText;
  $("#qrUserAvatar").src = member.avatarUrl;
  $("#qrUserAvatar").alt = member.name;
  $("#qrUserName").textContent = member.name;
  renderQrState();

  $$("[data-status-button]").forEach((button) => {
    button.classList.toggle("is-active", presence?.status === button.dataset.statusButton);
    button.disabled = !presence;
    button.style.opacity = presence ? "1" : "0.48";
  });
}

function renderQrState() {
  if (!state.db) return;

  const officeToken = state.db.office.qrToken;
  const activeToken = state.scanToken || officeToken;
  const isInvalidScan = Boolean(state.scanToken && state.scanToken !== officeToken);
  const status = $("#qrStatus");
  const button = $("#dialogOfficeButton");

  $("#qrUrl").textContent = `/scan/${officeToken}`;
  status.textContent = isInvalidScan
    ? "このQRトークンは認証できません"
    : state.scanToken
      ? "QRトークン認証済み"
      : "このQRでオフィス入室を記録します";
  status.classList.toggle("is-error", isInvalidScan);
  button.disabled = isInvalidScan || state.db.persistence?.writable === false;
  button.style.opacity = button.disabled ? "0.48" : "1";
  button.dataset.qrToken = activeToken;
}

function renderOfficePins() {
  const officePresences = activePresence().filter((presence) => presence.workMode === "office");
  $("#officePins").innerHTML = officePresences.map((presence, index) => {
    const member = memberById(presence.userId);
    const status = presence.status || "active";
    return `
      <div class="pin pin--${status}" style="${pinMotionStyle(presence, index)}">
        <span class="pin__person">
          <span class="pin__shadow" aria-hidden="true"></span>
          <img class="pin__avatar" src="${member.avatarUrl}" alt="${member.name}">
          <span class="pin__status-dot" aria-hidden="true"></span>
        </span>
        <div class="pin__label">
          ${member.name}
          <span>${labels.status[presence.status]} ${formatTime(presence.since)}〜</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderPresenceList() {
  const rows = activePresence()
    .slice()
    .sort((a, b) => a.workMode.localeCompare(b.workMode) || a.since.localeCompare(b.since));

  $("#presenceList").innerHTML = rows.map((presence) => {
    const member = memberById(presence.userId);
    return `
      <article class="presence-row">
        <img class="member-avatar" src="${member.avatarUrl}" alt="${member.name}">
        <div>
          <strong>${member.name}</strong>
          <small>${presence.seatLabel}・${formatTime(presence.since)}〜・${elapsedText(presence.since)}</small>
        </div>
        ${createStatusPill(presence)}
      </article>
    `;
  }).join("");
}

function renderRemoteGrid() {
  const remotePresences = activePresence().filter((presence) => presence.workMode === "remote");
  $("#remoteGrid").innerHTML = remotePresences.map((presence) => {
    const member = memberById(presence.userId);
    return `
      <article class="remote-card">
        <img class="member-avatar" src="${member.avatarUrl}" alt="${member.name}">
        <div>
          <strong>${member.name}</strong>
          <small>${presence.seatLabel}・${labels.entryMethod[presence.entryMethod]}・${elapsedText(presence.since)}</small>
        </div>
        ${createStatusPill(presence)}
      </article>
    `;
  }).join("");
}

function renderTimeline() {
  $("#timeline").innerHTML = state.db.events.slice(0, 5).map((event) => `
    <article class="timeline-row">
      <time>${formatTime(event.createdAt)}</time>
      <div>
        <strong>${event.message}</strong>
        <small>${labels.workMode[event.workMode] || ""}</small>
      </div>
    </article>
  `).join("");
}

function renderHistoryRows(target, full = false) {
  const rows = state.db.sessions.slice(0, full ? 24 : 7);
  $(target).innerHTML = rows.map((session) => {
    const member = memberById(session.userId);
    const presence = session.checkedOutAt
      ? { ...session, status: "checked_out" }
      : presenceByUser(session.userId) || session;
    const cells = full
      ? `<td>${formatDate(session.checkedInAt)}</td>`
      : "";
    return `
      <tr>
        ${cells}
        <td>${member?.name || session.userId}</td>
        <td>${labels.workMode[session.workMode]}</td>
        <td>${formatTime(session.checkedInAt)}</td>
        <td>${formatTime(session.checkedOutAt)}</td>
        <td>${createStatusPill(presence)}</td>
        ${full ? `<td>${session.memo || ""}</td>` : ""}
      </tr>
    `;
  }).join("");
}

function renderAnalytics() {
  const values = [4, 5, 6, 4, 7, 6, activePresence().length];
  $("#barChart").innerHTML = values.map((value, index) => `
    <div class="bar">
      <span style="height:${Math.max(28, value * 18)}px"></span>
      <small>${index + 1}日前</small>
    </div>
  `).join("");

  const office = activePresence().filter((presence) => presence.workMode === "office").length;
  const remote = activePresence().filter((presence) => presence.workMode === "remote").length;
  const total = Math.max(1, office + remote);
  const officeRatio = Math.round((office / total) * 100);
  $(".donut").style.background = `conic-gradient(var(--office) 0 ${officeRatio}%, var(--remote) ${officeRatio}% 100%)`;
  $("#donutLabel").innerHTML = `オフィス ${office}<br>リモート ${remote}`;
}

function renderMembers() {
  $("#memberGrid").innerHTML = state.db.members.map((member) => {
    const presence = presenceByUser(member.id);
    return `
      <article class="member-card">
        <img class="member-avatar" src="${member.avatarUrl}" alt="${member.name}">
        <div>
          <strong>${member.name}</strong>
          <small>${member.team}・${member.role}</small>
          ${presence ? createStatusPill(presence) : `<span class="status-pill">退室済み</span>`}
        </div>
      </article>
    `;
  }).join("");
}

function renderCurrentUserActions() {
  const current = selectedPresence();
  const remoteButton = $("#remoteButton");
  const officeButton = $("#officeButton");
  const checkoutButton = $("#checkoutButton");

  if (current?.workMode === "remote") {
    remoteButton.textContent = "リモート中";
  } else {
    remoteButton.textContent = "リモートで入る";
  }

  officeButton.textContent = current?.workMode === "office" ? "オフィス入室中" : "QRでオフィス入室";
  checkoutButton.disabled = !current;
  checkoutButton.style.opacity = current ? "1" : "0.48";
}

function renderSettings() {
  const dataSourceLabels = {
    supabase: "Supabase Postgres",
    "vercel-json": "Vercel JSON Demo",
    json: "ローカルJSON DB"
  };
  const baseLabel = dataSourceLabels[state.db.dataSource] || "ローカルJSON DB";
  const label = state.db.persistence?.writable === false ? `${baseLabel}（読み取り専用）` : baseLabel;
  $("#dataSourceLabel").textContent = label;
}

function render() {
  if (!memberById(selectedUserId)) {
    selectedUserId = state.db.members[0]?.id;
  }
  renderToday();
  renderMemberSelector();
  renderOperator();
  renderSummary();
  renderOfficePins();
  renderPresenceList();
  renderRemoteGrid();
  renderTimeline();
  renderHistoryRows("#historyRows");
  renderHistoryRows("#historyRowsFull", true);
  renderAnalytics();
  renderMembers();
  renderCurrentUserActions();
  renderSettings();
}

function bindNavigation() {
  $$("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.viewButton;
      $$(".view").forEach((section) => section.classList.remove("is-visible"));
      $(`#${view}View`).classList.add("is-visible");
      $$("[data-view-button]").forEach((item) => item.classList.toggle("is-active", item.dataset.viewButton === view));
    });
  });
}

function bindActions() {
  $("#memberSelect").addEventListener("change", (event) => {
    setSelectedUser(event.target.value);
  });

  $("#mobileMemberSelect").addEventListener("change", (event) => {
    setSelectedUser(event.target.value);
  });

  $("#remoteButton").addEventListener("click", () => {
    updatePresence({
      workMode: "remote",
      status: "active",
      entryMethod: "remote_manual"
    }, "リモート勤務として入りました");
  });

  $("#officeButton").addEventListener("click", () => {
    renderQrState();
    $("#qrDialog").showModal();
  });

  $("#checkoutButton").addEventListener("click", () => {
    updatePresence({ action: "checkout" }, "退室しました");
  });

  $$("[data-status-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const status = button.dataset.statusButton;
      updatePresence({ action: "status", status }, `${labels.status[status]}に更新しました`);
    });
  });

  $("#dialogOfficeButton").addEventListener("click", () => {
    $("#qrDialog").close();
    updatePresence({
      workMode: "office",
      status: "active",
      entryMethod: "office_qr",
      qrToken: $("#dialogOfficeButton").dataset.qrToken
    }, "QRでオフィスに入りました");
  });

  $("#qrButton").addEventListener("click", () => {
    renderQrState();
    $("#qrDialog").showModal();
  });
  $("#closeQrButton").addEventListener("click", () => $("#qrDialog").close());
}

async function boot() {
  state.scanToken = scanTokenFromPath();
  bindNavigation();
  bindActions();
  await loadState();
  render();

  if (window.location.pathname.startsWith("/scan/")) {
    renderQrState();
    $("#qrDialog").showModal();
  }
}

boot().catch((error) => {
  console.error(error);
  showToast("初期化に失敗しました");
});
