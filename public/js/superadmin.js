import { socket, showToast } from "./socket.js";

const authScreen = document.getElementById("auth-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const loginForm = document.getElementById("superadmin-login-form");
const masterPinInput = document.getElementById("master-pin-input");
const logoutBtn = document.getElementById("btn-logout");

const tableBody = document.getElementById("admin-table-body");
const searchInput = document.getElementById("admin-search-input");

const statTotal = document.getElementById("stat-total");
const statLive = document.getElementById("stat-live");
const statIdle = document.getElementById("stat-idle");
const statEnded = document.getElementById("stat-ended");

const btnReap = document.getElementById("btn-reap");
const btnResetDemos = document.getElementById("btn-reset-demos");
const btnPurgeHistory = document.getElementById("btn-purge-history");

let allAdminMatches = [];
let superadminToken = localStorage.getItem("shuttle_superadmin_token") || localStorage.getItem("shuttle_superadmin_pin") || "";

function checkAuth() {
  if (superadminToken) {
    fetchAdminMatches();
  } else {
    showAuth();
  }
}

function showAuth() {
  authScreen.style.display = "block";
  dashboardScreen.style.display = "none";
  if (masterPinInput) {
    masterPinInput.value = "";
    setTimeout(() => masterPinInput.focus(), 100);
  }
}

function showDashboard() {
  authScreen.style.display = "none";
  dashboardScreen.style.display = "block";
}

async function verifyAndLoad(secret) {
  try {
    const res = await fetch("/api/superadmin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, pin: secret })
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.token) {
      superadminToken = data.token;
      localStorage.setItem("shuttle_superadmin_token", data.token);
      localStorage.removeItem("shuttle_superadmin_pin");
      showDashboard();
      fetchAdminMatches();
      showToast("Super Admin authorized", "success");
    } else {
      localStorage.removeItem("shuttle_superadmin_token");
      localStorage.removeItem("shuttle_superadmin_pin");
      superadminToken = "";
      showAuth();
      showToast(data.error || "Invalid Super Admin credentials", "error");
    }
  } catch (err) {
    showToast("Error connecting to server", "error");
    showAuth();
  }
}

async function fetchAdminMatches() {
  if (!superadminToken) {
    showAuth();
    return;
  }

  try {
    const res = await fetch("/api/superadmin/matches", {
      headers: { "x-superadmin-token": superadminToken }
    });

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("shuttle_superadmin_token");
        localStorage.removeItem("shuttle_superadmin_pin");
        superadminToken = "";
        showAuth();
        showToast("Session expired. Please log in again.", "warning");
        return;
      }
      throw new Error("Failed to load match data");
    }

    allAdminMatches = await res.json();
    showDashboard();
    updateStats();
    renderTable();
  } catch (err) {
    console.error("Super Admin fetch error:", err);
    showToast(err.message, "error");
  }
}

function updateStats() {
  const total = allAdminMatches.length;
  const live = allAdminMatches.filter(r => r.matchState.status === "IN_PROGRESS" || r.matchState.status === "NOT_STARTED" || r.matchState.status === "INTERVAL" || r.matchState.status === "SET_ENDED").length;
  const idle = allAdminMatches.filter(r => (r.matchState.status === "IN_PROGRESS" || r.matchState.status === "INTERVAL") && r.idleMinutes >= 15).length;
  const ended = allAdminMatches.filter(r => r.matchState.status === "FINISHED" || r.matchState.status === "ABANDONED").length;

  if (statTotal) statTotal.textContent = total;
  if (statLive) statLive.textContent = live;
  if (statIdle) statIdle.textContent = idle;
  if (statEnded) statEnded.textContent = ended;
}

