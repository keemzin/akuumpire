import { socket, showToast, playScoreBeep } from "./socket.js";

// Extract match ID from URL (/match/court-1-demo or ?id=...)
const pathParts = window.location.pathname.split("/").filter(Boolean);
const matchId = pathParts[1] || new URLSearchParams(window.location.search).get("id");

let currentMatchData = null;
let lastScoreA = 0;
let lastScoreB = 0;

async function loadInitialMatch() {
  if (!matchId) {
    showToast("Invalid match ID in URL", "error");
    return;
  }

  try {
    const res = await fetch(`/api/matches/${matchId}`);
    if (!res.ok) throw new Error("Match not found");
    const data = await res.json();
    renderScoreboard(data);
    
    // Connect to real-time room
    if (socket) {
      socket.emit("match:join", { matchId });
      socket.on("match:updated", (updated) => {
        renderScoreboard(updated);
      });
      socket.on("match:deleted", () => {
        showToast("This match has been concluded or deleted.", "warning");
        setTimeout(() => window.location.href = "/", 2000);
      });
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderScoreboard(match) {
  currentMatchData = match;

  // Header & Info
  const courtEl = document.getElementById("disp-court");
  const venueEl = document.getElementById("disp-venue");
  const typeEl = document.getElementById("disp-type");
  const setEl = document.getElementById("disp-current-set");

  if (courtEl) courtEl.textContent = match.court;
  if (venueEl) venueEl.textContent = match.venue;
  if (typeEl) typeEl.textContent = match.matchType;
  if (setEl) setEl.textContent = match.currentSet;

  // Team A
  const teamAName = document.getElementById("disp-team-a-name");
  const teamAPlayers = document.getElementById("disp-team-a-players");
  const scoreAEl = document.getElementById("disp-score-a");
  const servingAEl = document.getElementById("serving-a-indicator");
  const panelA = document.getElementById("panel-team-a");

  const pAStr = match.teamA.player2 ? `${match.teamA.player1} / ${match.teamA.player2}` : match.teamA.player1;
  if (teamAName) teamAName.textContent = match.teamA.name;
  if (teamAPlayers) teamAPlayers.textContent = pAStr;

  // Score pop animation
  if (scoreAEl) {
    if (match.currentScore.teamA !== lastScoreA) {
      scoreAEl.classList.add("pop");
      setTimeout(() => scoreAEl.classList.remove("pop"), 200);
      playScoreBeep(match.indicators?.isGamePoint || match.indicators?.isMatchPoint);
    }
    scoreAEl.textContent = match.currentScore.teamA;
    lastScoreA = match.currentScore.teamA;
  }

  const isServingA = match.servingTeam === "A";
  if (servingAEl) servingAEl.classList.toggle("active", isServingA);
  if (panelA) panelA.classList.toggle("serving", isServingA);

  // Team B
  const teamBName = document.getElementById("disp-team-b-name");
  const teamBPlayers = document.getElementById("disp-team-b-players");
  const scoreBEl = document.getElementById("disp-score-b");
  const servingBEl = document.getElementById("serving-b-indicator");
  const panelB = document.getElementById("panel-team-b");

  const pBStr = match.teamB.player2 ? `${match.teamB.player1} / ${match.teamB.player2}` : match.teamB.player1;
  if (teamBName) teamBName.textContent = match.teamB.name;
  if (teamBPlayers) teamBPlayers.textContent = pBStr;

  if (scoreBEl) {
    if (match.currentScore.teamB !== lastScoreB) {
      scoreBEl.classList.add("pop");
      setTimeout(() => scoreBEl.classList.remove("pop"), 200);
      playScoreBeep(match.indicators?.isGamePoint || match.indicators?.isMatchPoint);
    }
    scoreBEl.textContent = match.currentScore.teamB;
    lastScoreB = match.currentScore.teamB;
  }

  const isServingB = match.servingTeam === "B";
  if (servingBEl) servingBEl.classList.toggle("active", isServingB);
  if (panelB) panelB.classList.toggle("serving", isServingB);

  // Sets Won Dots
  renderSetsWon("sets-won-a", match.teamA.setsWon, match.rules.setsToWin);
  renderSetsWon("sets-won-b", match.teamB.setsWon, match.rules.setsToWin);

  // Sets History
  renderSetsHistory(match.setsHistory);

  // Banner status
  renderStatusBanner(match);
}

function renderSetsWon(containerId, count, target) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < target; i++) {
    const dot = document.createElement("span");
    dot.className = `set-dot ${i < count ? "won" : ""}`;
    container.appendChild(dot);
  }
}

function renderSetsHistory(history) {
  const container = document.getElementById("sets-history-container");
  if (!container) return;

  if (!history || history.length === 0) {
    container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-dim); text-align: center;">Set 1 in progress</span>`;
    return;
  }

  container.innerHTML = history.map(h => `
    <div class="history-pill ${h.winner === 'A' ? 'winner-a' : 'winner-b'}">
      <span style="font-size: 0.7rem; color: var(--text-muted);">S${h.set}</span>
      <span class="score-a">${h.teamA}</span>
      <span style="color: var(--text-dim);">-</span>
      <span class="score-b">${h.teamB}</span>
    </div>
  `).join("");
}

