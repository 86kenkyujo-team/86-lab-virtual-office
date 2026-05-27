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
  assets: null,
  scanToken: null,
  scanHandled: false,
  routeMode: "kiosk",
  screen: "kiosk"
};

const imageFallbacks = {
  brandIcon: "/assets/images/brand-icon.png",
  officeBackground: "/assets/images/office-room.png"
};
const refreshIntervalMs = 30000;
const completionDurationMs = 2400;
const boardIdleReturnMs = 18000;
let refreshTimer = null;
let completionTimer = null;
let kioskReturnTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const layoutMedia = window.matchMedia("(max-width: 860px)");
const htmlEntities = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

function imageMarkup(src, alt, className, fallbackSrc = imageFallbacks.brandIcon) {
  const safeSrc = src || fallbackSrc || imageFallbacks.brandIcon;
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  const fallbackAttr = fallbackSrc ? ` data-fallback-src="${escapeHtml(fallbackSrc)}"` : "";
  return `<img${classAttr} src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt)}"${fallbackAttr}>`;
}

function setImage(image, src, alt, fallbackSrc = imageFallbacks.brandIcon) {
  image.src = src || fallbackSrc || imageFallbacks.brandIcon;
  image.alt = alt;
  image.dataset.fallbackSrc = fallbackSrc || imageFallbacks.brandIcon;
  image.classList.remove("is-fallback-image", "is-missing-image");
}

function handleImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;

  const fallbackSrc = image.dataset.fallbackSrc;
  if (fallbackSrc && image.getAttribute("src") !== fallbackSrc) {
    image.classList.add("is-fallback-image");
    image.src = fallbackSrc;
    return;
  }

  image.classList.add("is-missing-image");
}

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

function currentLayoutKey() {
  return layoutMedia.matches ? "mobile" : "desktop";
}

function currentLayout() {
  const key = currentLayoutKey();
  return state.assets?.layouts?.[key] || state.assets?.layouts?.desktop || null;
}

function characterPlacement(presence, index) {
  const layout = currentLayout();
  const layoutPlacement = layout?.placements?.[presence.userId];
  const position = layoutPlacement || presence.position || { x: 50 + index * 4, y: 58 };
  return {
    x: position.x,
    y: position.y,
    z: position.z || position.y || 2,
    scale: position.scale || 1,
    spriteHeight: position.spriteHeight || layout?.spriteHeight || null,
    label: position.label || "right"
  };
}

function spriteMetaFor(userId) {
  return state.assets?.sprites?.[userId] || null;
}

function spriteUrlFor(presence) {
  const sprite = spriteMetaFor(presence.userId);
  if (!sprite) return null;
  return sprite.states?.[presence.status] || sprite.default || null;
}

function characterPositionStyle(presence, index) {
  const duration = {
    active: "3.2s",
    away: "5.4s",
    meeting: "2.4s"
  }[presence.status] || "3.6s";
  const placement = characterPlacement(presence, index);

  return [
    `--x:${placement.x}%`,
    `--y:${placement.y}%`,
    `--scale:${placement.scale}`,
    placement.spriteHeight ? `--sprite-display-height:${placement.spriteHeight}px` : "",
    placement.spriteHeight ? "--sprite-display-width:max-content" : "",
    placement.spriteHeight ? "--sprite-image-height:100%" : "",
    placement.spriteHeight ? "--sprite-image-width:auto" : "",
    `--z:${placement.z}`,
    `--delay:${(-0.45 * index).toFixed(2)}s`,
    `--duration:${duration}`
  ].filter(Boolean).join(";");
}

function characterPlacementClass(presence, index) {
  const placement = characterPlacement(presence, index);
  return placement.label === "left" ? "office-character--label-left" : "";
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

async function loadOfficeAssets() {
  try {
    const response = await fetch("/assets/office-assets.json", { cache: "no-store" });
    if (!response.ok) throw new Error("office assets not found");
    state.assets = await response.json();
  } catch {
    state.assets = null;
  }
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
    return result;
  }
  state.db = result.state;
  render();
  showToast(message);
  return result;
}

