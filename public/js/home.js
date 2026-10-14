import { socket, showToast } from "./socket.js";

const matchesGrid = document.getElementById("matches-grid");
const searchInput = document.getElementById("search-input");
const filterSelect = document.getElementById("filter-venue");
const emptyState = document.getElementById("empty-state");
const liveCountEl = document.getElementById("live-count");

let allMatches = [];

async function fetchMatches() {
  try {
    const res = await fetch("/api/matches");
    allMatches = await res.json();
    renderMatches();
    updateVenueFilter();
  } catch (err) {
    console.error("Failed to fetch matches:", err);
    showToast("Error loading matches", "error");
  }
}

function updateVenueFilter() {
  if (!filterSelect) return;
  const currentVal = filterSelect.value;
  const venues = Array.from(new Set(allMatches.map(m => m.venue).filter(Boolean)));
  
  filterSelect.innerHTML = `<option value="ALL">All Venues</option>`;
  venues.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    filterSelect.appendChild(opt);
  });
  filterSelect.value = venues.includes(currentVal) ? currentVal : "ALL";
}

function renderMatches() {
  if (!matchesGrid) return;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const selectedVenue = filterSelect?.value || "ALL";

  const filtered = allMatches.filter(m => {
    const matchesVenue = selectedVenue === "ALL" || m.venue === selectedVenue;
    const matchText = `${m.court} ${m.venue} ${m.teamA.name} ${m.teamA.player1} ${m.teamA.player2 || ""} ${m.teamB.name} ${m.teamB.player1} ${m.teamB.player2 || ""}`.toLowerCase();
    const matchesSearch = !query || matchText.includes(query);
    return matchesVenue && matchesSearch;
  });

  if (liveCountEl) {
    const activeCount = allMatches.filter(m => m.status === "IN_PROGRESS" || m.status === "INTERVAL" || m.status === "SET_ENDED").length;
    liveCountEl.textContent = `${activeCount} Active ${activeCount === 1 ? 'Court' : 'Courts'}`;
  }

  if (filtered.length === 0) {
    matchesGrid.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  matchesGrid.innerHTML = filtered.map(m => {
    const isLive = m.status === "IN_PROGRESS" || m.status === "INTERVAL" || m.status === "SET_ENDED";
    const isFinished = m.status === "FINISHED";
    const isWinnerA = isFinished && m.winner === "A";
    const isWinnerB = isFinished && m.winner === "B";
    const winnerName = isWinnerA ? m.teamA.name : (isWinnerB ? m.teamB.name : null);

    const statusBadge = isLive 
      ? `<span class="badge badge-live">Live</span>` 
      : isFinished 
      ? `<span class="badge badge-gold">Ended</span>` 
      : `<span class="badge badge-ended">Warm-up</span>`;

    const teamAPlayers = m.teamA.player2 ? `${m.teamA.player1} & ${m.teamA.player2}` : m.teamA.player1;
    const teamBPlayers = m.teamB.player2 ? `${m.teamB.player1} & ${m.teamB.player2}` : m.teamB.player1;

    const metaSummary = isFinished
      ? `Final (${m.teamA.setsWon} - ${m.teamB.setsWon})`
      : `Set ${m.currentSet} (${m.teamA.setsWon} - ${m.teamB.setsWon})`;

    const formatTag = m.rules?.shortName || (m.rules?.setsToWin > 1 ? 'Bo3 to 21' : '1 Set');

    return `
      <div class="match-card ${isFinished ? 'match-ended' : ''}" data-id="${m.id}">
        <div class="match-card-header">
          <div class="court-tag">
            <span class="court-dot ${isFinished ? 'ended' : ''}"></span>
            <strong>${escapeHtml(m.court)}</strong>
            <span class="venue-sub">• ${escapeHtml(m.venue)}</span>
          </div>
          ${statusBadge}
        </div>

        <div class="match-scoreboard-preview">
          <!-- Team A -->
          <div class="preview-team-row ${isWinnerA ? 'winner-row' : ''} ${isWinnerB ? 'defeated-row' : ''} ${m.servingTeam === 'A' && isLive ? 'serving' : ''}">
            <div class="team-info-box">
              <span class="team-code ${isWinnerA ? 'winner-code' : ''}">${escapeHtml(m.teamA.name)}</span>
              <span class="player-names ${isWinnerA ? 'winner-name' : ''}" title="${escapeHtml(teamAPlayers)}">
                ${escapeHtml(teamAPlayers)}
                ${isWinnerA ? '<span class="mini-trophy" title="Winner">🏆</span>' : ''}
              </span>
              ${m.servingTeam === 'A' && isLive ? '<span class="mini-shuttle" title="Serving">🏸</span>' : ''}
            </div>
            <div class="team-score-num ${isWinnerA ? 'winner-score' : ''}">${m.currentScore.teamA}</div>
          </div>

          <!-- Team B -->
          <div class="preview-team-row ${isWinnerB ? 'winner-row' : ''} ${isWinnerA ? 'defeated-row' : ''} ${m.servingTeam === 'B' && isLive ? 'serving' : ''}">
            <div class="team-info-box">
              <span class="team-code ${isWinnerB ? 'winner-code' : ''}">${escapeHtml(m.teamB.name)}</span>
              <span class="player-names ${isWinnerB ? 'winner-name' : ''}" title="${escapeHtml(teamBPlayers)}">
                ${escapeHtml(teamBPlayers)}
                ${isWinnerB ? '<span class="mini-trophy" title="Winner">🏆</span>' : ''}
              </span>
              ${m.servingTeam === 'B' && isLive ? '<span class="mini-shuttle" title="Serving">🏸</span>' : ''}
            </div>
            <div class="team-score-num ${isWinnerB ? 'winner-score' : ''}">${m.currentScore.teamB}</div>
          </div>
        </div>

        <div class="match-card-footer">
          <div class="match-meta-info">
            <span class="set-indicator" style="${isFinished ? 'color: var(--accent-gold); font-weight: 700;' : ''}">${metaSummary}</span>
          </div>
          <div class="card-btn-group">
            <a href="/match/${m.id}" class="btn btn-secondary btn-sm">${isFinished ? 'Scoreboard' : 'Watch TV'}</a>
            <button class="btn ${isFinished ? 'btn-secondary' : 'btn-primary'} btn-sm open-umpire-pin-btn" data-id="${m.id}" data-court="${escapeHtml(m.court)}">
              ${isFinished ? 'Admin' : 'Umpire'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  attachCardEvents();
}

function attachCardEvents() {
  document.querySelectorAll(".open-umpire-pin-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const matchId = btn.dataset.id;
      const courtName = btn.dataset.court;
      openUmpirePinModal(matchId, courtName);
    });
  });
}

function openUmpirePinModal(matchId, courtName) {
  // Check if token exists in localStorage
  const savedToken = localStorage.getItem(`shuttle_token_${matchId}`);
  if (savedToken) {
    window.location.href = `/umpire/${matchId}?token=${savedToken}`;
    return;
  }

  const modal = document.getElementById("pin-modal");
  const modalCourt = document.getElementById("modal-court-name");
  const pinInput = document.getElementById("pin-input");
  const targetIdInput = document.getElementById("pin-match-id");

  if (modalCourt) modalCourt.textContent = courtName;
  if (targetIdInput) targetIdInput.value = matchId;
  if (pinInput) {
    pinInput.value = "";
    setTimeout(() => pinInput.focus(), 100);
  }

  modal.classList.add("active");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Socket updates for real-time live landing page!
if (socket) {
  socket.on("matches:list_updated", (updatedList) => {
    allMatches = updatedList;
    renderMatches();
    updateVenueFilter();
  });
}

// Modal handling
document.addEventListener("DOMContentLoaded", () => {
  fetchMatches();

  if (searchInput) searchInput.addEventListener("input", renderMatches);
  if (filterSelect) filterSelect.addEventListener("change", renderMatches);

  const modal = document.getElementById("pin-modal");
  const closeBtn = document.getElementById("close-pin-modal");
  const pinForm = document.getElementById("pin-form");

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => modal.classList.remove("active"));
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("active");
    });
  }

  if (pinForm) {
    pinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const matchId = document.getElementById("pin-match-id").value;
      const pin = document.getElementById("pin-input").value.trim();

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
          showToast("Invalid Match PIN. Please re-check.", "error");
        }
      } catch (err) {
        showToast("Error verifying PIN", "error");
      }
    });
  }
});
