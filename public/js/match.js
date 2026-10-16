import { socket, showToast, playScoreBeep } from "./socket.js";
import { buildReplayFrames } from "./replayEngine.js";

// Extract match ID from URL (/match/court-1-demo or ?id=...)
const pathParts = window.location.pathname.split("/").filter(Boolean);
const matchId = pathParts[1] || new URLSearchParams(window.location.search).get("id");

let currentMatchData = null;
let lastScoreA = 0;
let lastScoreB = 0;
let isReplayMode = false;
let replayFrames = [];
let currentFrameIdx = 0;
let replayTimer = null;
let replaySpeed = 1;
const BASE_SPEED_MS = 800;

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

    // Check if URL has ?replay=1
    const shouldAutoReplay = new URLSearchParams(window.location.search).get("replay") === "1";
    if (shouldAutoReplay && window.triggerReplayMode) {
      setTimeout(() => window.triggerReplayMode(true), 300);
    }
    
    // Connect to real-time room
    if (socket) {
      socket.emit("match:join", { matchId });
      socket.on("match:updated", (updated) => {
        if (!isReplayMode) renderScoreboard(updated);
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
  if (isReplayMode) return;
  currentMatchData = match;

  // Header & Info
  const courtEl = document.getElementById("disp-court");
  const venueEl = document.getElementById("disp-venue");
  const typeEl = document.getElementById("disp-type");
  const setEl = document.getElementById("disp-current-set");
  const setTitleEl = document.querySelector(".current-set-label .set-title");
  const statusBadgeEl = document.getElementById("disp-status-badge");

  const isFinished = match.status === "FINISHED";
  const isAbandoned = match.status === "ABANDONED";
  const isConcluded = isFinished || isAbandoned;
  const isWinnerA = isFinished && match.winner === "A";
  const isWinnerB = isFinished && match.winner === "B";
  const winnerName = isWinnerA ? match.teamA.name : (isWinnerB ? match.teamB.name : null);

  const formatTag = match.rules?.label || match.rules?.shortName || (match.rules?.setsToWin > 1 ? 'Best of 3 to 21' : '1 Set');
  if (courtEl) courtEl.textContent = match.court;
  if (venueEl) venueEl.textContent = match.venue;
  if (typeEl) typeEl.textContent = `${match.matchType} • ${formatTag}`;

  const courtNavEl = document.getElementById("disp-court-nav");
  if (courtNavEl) courtNavEl.textContent = match.court;

  // Header status badge (Desktop + Mobile Navbar)
  const statusBadgeNavEl = document.getElementById("disp-status-badge-nav");
  const updateBadge = (el) => {
    if (!el) return;
    if (isAbandoned) {
      el.className = "badge badge-abandoned";
      el.textContent = "Abandoned";
    } else if (isFinished) {
      el.className = "badge badge-gold";
      el.textContent = "Ended";
    } else if (match.status === "INTERVAL") {
      el.className = "badge badge-gold";
      el.textContent = "Interval";
    } else {
      el.className = "badge badge-live";
      el.textContent = "Live";
    }
  };

  updateBadge(statusBadgeEl);
  updateBadge(statusBadgeNavEl);

  // Toggle Replay Button in Navbar
  const openReplayBtn = document.getElementById("open-replay-btn");
  if (openReplayBtn) {
    if (isFinished || isAbandoned) {
      openReplayBtn.style.display = "inline-flex";
    } else {
      openReplayBtn.style.display = "none";
    }
  }

  // Center column current set
  if (setEl) {
    if (isAbandoned) {
      setEl.textContent = "ABANDONED";
      setEl.style.fontSize = "1.2rem";
      setEl.style.color = "#f87171";
      if (setTitleEl) setTitleEl.textContent = "STATUS";
    } else if (isFinished) {
      setEl.textContent = "ENDED";
      setEl.style.fontSize = "1.5rem";
      setEl.style.color = "var(--accent-gold)";
      if (setTitleEl) setTitleEl.textContent = "STATUS";
    } else {
      setEl.textContent = match.currentSet;
      setEl.style.fontSize = "2.5rem";
      setEl.style.color = "var(--accent-cyan)";
      if (setTitleEl) setTitleEl.textContent = "CURRENT SET";
    }
  }

  // Team A
  const teamAName = document.getElementById("disp-team-a-name");
  const teamAPlayers = document.getElementById("disp-team-a-players");
  const scoreAEl = document.getElementById("disp-score-a");
  const servingAEl = document.getElementById("serving-a-indicator");
  const panelA = document.getElementById("panel-team-a");
  const logoAWrapper = document.getElementById("disp-team-a-logo");
  const logoAImg = document.getElementById("team-a-logo-img");

  if (logoAWrapper && logoAImg) {
    if (match.teamA?.logo) {
      logoAImg.src = match.teamA.logo;
      logoAWrapper.style.display = "flex";
    } else {
      logoAWrapper.style.display = "none";
    }
  }

  const pAStr = match.teamA.player2 ? `${match.teamA.player1} / ${match.teamA.player2}` : match.teamA.player1;
  if (teamAName) {
    teamAName.innerHTML = isWinnerA 
      ? `${escapeHtml(match.teamA.name)} <span class="winner-stadium-badge">🏆 WINNER</span>`
      : escapeHtml(match.teamA.name);
  }
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

  const isServingA = match.servingTeam === "A" && !isFinished;
  if (servingAEl) servingAEl.classList.toggle("active", isServingA);
  if (panelA) {
    panelA.classList.toggle("serving", isServingA);
    panelA.classList.toggle("winner-panel", isWinnerA);
    panelA.classList.toggle("defeated-panel", isWinnerB);
  }

  // Team B
  const teamBName = document.getElementById("disp-team-b-name");
  const teamBPlayers = document.getElementById("disp-team-b-players");
  const scoreBEl = document.getElementById("disp-score-b");
  const servingBEl = document.getElementById("serving-b-indicator");
  const panelB = document.getElementById("panel-team-b");
  const logoBWrapper = document.getElementById("disp-team-b-logo");
  const logoBImg = document.getElementById("team-b-logo-img");

  if (logoBWrapper && logoBImg) {
    if (match.teamB?.logo) {
      logoBImg.src = match.teamB.logo;
      logoBWrapper.style.display = "flex";
    } else {
      logoBWrapper.style.display = "none";
    }
  }

  const pBStr = match.teamB.player2 ? `${match.teamB.player1} / ${match.teamB.player2}` : match.teamB.player1;
  if (teamBName) {
    teamBName.innerHTML = isWinnerB 
      ? `<span class="winner-stadium-badge">🏆 WINNER</span> ${escapeHtml(match.teamB.name)}`
      : escapeHtml(match.teamB.name);
  }
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

  const isServingB = match.servingTeam === "B" && !isFinished;
  if (servingBEl) servingBEl.classList.toggle("active", isServingB);
  if (panelB) {
    panelB.classList.toggle("serving", isServingB);
    panelB.classList.toggle("winner-panel", isWinnerB);
    panelB.classList.toggle("defeated-panel", isWinnerA);
  }

  // Sets Won Dots
  renderSetsWon("sets-won-a", match.teamA.setsWon, match.rules.setsToWin);
  renderSetsWon("sets-won-b", match.teamB.setsWon, match.rules.setsToWin);

  // Sets History
  renderSetsHistory(match.setsHistory);

  // Banner status
  renderStatusBanner(match);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

  // Deduplicate by set number (take latest entry for each set)
  const uniqueSetsMap = new Map();
  history.forEach((h, idx) => {
    const setNum = h.set || (idx + 1);
    uniqueSetsMap.set(setNum, { ...h, set: setNum });
  });
  const uniqueHistory = Array.from(uniqueSetsMap.values());

  container.innerHTML = uniqueHistory.map(h => `
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

// ==========================================
// Match Replay & Simulation Controller
// ==========================================
function setupReplayController() {
  const openReplayBtn = document.getElementById("open-replay-btn");
  const replayCard = document.getElementById("replay-controller");
  const closeReplayBtn = document.getElementById("replay-close-btn");
  const playToggleBtn = document.getElementById("replay-btn-toggle");
  const playIcon = document.getElementById("replay-play-icon");
  const restartBtn = document.getElementById("replay-btn-restart");
  const prevBtn = document.getElementById("replay-btn-prev");
  const nextBtn = document.getElementById("replay-btn-next");
  const slider = document.getElementById("replay-slider");
  const rallyText = document.getElementById("replay-rally-text");
  const tickStatus = document.getElementById("replay-tick-status");
  const speedBtns = document.querySelectorAll(".btn-speed");

  if (!replayCard) return;

  function startReplayMode(autoPlay = false) {
    if (!currentMatchData) return;
    isReplayMode = true;
    replayFrames = buildReplayFrames(currentMatchData);
    if (!replayFrames || replayFrames.length === 0) {
      showToast("No replay frames available for this match", "warning");
      return;
    }

    replayCard.style.display = "flex";
    if (openReplayBtn) openReplayBtn.style.display = "none";

    slider.min = 0;
    slider.max = replayFrames.length - 1;
    slider.value = 0;

    seekToFrame(0, false);

    if (autoPlay) {
      play();
    }
  }

  function exitReplayMode() {
    pause();
    isReplayMode = false;
    replayCard.style.display = "none";
    if (openReplayBtn) openReplayBtn.style.display = "inline-flex";
    if (currentMatchData) renderScoreboard(currentMatchData);
  }

  function seekToFrame(idx, playSound = false) {
    if (!replayFrames || replayFrames.length === 0) return;
    currentFrameIdx = Math.max(0, Math.min(idx, replayFrames.length - 1));
    slider.value = currentFrameIdx;

    const frame = replayFrames[currentFrameIdx];
    rallyText.textContent = `Rally ${currentFrameIdx} of ${replayFrames.length - 1}`;
    tickStatus.textContent = frame.note || `Set ${frame.currentSet}`;

    // Render snapshot
    renderReplaySnapshot(frame);

    if (playSound) {
      playScoreBeep(frame.indicators?.isGamePoint || frame.indicators?.isMatchPoint);
    }

    if (currentFrameIdx >= replayFrames.length - 1) {
      pause();
    }
  }

  function play() {
    if (currentFrameIdx >= replayFrames.length - 1) {
      currentFrameIdx = 0;
    }
    pause();
    playIcon.textContent = "⏸";
    replayTimer = setInterval(() => {
      if (currentFrameIdx < replayFrames.length - 1) {
        seekToFrame(currentFrameIdx + 1, true);
      } else {
        pause();
      }
    }, Math.floor(BASE_SPEED_MS / replaySpeed));
  }

  function pause() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    if (playIcon) playIcon.textContent = "▶";
  }

  function togglePlay() {
    if (replayTimer) pause();
    else play();
  }

  if (openReplayBtn) openReplayBtn.addEventListener("click", () => startReplayMode(true));
  if (closeReplayBtn) closeReplayBtn.addEventListener("click", exitReplayMode);
  if (playToggleBtn) playToggleBtn.addEventListener("click", togglePlay);
  if (restartBtn) restartBtn.addEventListener("click", () => { pause(); seekToFrame(0); });
  if (prevBtn) prevBtn.addEventListener("click", () => { pause(); seekToFrame(currentFrameIdx - 1); });
  if (nextBtn) nextBtn.addEventListener("click", () => { pause(); seekToFrame(currentFrameIdx + 1); });

  slider.addEventListener("input", (e) => {
    pause();
    seekToFrame(Number(e.target.value));
  });

  speedBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      speedBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      replaySpeed = Number(btn.dataset.speed) || 1;
      if (replayTimer) {
        play(); // restart timer with new speed
      }
    });
  });

  // Expose starter for URL param check
  window.triggerReplayMode = (autoPlay) => startReplayMode(autoPlay);
}

function renderReplaySnapshot(frame) {
  if (!currentMatchData) return;

  const scoreAEl = document.getElementById("disp-score-a");
  const scoreBEl = document.getElementById("disp-score-b");
  const setEl = document.getElementById("disp-current-set");
  const setTitleEl = document.querySelector(".current-set-label .set-title");
  const statusBadgeEl = document.getElementById("disp-status-badge");
  const servingAEl = document.getElementById("serving-a-indicator");
  const servingBEl = document.getElementById("serving-b-indicator");
  const panelA = document.getElementById("panel-team-a");
  const panelB = document.getElementById("panel-team-b");
  const banner = document.getElementById("status-banner");

  // Replay Badge in Header (Desktop + Mobile Navbar)
  const statusBadgeNavEl = document.getElementById("disp-status-badge-nav");
  if (statusBadgeEl) {
    statusBadgeEl.className = "badge badge-cyan";
    statusBadgeEl.textContent = "🎬 REPLAY";
  }
  if (statusBadgeNavEl) {
    statusBadgeNavEl.className = "badge badge-cyan";
    statusBadgeNavEl.textContent = "🎬 REPLAY";
  }

  const isWinnerA = Boolean(frame.isMatchEnd && frame.winner === "A");
  const isWinnerB = Boolean(frame.isMatchEnd && frame.winner === "B");

  const teamAName = document.getElementById("disp-team-a-name");
  const teamBName = document.getElementById("disp-team-b-name");
  if (teamAName) {
    teamAName.innerHTML = isWinnerA 
      ? `${escapeHtml(currentMatchData.teamA.name)} <span class="winner-stadium-badge">🏆 WINNER</span>`
      : escapeHtml(currentMatchData.teamA.name);
  }
  if (teamBName) {
    teamBName.innerHTML = isWinnerB 
      ? `<span class="winner-stadium-badge">🏆 WINNER</span> ${escapeHtml(currentMatchData.teamB.name)}`
      : escapeHtml(currentMatchData.teamB.name);
  }

  // Scores
  if (scoreAEl) {
    if (Number(scoreAEl.textContent) !== frame.currentScore.teamA) {
      scoreAEl.classList.add("pop");
      setTimeout(() => scoreAEl.classList.remove("pop"), 180);
    }
    scoreAEl.textContent = frame.currentScore.teamA;
  }
  if (scoreBEl) {
    if (Number(scoreBEl.textContent) !== frame.currentScore.teamB) {
      scoreBEl.classList.add("pop");
      setTimeout(() => scoreBEl.classList.remove("pop"), 180);
    }
    scoreBEl.textContent = frame.currentScore.teamB;
  }

  // Current Set
  if (setEl) {
    setEl.textContent = frame.currentSet;
    setEl.style.fontSize = "2.5rem";
    setEl.style.color = "var(--accent-cyan)";
    if (setTitleEl) setTitleEl.textContent = "CURRENT SET";
  }

  // Serving
  const isServingA = frame.servingTeam === "A" && !frame.isMatchEnd;
  const isServingB = frame.servingTeam === "B" && !frame.isMatchEnd;
  if (servingAEl) servingAEl.classList.toggle("active", isServingA);
  if (servingBEl) servingBEl.classList.toggle("active", isServingB);
  if (panelA) {
    panelA.classList.toggle("serving", isServingA);
    panelA.classList.toggle("winner-panel", isWinnerA);
    panelA.classList.toggle("defeated-panel", isWinnerB);
  }
  if (panelB) {
    panelB.classList.toggle("serving", isServingB);
    panelB.classList.toggle("winner-panel", isWinnerB);
    panelB.classList.toggle("defeated-panel", isWinnerA);
  }

  // Sets Won & History
  renderSetsWon("sets-won-a", frame.teamA.setsWon, currentMatchData.rules.setsToWin);
  renderSetsWon("sets-won-b", frame.teamB.setsWon, currentMatchData.rules.setsToWin);
  renderSetsHistory(frame.setsHistory);

  // Status Banner
  if (banner) {
    banner.className = "status-banner";
    const ind = frame.indicators || {};
    if (frame.isMatchEnd) {
      banner.classList.add("active", "finished");
      const winnerName = frame.winner === "A" ? currentMatchData.teamA.name : currentMatchData.teamB.name;
      banner.textContent = `🏆 MATCH CONCLUDED — ${winnerName} WINS!`;
    } else if (ind.isMatchPoint) {
      banner.classList.add("active", "match-point");
      const leadingName = ind.leader === "A" ? currentMatchData.teamA.name : currentMatchData.teamB.name;
      banner.textContent = `⚡ MATCH POINT — ${leadingName}`;
    } else if (ind.isGamePoint) {
      banner.classList.add("active", "game-point");
      const leadingName = ind.leader === "A" ? currentMatchData.teamA.name : currentMatchData.teamB.name;
      banner.textContent = `🏸 GAME POINT — ${leadingName}`;
    } else if (frame.status === "INTERVAL") {
      banner.classList.add("active", "interval");
      banner.textContent = `⏱️ 11-POINT INTERVAL BREAK`;
    } else if (frame.status === "SET_ENDED") {
      banner.classList.add("active", "game-point");
      banner.textContent = `🏁 SET ${frame.currentSet} COMPLETED`;
    } else if (ind.isDeuce) {
      banner.classList.add("active", "deuce");
      banner.textContent = `🔥 DEUCE — SUDDEN DEATH EXTENSION`;
    } else {
      banner.classList.remove("active");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadInitialMatch();
  setupUmpireAuth();
  setupFullscreenToggle();
  setupShareModal();
  setupReplayController();
});