function setSelectedUser(userId, options = {}) {
  selectedUserId = userId;
  localStorage.setItem("selectedMemberId", selectedUserId);
  render();
  renderKioskScreen();
  if (options.message) showToast(options.message);
}

function routeModeFromPath() {
  if (window.location.pathname.startsWith("/view") || window.location.pathname.startsWith("/presence")) {
    return "viewer";
  }
  return "kiosk";
}

function kioskActionFor(userId) {
  const presence = presenceByUser(userId);
  if (!presence) {
    return {
      type: "checkin",
      label: "オフィス出勤する",
      status: "未出勤です。名前を確認して出勤を記録します。",
      message: "オフィス出勤を記録しました",
      modeClass: "mode-pill--office"
    };
  }
  if (presence.workMode === "office") {
    return {
      type: "checkout",
      label: "退勤する",
      status: `オフィス勤務中です。${formatTime(presence.since)}から在籍しています。`,
      message: "退勤を記録しました",
      modeClass: "mode-pill--checked-out"
    };
  }
  return {
    type: "switch-office",
    label: "オフィス出勤に切り替える",
    status: `現在はリモート勤務中です。${formatTime(presence.since)}から在籍しています。`,
    message: "オフィス勤務へ切り替えました",
    modeClass: "mode-pill--office"
  };
}

function renderKioskScreen() {
  if (!state.db) return;
  const kioskSelect = $("#kioskMemberSelect");
  const kioskList = $("#kioskMemberList");
  const action = kioskActionFor(selectedUserId);
  const scanCopy = state.scanToken
    ? "QRを読み取りました。メンバーを選ぶとオフィス出勤を記録します。"
    : "入口タブレットで自分の名前を選ぶと、出勤または退勤を記録します。";

  $("#kioskCopy").textContent = scanCopy;
  kioskSelect.innerHTML = state.db.members.map((member) => `
    <option value="${escapeHtml(member.id)}" ${member.id === selectedUserId ? "selected" : ""}>${escapeHtml(member.name)}</option>
  `).join("");
  $("#kioskStatus").textContent = action.status;
  const actionButton = $("#kioskActionButton");
  actionButton.textContent = action.label;
  actionButton.classList.toggle("primary-button--checkout", action.type === "checkout");
  kioskList.innerHTML = state.db.members.map((member) => {
    const presence = presenceByUser(member.id);
    const rowAction = kioskActionFor(member.id);
    const statusText = presence
      ? `${labels.workMode[presence.workMode]}・${labels.status[presence.status]}`
      : "未出勤";
    return `
    <button class="login-member-row ${member.id === selectedUserId ? "is-selected" : ""}" type="button" data-kiosk-member="${escapeHtml(member.id)}">
      ${imageMarkup(member.avatarUrl, member.name, "member-avatar")}
      <span>
        <strong>${escapeHtml(member.name)}</strong>
        <small>${escapeHtml(statusText)}・${escapeHtml(rowAction.label)}</small>
      </span>
    </button>
  `;
  }).join("");
}

function clearScreenTimers() {
  if (completionTimer) window.clearTimeout(completionTimer);
  if (kioskReturnTimer) window.clearTimeout(kioskReturnTimer);
  completionTimer = null;
  kioskReturnTimer = null;
}

function setScreen(screen) {
  state.screen = screen;
  $("#kioskScreen").hidden = screen !== "kiosk";
  $("#completionScreen").hidden = screen !== "completion";
  $("#app").hidden = screen !== "board" && screen !== "viewer";
  document.body.classList.toggle("is-kiosk-view", screen === "kiosk");
  document.body.classList.toggle("is-completion-view", screen === "completion");
  document.body.classList.toggle("is-readonly-board", screen === "board" || screen === "viewer");
  document.body.classList.toggle("is-viewer-page", screen === "viewer");
}

function showKiosk() {
  clearScreenTimers();
  state.scanHandled = false;
  setScreen("kiosk");
  renderKioskScreen();
}

function showBoardPreview() {
  clearScreenTimers();
  showView("office");
  setScreen("board");
  render();
  scheduleKioskReturn();
}

