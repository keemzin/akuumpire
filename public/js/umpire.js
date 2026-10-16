import { socket, showToast, playScoreBeep, playWarningBeep } from "./socket.js";
import {
  addPoint as applyAddPoint,
  undoLastPoint as applyUndoPoint,
  startNextSet as applyNextSet,
  switchServingTeam as applySwitchServe,
  switchCourtEnds as applySwapEnds,
  resumeFromInterval as applyResumeInterval,
  concludeMatchEarly as applyConcludeEarly,
  abandonMatch as applyAbandonMatch
} from "./badmintonRules.js";

const pathParts = window.location.pathname.split("/").filter(Boolean);
const matchId = pathParts[1] || new URLSearchParams(window.location.search).get("id");

const queryParams = new URLSearchParams(window.location.search);
let adminToken = queryParams.get("token") || localStorage.getItem(`shuttle_token_${matchId}`);
let adminPin = localStorage.getItem(`shuttle_pin_${matchId}`);

// Persistent Device Identifier for Single-Active Umpire Lease
function getOrCreateDeviceId() {
  let devId = localStorage.getItem("shuttle_device_id");
  if (!devId) {
    devId = "umpire_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
    localStorage.setItem("shuttle_device_id", devId);
  }
  return devId;
}
const deviceId = getOrCreateDeviceId();

const OFFLINE_STORAGE_KEY = `shuttle_offline_match_${matchId}`;
let currentMatch = null;
let isConnected = true;
let isSocketInitialized = false;
let isScoringInFlight = false;
let unsyncedCount = 0;
let syncCountdownTimer = null;
let syncCountdownSeconds = 3;

