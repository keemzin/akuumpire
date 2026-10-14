import { socket, showToast, playScoreBeep } from "./socket.js";

const pathParts = window.location.pathname.split("/").filter(Boolean);
const matchId = pathParts[1] || new URLSearchParams(window.location.search).get("id");

const queryParams = new URLSearchParams(window.location.search);
let adminToken = queryParams.get("token") || localStorage.getItem(`shuttle_token_${matchId}`);
let adminPin = localStorage.getItem(`shuttle_pin_${matchId}`);

let currentMatch = null;

async function initUmpire() {
  if (!matchId) {
    showToast("Invalid match ID", "error");
    return;
  }

  // If no token in URL or storage, show prompt
  if (!adminToken) {
    promptForPin();
    return;
  }

  try {
    const res = await fetch(`/api/matches/${matchId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinOrToken: adminToken })
    });

    if (!res.ok) {
      throw new Error("Invalid or expired session");
    }

    const authData = await res.json();
    adminPin = authData.adminPin;
    adminToken = authData.adminToken;
    localStorage.setItem(`shuttle_token_${matchId}`, adminToken);
    localStorage.setItem(`shuttle_pin_${matchId}`, adminPin);

    // Connected & verified!
    setupUmpireConsole(authData.matchState);

    // Socket sync
    if (socket) {
      socket.emit("match:join", { matchId });
      socket.on("match:updated", (updated) => {
        updateConsoleUI(updated);
      });
    }
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
        const res = await fetch(`/api/matches/${matchId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinOrToken: entered })
        });

        if (!res.ok) throw new Error("Incorrect Match PIN");

        const authData = await res.json();
        adminToken = authData.adminToken;
        adminPin = authData.adminPin;
        localStorage.setItem(`shuttle_token_${matchId}`, adminToken);
        localStorage.setItem(`shuttle_pin_${matchId}`, adminPin);

        modal.classList.remove("active");
        setupUmpireConsole(authData.matchState);

        if (socket) {
          socket.emit("match:join", { matchId });
          socket.on("match:updated", (updated) => updateConsoleUI(updated));
        }
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

  updateConsoleUI(initialState);
}

function scorePoint(team) {
  if (!currentMatch || currentMatch.status === "FINISHED") {
    showToast("Match has finished", "warning");
    return;
  }

  playScoreBeep(false);

  if (socket) {
    socket.emit("match:point", {
      matchId,
      scoringTeam: team,
      pinOrToken: adminToken
    });
  }
}

function undoPoint() {
  playScoreBeep(true);
  if (socket) {
    socket.emit("match:undo", {
      matchId,
      pinOrToken: adminToken
    });
  }
}

function nextSet() {
  if (socket) {
    socket.emit("match:next_set", {
      matchId,
      pinOrToken: adminToken
    });
  }
}

function swapEnds() {
  if (socket) {
    socket.emit("match:swap_ends", {
      matchId,
      pinOrToken: adminToken
    });
  }
}

function switchServe() {
  if (socket) {
    socket.emit("match:switch_serve", {
      matchId,
      pinOrToken: adminToken
    });
  }
}

function resumeInterval() {
  if (socket) {
    socket.emit("match:resume_interval", {
      matchId,
      pinOrToken: adminToken
    });
  }
}

function updateConsoleUI(match) {
  currentMatch = match;

  // Header
  const courtBadge = document.getElementById("umpire-court-title");
  const matchStatus = document.getElementById("umpire-match-status");
  const pinBadge = document.getElementById("umpire-pin-tag");

  if (courtBadge) courtBadge.textContent = `${match.court} (${match.venue})`;
  if (pinBadge && adminPin) pinBadge.textContent = `PIN: ${adminPin}`;
  if (matchStatus) matchStatus.textContent = `Set ${match.currentSet} • ${match.status.replace("_", " ")}`;

  // Pad A
  const padA = document.getElementById("pad-team-a");
  const nameA = document.getElementById("pad-team-a-name");
  const subA = document.getElementById("pad-team-a-sub");
  const scoreA = document.getElementById("pad-score-a");

  const isServingA = match.servingTeam === "A";
  if (padA) padA.classList.toggle("serving-side", isServingA);
  if (nameA) nameA.textContent = match.teamA.name;
  if (subA) subA.textContent = match.teamA.player2 ? `${match.teamA.player1} & ${match.teamA.player2}` : match.teamA.player1;
  if (scoreA) scoreA.textContent = match.currentScore.teamA;

  // Pad B
  const padB = document.getElementById("pad-team-b");
  const nameB = document.getElementById("pad-team-b-name");
  const subB = document.getElementById("pad-team-b-sub");
  const scoreB = document.getElementById("pad-score-b");

  const isServingB = match.servingTeam === "B";
  if (padB) padB.classList.toggle("serving-side", isServingB);
  if (nameB) nameB.textContent = match.teamB.name;
  if (subB) subB.textContent = match.teamB.player2 ? `${match.teamB.player1} & ${match.teamB.player2}` : match.teamB.player1;
  if (scoreB) scoreB.textContent = match.currentScore.teamB;

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