function renderStatusBanner(match) {
  const banner = document.getElementById("status-banner");
  if (!banner) return;

  banner.className = "status-banner";
  const ind = match.indicators || {};

  if (match.status === "FINISHED") {
    banner.classList.add("active", "finished");
    const winnerName = match.winner === "A" ? match.teamA.name : match.teamB.name;
    banner.textContent = `🏆 MATCH CONCLUDED — ${winnerName} WINS!`;
  } else if (ind.isMatchPoint) {
    banner.classList.add("active", "match-point");
    const leadingName = ind.leader === "A" ? match.teamA.name : match.teamB.name;
    banner.textContent = `⚡ MATCH POINT — ${leadingName}`;
  } else if (ind.isGamePoint) {
    banner.classList.add("active", "game-point");
    const leadingName = ind.leader === "A" ? match.teamA.name : match.teamB.name;
    banner.textContent = `🏸 GAME POINT — ${leadingName}`;
  } else if (match.status === "INTERVAL") {
    banner.classList.add("active", "interval");
    banner.textContent = `⏱️ 11-POINT INTERVAL BREAK`;
  } else if (ind.isDeuce) {
    banner.classList.add("active", "deuce");
    banner.textContent = `🔥 DEUCE — SUDDEN DEATH EXTENSION`;
  } else {
    banner.classList.remove("active");
  }
}

// Umpire PIN authorization button handler
function setupUmpireAuth() {
  const umpireBtn = document.getElementById("umpire-auth-btn");
  const modal = document.getElementById("pin-modal");
  const pinInput = document.getElementById("pin-input");
  const pinForm = document.getElementById("pin-form");
  const closeBtn = document.getElementById("close-pin-modal");

  if (!umpireBtn) return;

  umpireBtn.addEventListener("click", () => {
    // Check if token already exists in localStorage
    const savedToken = localStorage.getItem(`shuttle_token_${matchId}`);
    if (savedToken) {
      window.location.href = `/umpire/${matchId}?token=${savedToken}`;
      return;
    }

    if (modal) {
      modal.classList.add("active");
      if (pinInput) {
        pinInput.value = "";
        setTimeout(() => pinInput.focus(), 150);
      }
    }
  });

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => modal.classList.remove("active"));
  }

  if (pinForm) {
    pinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pin = pinInput.value.trim();

      try {
        const res = await fetch(`/api/matches/${matchId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinOrToken: pin })
        });
        const data = await res.json();

        if (data.valid) {
          localStorage.setItem(`shuttle_token_${matchId}`, data.adminToken);
          localStorage.setItem(`shuttle_pin_${matchId}`, data.adminPin);
          window.location.href = `/umpire/${matchId}?token=${data.adminToken}`;
        } else {
          showToast("Incorrect PIN. Please ask match creator.", "error");
        }
      } catch (err) {
        showToast("Error verifying PIN", "error");
      }
    });
  }
}

// Fullscreen TV Mode
function setupFullscreenToggle() {
  const toggleBtn = document.getElementById("fullscreen-btn");
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      document.body.classList.add("fullscreen-tv");
      toggleBtn.textContent = "Exit TV Mode";
    } else {
      document.exitFullscreen().catch(() => {});
      document.body.classList.remove("fullscreen-tv");
      toggleBtn.textContent = "Fullscreen TV";
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove("fullscreen-tv");
      toggleBtn.textContent = "Fullscreen TV";
    }
  });
}

// Share Modal
function setupShareModal() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const closeShareBtn = document.getElementById("close-share-modal");
  const copyShareBtn = document.getElementById("copy-share-url");
  const shareInput = document.getElementById("share-url-input");
  const qrContainer = document.getElementById("qr-container");

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener("click", () => {
    const url = window.location.href;
    if (shareInput) shareInput.value = url;

    // Generate QR Code via standard SVG API for zero-dependency crisp rendering
    if (qrContainer) {
      qrContainer.innerHTML = `
        <img 
          src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=22c55e&bgcolor=0f141f&data=${encodeURIComponent(url)}" 
          alt="Match Scoreboard QR Code"
          style="width: 180px; height: 180px; border-radius: 12px; border: 2px solid var(--border-medium); margin: 0 auto; display: block;"
        />
      `;
    }

    shareModal.classList.add("active");
  });

  if (closeShareBtn) {
    closeShareBtn.addEventListener("click", () => shareModal.classList.remove("active"));
  }

  if (copyShareBtn && shareInput) {
    copyShareBtn.addEventListener("click", () => {
      shareInput.select();
      navigator.clipboard.writeText(shareInput.value);
      showToast("Spectator link copied!", "success");
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadInitialMatch();
  setupUmpireAuth();
  setupFullscreenToggle();
  setupShareModal();
});