function getOfflineStorage() {
  try {
    const raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveOfflineStorage(matchState, count) {
  try {
    localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify({
      matchState,
      unsyncedCount: count,
      updatedAt: Date.now()
    }));
  } catch (e) {}
}

function clearOfflineStorage() {
  localStorage.removeItem(OFFLINE_STORAGE_KEY);
}

function updateOfflineBanner() {
  const banner = document.getElementById("umpire-connection-banner");
  const text = document.getElementById("umpire-connection-text");
  const syncActions = document.getElementById("sync-actions");
  const countdownText = document.getElementById("sync-countdown-text");

  if (!banner || !text) return;

  if (!isConnected) {
    // Offline mode: allow local scoring, clear countdown
    if (syncCountdownTimer) {
      clearInterval(syncCountdownTimer);
      syncCountdownTimer = null;
    }
    banner.className = "umpire-connection-banner offline-mode";
    banner.style.display = "flex";
    if (syncActions) syncActions.style.display = "none";
    text.textContent = `📴 Offline Mode Active — Scoring locally (${unsyncedCount} unsynced)`;
  } else if (unsyncedCount > 0) {
    // Online restored, but unsynced points exist!
    banner.className = "umpire-connection-banner sync-pending";
    banner.style.display = "flex";
    if (syncActions) syncActions.style.display = "flex";
    text.textContent = `📡 WiFi Restored: ${unsyncedCount} point(s) ready to sync`;

    // Start 3-second auto-sync countdown if not already ticking
    if (!syncCountdownTimer) {
      syncCountdownSeconds = 3;
      if (countdownText) countdownText.textContent = `(Auto in ${syncCountdownSeconds}s)`;
      syncCountdownTimer = setInterval(() => {
        syncCountdownSeconds--;
        if (syncCountdownSeconds <= 0) {
          clearInterval(syncCountdownTimer);
          syncCountdownTimer = null;
          executeSync();
        } else if (countdownText) {
          countdownText.textContent = `(Auto in ${syncCountdownSeconds}s)`;
        }
      }, 1000);
    }
  } else {
    // Fully connected & in sync
    if (syncCountdownTimer) {
      clearInterval(syncCountdownTimer);
      syncCountdownTimer = null;
    }
    if (syncActions) syncActions.style.display = "none";
    banner.className = "umpire-connection-banner connected";
    text.textContent = "✅ Connected — Match in sync";
    setTimeout(() => {
      if (isConnected && unsyncedCount === 0) {
        banner.style.display = "none";
      }
    }, 2200);
  }
}

function executeSync() {
  if (syncCountdownTimer) {
    clearInterval(syncCountdownTimer);
    syncCountdownTimer = null;
  }

  if (!socket || !socket.connected) {
    showToast("Reconnecting... Will sync as soon as connected", "warning");
    return;
  }

  const text = document.getElementById("umpire-connection-text");
  const syncActions = document.getElementById("sync-actions");
  if (syncActions) syncActions.style.display = "none";
  if (text) text.textContent = `⚡ Syncing ${unsyncedCount} points to stadium scoreboard...`;

  socket.emit("match:sync_state", {
    matchId,
    pinOrToken: adminToken,
    matchState: currentMatch,
    deviceId
  });
}

function initSocketSync() {
  if (!socket || isSocketInitialized) return;
  isSocketInitialized = true;

  socket.emit("match:join", { matchId });

  socket.on("match:updated", (updated) => {
    isScoringInFlight = false;
    // Only accept incoming server updates if we do not have pending local unsynced offline points
    if (unsyncedCount === 0) {
      currentMatch = updated;
      updateConsoleUI(updated);
    }
  });

  socket.on("match:sync_confirmed", ({ matchState }) => {
    unsyncedCount = 0;
    clearOfflineStorage();
    currentMatch = matchState;
    updateConsoleUI(matchState);

    const banner = document.getElementById("umpire-connection-banner");
    const text = document.getElementById("umpire-connection-text");
    const syncActions = document.getElementById("sync-actions");
    if (syncActions) syncActions.style.display = "none";
    if (banner) {
      banner.className = "umpire-connection-banner connected";
      if (text) text.textContent = "✅ All points synchronized with stadium!";
      setTimeout(() => {
        if (isConnected && unsyncedCount === 0) banner.style.display = "none";
      }, 2500);
    }
    showToast("Scoreboard synchronized!", "info");
  });

  socket.on("disconnect", (reason) => {
    console.warn("[Umpire] Disconnected:", reason);
    if (socket && socket.sendBuffer) socket.sendBuffer = [];
    isConnected = false;
    updateOfflineBanner();
  });

  socket.on("connect_error", (err) => {
    console.warn("[Umpire] Connect error:", err);
    if (socket && socket.sendBuffer) socket.sendBuffer = [];
    isConnected = false;
    updateOfflineBanner();
  });

  socket.on("connect", () => {
    console.log("[Umpire] Connected to server socket");
    if (socket && socket.sendBuffer) socket.sendBuffer = [];
    isConnected = true;
    updateOfflineBanner();

    // If no offline points are waiting, fetch latest server match state
    if (unsyncedCount === 0) {
      socket.emit("match:join", { matchId });
    }
  });

  window.addEventListener("offline", () => {
    if (socket && socket.sendBuffer) socket.sendBuffer = [];
    isConnected = false;
    updateOfflineBanner();
  });

  window.addEventListener("online", () => {
    if (socket && !socket.connected) {
      socket.connect();
    } else {
      isConnected = true;
      updateOfflineBanner();
    }
  });
}

async function verifyAndAuthorize(pinOrToken, forceTakeover = false) {
  const res = await fetch(`/api/matches/${matchId}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinOrToken, deviceId, forceTakeover })
  });

  if (!res.ok) {
    throw new Error("Invalid Match PIN");
  }

  const authData = await res.json();
  if (authData.hasDeviceConflict) {
    promptConflictModal(pinOrToken);
    return null;
  }

  adminPin = authData.adminPin;
  adminToken = authData.adminToken;
  localStorage.setItem(`shuttle_token_${matchId}`, adminToken);
  localStorage.setItem(`shuttle_pin_${matchId}`, adminPin);

  return authData.matchState;
}

function promptConflictModal(pinOrToken) {
  const conflictModal = document.getElementById("conflict-modal");
  const btnTakeover = document.getElementById("btn-force-takeover");
  const btnCancel = document.getElementById("btn-cancel-takeover");

  if (conflictModal) conflictModal.classList.add("active");

  btnTakeover?.replaceWith(btnTakeover.cloneNode(true));
  const newBtnTakeover = document.getElementById("btn-force-takeover");
  newBtnTakeover?.addEventListener("click", async () => {
    conflictModal.classList.remove("active");
    try {
      const matchState = await verifyAndAuthorize(pinOrToken, true);
      if (matchState) setupUmpireConsole(matchState);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  btnCancel?.replaceWith(btnCancel.cloneNode(true));
  const newBtnCancel = document.getElementById("btn-cancel-takeover");
  newBtnCancel?.addEventListener("click", () => {
    window.location.href = `/match/${matchId}`;
  });
}

async function initUmpire() {
  if (!matchId) {
    showToast("Invalid match ID", "error");
    return;
  }

  // Restore any pending offline state from storage first
  const offlineData = getOfflineStorage();
  if (offlineData && offlineData.matchState) {
    currentMatch = offlineData.matchState;
    unsyncedCount = offlineData.unsyncedCount || 0;
  }

  // Initialize socket lifecycle handlers
  initSocketSync();

  // If no token in URL or storage, show PIN prompt
  if (!adminToken) {
    promptForPin();
    return;
  }

  try {
    const matchState = await verifyAndAuthorize(adminToken);
    if (!matchState) return;

    // If we have unsynced local points, preserve local score; otherwise use server state
    const activeState = (unsyncedCount > 0 && currentMatch) ? currentMatch : matchState;
    setupUmpireConsole(activeState);
  } catch (err) {
    localStorage.removeItem(`shuttle_token_${matchId}`);
    promptForPin();
  }
}

function promptForPin() {
  const modal = document.getElementById("auth-modal");
  const form = document.getElementById("auth-form");
  const pinInput = document.getElementById("auth-pin-input");

  if (modal) {
    modal.classList.add("active");
    if (pinInput) setTimeout(() => pinInput.focus(), 150);
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const entered = pinInput.value.trim();

      try {
        const matchState = await verifyAndAuthorize(entered);
        if (!matchState) return;

        modal.classList.remove("active");
        const activeState = (unsyncedCount > 0 && currentMatch) ? currentMatch : matchState;
        setupUmpireConsole(activeState);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }
}

function setupUmpireConsole(initialState) {
  currentMatch = initialState;

  // Set spectator view link
  const specLink = document.getElementById("view-scoreboard-link");
  if (specLink) specLink.href = `/match/${matchId}`;

  // Big Tap Scoring Pads
  const padA = document.getElementById("pad-team-a");
  const padB = document.getElementById("pad-team-b");

  if (padA) {
    padA.addEventListener("click", () => {
      scorePoint("A");
    });
  }

  if (padB) {
    padB.addEventListener("click", () => {
      scorePoint("B");
    });
  }

  // Toolbar Actions
  document.getElementById("btn-undo")?.addEventListener("click", undoPoint);
  document.getElementById("btn-next-set")?.addEventListener("click", nextSet);
  document.getElementById("btn-swap-ends")?.addEventListener("click", swapEnds);
  document.getElementById("btn-switch-serve")?.addEventListener("click", switchServe);
  document.getElementById("btn-resume-interval")?.addEventListener("click", resumeInterval);
  document.getElementById("btn-sync-now")?.addEventListener("click", executeSync);

  // Conclude / Abandon Court Actions
  const concludeModal = document.getElementById("conclude-modal");
  const closeConcludeBtn = document.getElementById("close-conclude-modal");
  const btnConclude = document.getElementById("btn-conclude-match");
  const btnConfirmConclude = document.getElementById("btn-confirm-conclude");
  const btnConfirmAbandon = document.getElementById("btn-confirm-abandon");

  if (btnConclude && concludeModal) {
    btnConclude.addEventListener("click", () => {
      concludeModal.classList.add("active");
    });
  }

  if (closeConcludeBtn && concludeModal) {
    closeConcludeBtn.addEventListener("click", () => {
      concludeModal.classList.remove("active");
    });
  }

  if (concludeModal) {
    concludeModal.addEventListener("click", (e) => {
      if (e.target === concludeModal) concludeModal.classList.remove("active");
    });
  }

  if (btnConfirmConclude && concludeModal) {
    btnConfirmConclude.addEventListener("click", () => {
      concludeModal.classList.remove("active");
      if (socket) {
        socket.emit("match:conclude_early", {
          matchId,
          pinOrToken: adminToken,
          action: "CONCLUDE",
          reason: "Concluded early by umpire"
        });
        showToast("Match concluded early", "info");
      }
    });
  }

  if (btnConfirmAbandon && concludeModal) {
    btnConfirmAbandon.addEventListener("click", () => {
      concludeModal.classList.remove("active");
      if (socket) {
        socket.emit("match:conclude_early", {
          matchId,
          pinOrToken: adminToken,
          action: "ABANDON",
          reason: "Abandoned / Walkover by court official"
        });
        showToast("Court marked as abandoned", "warning");
      }
    });
  }

  updateConsoleUI(initialState);
  updateOfflineBanner();
}

function scorePoint(team) {
  if (!currentMatch || currentMatch.status === "FINISHED") {
    showToast("Match has finished", "warning");
    return;
  }

  playScoreBeep(false);

  // If online and in sync: send directly to server
  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    if (isScoringInFlight) return;
    isScoringInFlight = true;
    setTimeout(() => { isScoringInFlight = false; }, 1200);

    socket.emit("match:point", {
      matchId,
      scoringTeam: team,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  // Offline mode or pending sync: apply local BWF rules immediately!
  applyAddPoint(currentMatch, team);
  unsyncedCount++;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function undoPoint() {
  if (!currentMatch) return;
  playScoreBeep(true);

  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    socket.emit("match:undo", {
      matchId,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  applyUndoPoint(currentMatch);
  if (unsyncedCount > 0) unsyncedCount--;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function nextSet() {
  if (!currentMatch) return;
  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    socket.emit("match:next_set", {
      matchId,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  applyNextSet(currentMatch);
  unsyncedCount++;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function swapEnds() {
  if (!currentMatch) return;
  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    socket.emit("match:swap_ends", {
      matchId,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  applySwapEnds(currentMatch);
  unsyncedCount++;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function switchServe() {
  if (!currentMatch) return;
  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    socket.emit("match:switch_serve", {
      matchId,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  applySwitchServe(currentMatch);
  unsyncedCount++;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function resumeInterval() {
  if (!currentMatch) return;
  if (isConnected && socket && socket.connected && unsyncedCount === 0) {
    socket.emit("match:resume_interval", {
      matchId,
      pinOrToken: adminToken,
      deviceId
    });
    return;
  }

  applyResumeInterval(currentMatch);
  unsyncedCount++;
  saveOfflineStorage(currentMatch, unsyncedCount);
  updateConsoleUI(currentMatch);
  updateOfflineBanner();
}

function updateConsoleUI(match) {
  currentMatch = match;

  // Header
  const courtBadge = document.getElementById("umpire-court-title");
  const matchStatus = document.getElementById("umpire-match-status");
  const pinBadge = document.getElementById("umpire-pin-tag");

  const formatLabel = match.rules?.shortName || (match.rules?.setsToWin > 1 ? `Bo${match.rules.setsToWin * 2 - 1} to ${match.rules?.pointsPerSet}` : `1 Set to ${match.rules?.pointsPerSet}`);
  const totalMaxSets = match.rules?.setsToWin > 1 ? (match.rules.setsToWin * 2 - 1) : 1;
  const setCounterText = match.rules?.setsToWin > 1 
    ? `Set ${match.currentSet} of ${totalMaxSets}` 
    : `1 Set (${match.rules?.pointsPerSet} pts)`;

  const statusClean = match.status === "FINISHED" 
    ? "MATCH ENDED" 
    : match.status === "SET_ENDED" 
    ? "SET ENDED" 
    : match.status === "INTERVAL" 
    ? "INTERVAL BREAK" 
    : "IN PROGRESS";

  if (courtBadge) courtBadge.textContent = `${match.court} (${match.venue})`;
  if (pinBadge && adminPin) pinBadge.textContent = `PIN: ${adminPin}`;
  if (matchStatus) matchStatus.textContent = `${setCounterText} • ${formatLabel} • ${statusClean}`;

  // Pad A
  const padA = document.getElementById("pad-team-a");
  const nameA = document.getElementById("pad-team-a-name");
  const subA = document.getElementById("pad-team-a-sub");
  const scoreA = document.getElementById("pad-score-a");
  const logoA = document.getElementById("pad-team-a-logo");

  const isServingA = match.servingTeam === "A";
  if (padA) padA.classList.toggle("serving-side", isServingA);
  if (nameA) nameA.textContent = match.teamA.name;
  if (subA) subA.textContent = match.teamA.player2 ? `${match.teamA.player1} & ${match.teamA.player2}` : match.teamA.player1;
  if (scoreA) scoreA.textContent = match.currentScore.teamA;
  if (logoA) {
    if (match.teamA?.logo) {
      logoA.src = match.teamA.logo;
      logoA.style.display = "inline-block";
    } else {
      logoA.style.display = "none";
    }
  }

  // Pad B
  const padB = document.getElementById("pad-team-b");
  const nameB = document.getElementById("pad-team-b-name");
  const subB = document.getElementById("pad-team-b-sub");
  const scoreB = document.getElementById("pad-score-b");
  const logoB = document.getElementById("pad-team-b-logo");

  const isServingB = match.servingTeam === "B";
  if (padB) padB.classList.toggle("serving-side", isServingB);
  if (nameB) nameB.textContent = match.teamB.name;
  if (subB) subB.textContent = match.teamB.player2 ? `${match.teamB.player1} & ${match.teamB.player2}` : match.teamB.player1;
  if (scoreB) scoreB.textContent = match.currentScore.teamB;
  if (logoB) {
    if (match.teamB?.logo) {
      logoB.src = match.teamB.logo;
      logoB.style.display = "inline-block";
    } else {
      logoB.style.display = "none";
    }
  }

  // Action Buttons visibility
  const nextSetBtn = document.getElementById("btn-next-set");
  const intervalBtn = document.getElementById("btn-resume-interval");

  if (nextSetBtn) {
    nextSetBtn.style.display = match.status === "SET_ENDED" ? "flex" : "none";
  }

  if (intervalBtn) {
    intervalBtn.style.display = match.status === "INTERVAL" ? "flex" : "none";
  }

  // Update Court Rotation diagram
  renderCourtDiagram(match);
}

function renderCourtDiagram(match) {
  // Determine if serving score is even or odd
  // Even: Right service court, Odd: Left service court
  const servingScore = match.servingTeam === "A" ? match.currentScore.teamA : match.currentScore.teamB;
  const isEven = servingScore % 2 === 0;

  const leftBoxEl = document.getElementById("court-box-left");
  const rightBoxEl = document.getElementById("court-box-right");
  const oppLeftBoxEl = document.getElementById("court-box-opp-left");
  const oppRightBoxEl = document.getElementById("court-box-opp-right");

  // Clear previous serving styling
  [leftBoxEl, rightBoxEl, oppLeftBoxEl, oppRightBoxEl].forEach(el => {
    if (el) el.classList.remove("serving-now");
  });

  const isServingSideLeft = match.teamACourtEnd === "LEFT" ? match.servingTeam === "A" : match.servingTeam === "B";

  if (isServingSideLeft) {
    if (isEven && rightBoxEl) rightBoxEl.classList.add("serving-now");
    if (!isEven && leftBoxEl) leftBoxEl.classList.add("serving-now");
  } else {
    if (isEven && oppRightBoxEl) oppRightBoxEl.classList.add("serving-now");
    if (!isEven && oppLeftBoxEl) oppLeftBoxEl.classList.add("serving-now");
  }
}

document.addEventListener("DOMContentLoaded", initUmpire);