function renderTable() {
  if (!tableBody) return;

  const query = (searchInput?.value || "").toLowerCase().trim();

  const filtered = allAdminMatches.filter(r => {
    if (!query) return true;
    const m = r.matchState;
    const searchString = `${r.id} ${m.court} ${m.venue} ${m.status} ${m.teamA.name} ${m.teamA.player1} ${m.teamA.player2 || ""} ${m.teamB.name} ${m.teamB.player1} ${m.teamB.player2 || ""} ${r.adminPin}`.toLowerCase();
    return searchString.includes(query);
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2.5rem 1rem;">
          No courts match your search filter.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(r => {
    const m = r.matchState;
    const isLive = m.status === "IN_PROGRESS" || m.status === "INTERVAL" || m.status === "SET_ENDED";
    const isFinished = m.status === "FINISHED";
    const isAbandoned = m.status === "ABANDONED";
    const isIdle = isLive && r.idleMinutes >= 15;

    const statusBadge = isAbandoned
      ? `<span class="badge badge-abandoned" title="${escapeHtml(m.endedReason || 'Abandoned')}">Abandoned</span>`
      : isFinished
      ? `<span class="badge badge-gold">Ended</span>`
      : isIdle
      ? `<span class="badge badge-idle">⏸️ Idle (${r.idleMinutes}m)</span>`
      : isLive
      ? `<span class="badge badge-live">Live</span>`
      : `<span class="badge badge-ended">Warm-up</span>`;

    const teamAPlayers = m.teamA.player2 ? `${m.teamA.player1} & ${m.teamA.player2}` : m.teamA.player1;
    const teamBPlayers = m.teamB.player2 ? `${m.teamB.player1} & ${m.teamB.player2}` : m.teamB.player1;

    const rulesTag = m.rules?.shortName || (m.rules?.setsToWin > 1 ? `Bo${m.rules.setsToWin * 2 - 1}` : '1 Set');

    const scoreSummary = `
      <div style="font-weight: 700;">${escapeHtml(m.teamA.name)} <span style="color: var(--accent-lime);">${m.currentScore.teamA}</span> - <span style="color: var(--accent-cyan);">${m.currentScore.teamB}</span> ${escapeHtml(m.teamB.name)}</div>
      <div style="font-size: 0.78rem; color: var(--text-muted);">Set ${m.currentSet} (${m.teamA.setsWon} - ${m.teamB.setsWon})</div>
    `;

    return `
      <tr data-id="${r.id}">
        <td>
          <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(m.court)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(m.venue)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">${escapeHtml(r.id)}</div>
        </td>
        <td>
          <div style="font-weight: 600;">${m.matchType}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${rulesTag}</div>
        </td>
        <td>${statusBadge}</td>
        <td>${scoreSummary}</td>
        <td>
          <span class="pin-code-tag">${escapeHtml(r.adminPin)}</span>
          <div style="margin-top: 0.25rem;">
            <a href="/umpire/${r.id}?token=${r.adminToken}" target="_blank" style="font-size: 0.75rem; color: var(--accent-lime); text-decoration: none;">Launch Umpire ↗</a>
          </div>
        </td>
        <td>
          ${isLive ? `<span style="${r.idleMinutes >= 15 ? 'color: #fbbf24; font-weight: 700;' : 'color: var(--text-secondary);'}">${r.idleMinutes}m ago</span>` : '<span style="color: var(--text-muted);">Inactive</span>'}
        </td>
        <td style="text-align: right;">
          <div class="row-btn-group" style="justify-content: flex-end;">
            <a href="/match/${r.id}" target="_blank" class="btn btn-secondary btn-sm" title="View Spectator Scoreboard">TV</a>
            ${isLive ? `
              <button class="btn btn-secondary btn-sm btn-action-conclude" data-id="${r.id}" style="color: var(--accent-lime);" title="Conclude early & award leader">End</button>
              <button class="btn btn-secondary btn-sm btn-action-abandon" data-id="${r.id}" style="color: #fbbf24;" title="Mark as Abandoned">Abandon</button>
            ` : ''}
            <button class="btn btn-secondary btn-sm btn-action-delete" data-id="${r.id}" data-court="${escapeHtml(m.court)}" style="color: #f87171;" title="Delete match permanently">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  attachTableEvents();
}

function attachTableEvents() {
  document.querySelectorAll(".btn-action-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.id;
      const courtName = btn.dataset.court;
      if (!confirm(`Are you sure you want to permanently delete court "${courtName}" (${matchId})?`)) return;

      try {
        const res = await fetch(`/api/superadmin/matches/${matchId}`, {
          method: "DELETE",
          headers: { "x-superadmin-token": superadminToken }
        });
        if (!res.ok) throw new Error("Delete failed");
        showToast(`Court ${courtName} deleted`, "info");
        fetchAdminMatches();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  document.querySelectorAll(".btn-action-conclude").forEach(btn => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.id;
      if (!confirm(`Force conclude match ${matchId} and award winner by current lead?`)) return;

      try {
        const res = await fetch(`/api/superadmin/matches/${matchId}/action`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-superadmin-token": superadminToken 
          },
          body: JSON.stringify({ action: "CONCLUDE", reason: "Concluded by Super Admin" })
        });
        if (!res.ok) throw new Error("Conclude action failed");
        showToast("Match concluded successfully", "success");
        fetchAdminMatches();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  document.querySelectorAll(".btn-action-abandon").forEach(btn => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.id;
      if (!confirm(`Mark match ${matchId} as Abandoned?`)) return;

      try {
        const res = await fetch(`/api/superadmin/matches/${matchId}/action`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-superadmin-token": superadminToken 
          },
          body: JSON.stringify({ action: "ABANDON", reason: "Abandoned by Super Admin" })
        });
        if (!res.ok) throw new Error("Abandon action failed");
        showToast("Match marked as Abandoned", "warning");
        fetchAdminMatches();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Event Listeners
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const secret = masterPinInput.value.trim();
    if (!secret) return;
    verifyAndLoad(secret);
  });
}

const togglePasswordBtn = document.getElementById("toggle-password-btn");
if (togglePasswordBtn && masterPinInput) {
  togglePasswordBtn.addEventListener("click", () => {
    const isPw = masterPinInput.type === "password";
    masterPinInput.type = isPw ? "text" : "password";
    togglePasswordBtn.textContent = isPw ? "🙈" : "👁️";
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/superadmin/logout", {
        method: "POST",
        headers: { "x-superadmin-token": superadminToken }
      });
    } catch (e) {}
    localStorage.removeItem("shuttle_superadmin_token");
    localStorage.removeItem("shuttle_superadmin_pin");
    superadminToken = "";
    showAuth();
    showToast("Logged out of Super Admin", "info");
  });
}

if (searchInput) {
  searchInput.addEventListener("input", renderTable);
}

// Global Toolbar buttons
if (btnReap) {
  btnReap.addEventListener("click", async () => {
    try {
      btnReap.disabled = true;
      btnReap.textContent = "Running Reaper...";
      const res = await fetch("/api/superadmin/reap", {
        method: "POST",
        headers: { "x-superadmin-token": superadminToken }
      });
      const data = await res.json();
      showToast(`AFK Reaper ran: ${data.modified ? 'stale matches cleaned' : 'all courts active & healthy'}`, "info");
      fetchAdminMatches();
    } catch (err) {
      showToast("Reaper failed", "error");
    } finally {
      btnReap.disabled = false;
      btnReap.innerHTML = "<span>🧹 Run AFK Reaper</span>";
    }
  });
}

if (btnResetDemos) {
  btnResetDemos.addEventListener("click", async () => {
    if (!confirm("Reset Demo Courts 1 and 2 to fresh live action?")) return;
    try {
      const res = await fetch("/api/superadmin/reset-demos", {
        method: "POST",
        headers: { "x-superadmin-token": superadminToken }
      });
      if (!res.ok) throw new Error("Reset failed");
      showToast("Demo courts reset to live status", "success");
      fetchAdminMatches();
    } catch (err) {
      showToast("Error resetting demo matches", "error");
    }
  });
}

if (btnPurgeHistory) {
  btnPurgeHistory.addEventListener("click", async () => {
    if (!confirm("WARNING: This will permanently purge all ended and abandoned matches. Proceed?")) return;
    try {
      const res = await fetch("/api/superadmin/purge-history", {
        method: "POST",
        headers: { "x-superadmin-token": superadminToken }
      });
      const data = await res.json();
      showToast(`Purged ${data.deletedCount} past matches`, "info");
      fetchAdminMatches();
    } catch (err) {
      showToast("Error purging history", "error");
    }
  });
}

// Socket updates for live admin view
if (socket) {
  socket.on("matches:list_updated", () => {
    if (dashboardScreen.style.display !== "none") {
      fetchAdminMatches();
    }
  });
}

// Initial boot
document.addEventListener("DOMContentLoaded", checkAuth);