function showViewer() {
  clearScreenTimers();
  showView("office");
  setScreen("viewer");
  render();
}

function showCompletion(member, action) {
  clearScreenTimers();
  setImage($("#completionAvatar"), member.avatarUrl, member.name);
  $("#completionTitle").textContent = action.type === "checkout" ? "退勤を記録しました" : "出勤を記録しました";
  $("#completionMessage").textContent = `${member.name}さん、${action.message}。`;
  const meta = $("#completionMeta");
  meta.textContent = action.type === "checkout" ? "退勤完了" : "オフィス勤務";
  meta.className = `mode-pill ${action.modeClass}`;
  setScreen("completion");
  completionTimer = window.setTimeout(
    action.type === "checkout" ? showKiosk : showBoardPreview,
    completionDurationMs
  );
}

function scheduleKioskReturn() {
  if (state.screen !== "board") return;
  if (kioskReturnTimer) window.clearTimeout(kioskReturnTimer);
  kioskReturnTimer = window.setTimeout(showKiosk, boardIdleReturnMs);
}

function handleBoardActivity() {
  if (state.screen === "board") scheduleKioskReturn();
}

async function runKioskAction() {
  const member = selectedMember();
  const action = kioskActionFor(member.id);
  const payload = action.type === "checkout"
    ? { action: "checkout" }
    : {
        workMode: "office",
        status: "active",
        entryMethod: "office_qr",
        qrToken: state.scanToken || state.db.office.qrToken
      };
  const result = await updatePresence(payload, action.message);
  if (result?.ok) {
    showCompletion(member, action);
  }
}

async function handleScanRoute() {
  if (!state.scanToken || state.scanHandled || !state.db) return;
  state.scanHandled = true;
  const officeToken = state.db.office.qrToken;
  if (state.scanToken !== officeToken) {
    renderQrState();
    $("#qrDialog").showModal();
    showToast("このQRは認証できません");
    return;
  }

  await runKioskAction();
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
    <option value="${escapeHtml(member.id)}" ${member.id === selectedUserId ? "selected" : ""}>${escapeHtml(member.name)}</option>
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

  setImage($("#currentUserAvatar"), member.avatarUrl, member.name);
  setImage($("#operatorAvatar"), member.avatarUrl, member.name);
  $("#operatorName").textContent = member.name;
  $("#operatorStatus").textContent = statusText;
  setImage($("#qrUserAvatar"), member.avatarUrl, member.name);
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
  const current = selectedPresence();
  const alreadyOffice = current?.workMode === "office";
  const isReadOnly = state.db.persistence?.writable === false;
  const status = $("#qrStatus");
  const button = $("#dialogOfficeButton");

  $("#qrUrl").textContent = `/scan/${officeToken}`;
  status.textContent = isInvalidScan
    ? "このQRトークンは認証できません"
    : alreadyOffice
      ? "すでにオフィス入室中です"
      : state.scanToken
        ? "QRトークン認証済み"
        : "このQRでオフィス入室を記録します";
  status.classList.toggle("is-error", isInvalidScan);
  button.disabled = isInvalidScan || isReadOnly || alreadyOffice;
  button.style.opacity = button.disabled ? "0.48" : "1";
  button.dataset.qrToken = activeToken;
}

function renderOfficeMapAssets() {
  const layout = currentLayout();
  const stage = $(".scene-stage");
  const image = $("#officeRoomImage");
  if (!layout || !stage || !image) return;

  stage.style.setProperty("--office-aspect-ratio", layout.aspectRatio);
  stage.dataset.layout = currentLayoutKey();
  image.dataset.fallbackSrc = imageFallbacks.officeBackground;
  image.classList.remove("is-fallback-image", "is-missing-image");
  if (image.getAttribute("src") !== layout.backgroundUrl) {
    image.src = layout.backgroundUrl;
  }
}

function renderOfficePins() {
  const officePresences = activePresence().filter((presence) => presence.workMode === "office");
  $("#officePins").innerHTML = officePresences.map((presence, index) => {
    const member = memberById(presence.userId);
    if (!member) return "";
    const status = presence.status || "active";
    const statusText = labels.status[status] || labels.status.active;
    const seatText = presence.seatLabel || member.seatLabel || "座席未設定";
    const spriteUrl = spriteUrlFor(presence);
    const assetName = spriteMetaFor(presence.userId)?.displayName || member.name;
    const memberName = escapeHtml(member.name || assetName || presence.userId);
    const escapedAssetName = escapeHtml(assetName);
    const escapedSeatText = escapeHtml(seatText);
    const escapedStatusText = escapeHtml(statusText);
    const placementClass = characterPlacementClass(presence, index);
    const detailText = escapedStatusText;
    const timeText = `${formatTime(presence.since)}〜`;
    if (spriteUrl) {
      return `
        <div class="office-character office-character--sprite office-character--${escapeHtml(status)} ${placementClass}" style="${characterPositionStyle(presence, index)}" role="img" aria-label="${memberName}、${escapedSeatText}、${escapedStatusText}、${formatTime(presence.since)}から" tabindex="0" data-member-id="${escapeHtml(member.id)}" data-member-name="${memberName}" data-asset-name="${escapedAssetName}" data-sprite-src="${escapeHtml(spriteUrl)}">
          <span class="office-character__sprite-wrap" aria-hidden="true">
            ${imageMarkup(spriteUrl, "", "office-character__sprite", member.avatarUrl)}
            <span class="office-character__meeting-bubble">
              MTG
              <span class="office-character__voice">
                <i></i>
                <i></i>
                <i></i>
              </span>
            </span>
          </span>
          <span class="office-character__label">
            <strong>${memberName}</strong>
            <span>${detailText}</span>
            <span>${timeText}</span>
          </span>
        </div>
      `;
    }

    return `
      <div class="office-character office-character--${escapeHtml(status)} ${placementClass}" style="${characterPositionStyle(presence, index)}" role="img" aria-label="${memberName}、${escapedSeatText}、${escapedStatusText}、${formatTime(presence.since)}から" tabindex="0" data-member-id="${escapeHtml(member.id)}" data-member-name="${memberName}" data-asset-name="${escapedAssetName}">
        <span class="office-character__station" aria-hidden="true">
          <span class="office-character__shadow"></span>
          <span class="office-character__chair"></span>
          <span class="office-character__body">
            <span class="office-character__head">
              ${imageMarkup(member.avatarUrl, "", "office-character__face")}
            </span>
            <span class="office-character__torso"></span>
            <span class="office-character__arm office-character__arm--left"></span>
            <span class="office-character__arm office-character__arm--right"></span>
          </span>
          <span class="office-character__desk">
            <span class="office-character__keyboard">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </span>
          <span class="office-character__meeting-bubble">
            MTG
            <span class="office-character__voice">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </span>
        </span>
        <span class="office-character__label">
          <strong>${memberName}</strong>
          <span>${detailText}</span>
          <span>${timeText}</span>
        </span>
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
    if (!member) return "";
    return `
      <article class="presence-row">
        ${imageMarkup(member.avatarUrl, member.name, "member-avatar")}
        <div>
          <strong>${escapeHtml(member.name)}</strong>
          <small>${escapeHtml(presence.seatLabel)}・${formatTime(presence.since)}〜・${elapsedText(presence.since)}</small>
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
    if (!member) return "";
    const spriteUrl = spriteUrlFor(presence);
    return `
      <article class="remote-card">
        <span class="remote-card__avatar">
          ${imageMarkup(spriteUrl || member.avatarUrl, member.name, spriteUrl ? "remote-card__sprite" : "member-avatar", member.avatarUrl)}
        </span>
        <div>
          <strong>${escapeHtml(member.name)}</strong>
          <small>${escapeHtml(presence.seatLabel)}・${labels.entryMethod[presence.entryMethod]}・${elapsedText(presence.since)}</small>
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
        <strong>${escapeHtml(event.message)}</strong>
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
        <td>${escapeHtml(member?.name || session.userId)}</td>
        <td>${labels.workMode[session.workMode]}</td>
        <td>${formatTime(session.checkedInAt)}</td>
        <td>${formatTime(session.checkedOutAt)}</td>
        <td>${createStatusPill(presence)}</td>
        ${full ? `<td>${escapeHtml(session.memo || "")}</td>` : ""}
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
    const previewPresence = presence || { userId: member.id, status: "active" };
    const spriteUrl = spriteUrlFor(previewPresence);
    return `
      <article class="member-card">
        <span class="member-card__avatar">
          ${imageMarkup(spriteUrl || member.avatarUrl, member.name, spriteUrl ? "member-card__sprite" : "member-avatar", member.avatarUrl)}
        </span>
        <div>
          <strong>${escapeHtml(member.name)}</strong>
          <small>${escapeHtml(member.team)}・${escapeHtml(member.role)}</small>
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
  const isReadOnly = state.db.persistence?.writable === false;

  if (current?.workMode === "remote") {
    remoteButton.textContent = "リモート中";
  } else {
    remoteButton.textContent = "リモートで入る";
  }

  officeButton.textContent = current?.workMode === "office" ? "オフィス入室中" : "QRでオフィス入室";
  remoteButton.disabled = isReadOnly || current?.workMode === "remote";
  officeButton.disabled = isReadOnly || current?.workMode === "office";
  checkoutButton.disabled = isReadOnly || !current;
  remoteButton.style.opacity = remoteButton.disabled ? "0.48" : "1";
  officeButton.style.opacity = officeButton.disabled ? "0.48" : "1";
  checkoutButton.style.opacity = checkoutButton.disabled ? "0.48" : "1";
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
  if (!state.db) return;
  if (!memberById(selectedUserId)) {
    selectedUserId = state.db.members[0]?.id;
  }
  renderToday();
  renderMemberSelector();
  renderOperator();
  renderSummary();
  renderOfficeMapAssets();
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

function showView(view) {
  $$(".view").forEach((section) => section.classList.remove("is-visible"));
  const target = $(`#${view}View`);
  if (target) target.classList.add("is-visible");
  $$("[data-view-button]").forEach((item) => item.classList.toggle("is-active", item.dataset.viewButton === view));
}

function bindNavigation() {
  $$("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.viewButton);
    });
  });
}

function startPolling() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(async () => {
    try {
      await loadState();
      if (state.screen === "kiosk") {
        renderKioskScreen();
      } else {
        render();
      }
    } catch (error) {
      console.warn("Failed to refresh presence state", error);
    }
  }, refreshIntervalMs);
}

function bindActions() {
  $("#kioskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    setSelectedUser($("#kioskMemberSelect").value);
    runKioskAction();
  });

  $("#kioskMemberSelect").addEventListener("change", (event) => {
    setSelectedUser(event.target.value);
  });

  $("#kioskMemberList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-kiosk-member]");
    if (!button) return;
    setSelectedUser(button.dataset.kioskMember);
  });

  $("#memberSelect").addEventListener("change", (event) => {
    setSelectedUser(event.target.value, { message: "操作ユーザーを切り替えました" });
  });

  $("#mobileMemberSelect").addEventListener("change", (event) => {
    setSelectedUser(event.target.value, { message: "操作ユーザーを切り替えました" });
  });

  $("#returnKioskButton").addEventListener("click", showKiosk);

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
  state.routeMode = routeModeFromPath();
  document.addEventListener("error", handleImageError, true);
  await Promise.all([loadState(), loadOfficeAssets()]);
  if (!memberById(selectedUserId)) {
    selectedUserId = state.db.members[0]?.id;
  }
  bindNavigation();
  bindActions();
  ["click", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, handleBoardActivity, { passive: true });
  });
  layoutMedia.addEventListener("change", () => {
    if (!state.db) return;
    if (state.screen === "kiosk") renderKioskScreen();
    if (state.screen === "board" || state.screen === "viewer") render();
  });
  if (state.routeMode === "viewer") {
    showViewer();
  } else {
    showKiosk();
  }
  startPolling();
}

boot().catch((error) => {
  console.error(error);
  showToast("初期化に失敗しました");
});
