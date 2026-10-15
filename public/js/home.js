import { socket, showToast } from "./socket.js";
import { setupCustomSelect, refreshCustomSelect } from "./dropdown.js";

const matchesGrid = document.getElementById("matches-grid");
const searchInput = document.getElementById("search-input");
const filterSelect = document.getElementById("filter-venue");
const emptyState = document.getElementById("empty-state");
const liveCountEl = document.getElementById("live-count");

let allMatches = [];
let currentTab = "LIVE";

function getMatchDurationMinutes(start, end) {
  if (!start) return 15;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diffMins = Math.max(1, Math.round((e - s) / 60000));
  return diffMins;
}

function updateTabCounts() {
  const liveMatches = allMatches.filter(m => m.status !== "FINISHED" && m.status !== "ABANDONED");
  const endedMatches = allMatches.filter(m => m.status === "FINISHED" || m.status === "ABANDONED");

  const tabLive = document.getElementById("tab-count-live");
  const tabEnded = document.getElementById("tab-count-ended");
  const tabAll = document.getElementById("tab-count-all");

  if (tabLive) tabLive.textContent = liveMatches.length;
  if (tabEnded) tabEnded.textContent = endedMatches.length;
  if (tabAll) tabAll.textContent = allMatches.length;

  if (liveCountEl) {
    const activeCount = liveMatches.length;
    liveCountEl.textContent = `${activeCount} Active ${activeCount === 1 ? 'Court' : 'Courts'}`;
  }
}

async function fetchMatches() {
  try {
    const res = await fetch("/api/matches");
    allMatches = await res.json();
    updateTabCounts();
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

  setupCustomSelect(filterSelect);
  refreshCustomSelect(filterSelect);
}

function renderMatches() {
  if (!matchesGrid) return;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const selectedVenue = filterSelect?.value || "ALL";

  const filtered = allMatches.filter(m => {
    // Tab filter
    if (currentTab === "LIVE" && (m.status === "FINISHED" || m.status === "ABANDONED")) return false;
    if (currentTab === "ENDED" && !(m.status === "FINISHED" || m.status === "ABANDONED")) return false;

    // Venue filter
    const matchesVenue = selectedVenue === "ALL" || m.venue === selectedVenue;
    
    // Search query
    const matchText = `${m.court} ${m.venue} ${m.teamA.name} ${m.teamA.player1} ${m.teamA.player2 || ""} ${m.teamB.name} ${m.teamB.player1} ${m.teamB.player2 || ""}`.toLowerCase();
    const matchesSearch = !query || matchText.includes(query);
    return matchesVenue && matchesSearch;
  });

  if (filtered.length === 0) {
    matchesGrid.innerHTML = "";
    if (emptyState) {
      emptyState.style.display = "block";
      const emptyTitle = emptyState.querySelector("h3");
      const emptyDesc = emptyState.querySelector("p");
      if (emptyTitle && emptyDesc) {
        if (currentTab === "LIVE") {
          emptyTitle.textContent = "No live ongoing matches right now";
          emptyDesc.textContent = "Courts are currently free. Register a new match to start scoring!";
        } else if (currentTab === "ENDED") {
          emptyTitle.textContent = "No completed matches in history yet";
          emptyDesc.textContent = "As matches wrap up on court, their final scorecards will appear here.";
        } else {
          emptyTitle.textContent = "No matches found";
          emptyDesc.textContent = "Try searching for a different court, player, or venue.";
        }
      }
    }
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  matchesGrid.innerHTML = filtered.map(m => {
    const isLive = m.status === "IN_PROGRESS" || m.status === "INTERVAL" || m.status === "SET_ENDED";
    const isFinished = m.status === "FINISHED";
    const isAbandoned = m.status === "ABANDONED";
    const isWinnerA = isFinished && m.winner === "A";
    const isWinnerB = isFinished && m.winner === "B";

    const idleMins = Math.max(0, Math.floor((Date.now() - new Date(m.updatedAt || m.createdAt).getTime()) / 60000));
    const isIdle = isLive && idleMins >= 15;

    const statusBadge = isAbandoned
      ? `<span class="badge badge-abandoned" title="${escapeHtml(m.endedReason || 'Abandoned')}">Abandoned</span>`
      : isFinished 
      ? `<span class="badge badge-gold">Ended</span>` 
      : isIdle
      ? `<span class="badge badge-idle" title="Court idle for ${idleMins} minutes without score update">⏸️ Idle (${idleMins}m)</span>`
      : isLive 
      ? `<span class="badge badge-live">Live</span>` 
      : `<span class="badge badge-ended">Warm-up</span>`;

    const teamAPlayers = m.teamA.player2 ? `${m.teamA.player1} & ${m.teamA.player2}` : m.teamA.player1;
    const teamBPlayers = m.teamB.player2 ? `${m.teamB.player1} & ${m.teamB.player2}` : m.teamB.player1;

    const durationMins = getMatchDurationMinutes(m.createdAt, m.finishedAt || m.updatedAt);
    let metaSummary = "";
    let infoBadge = "";

    if (isAbandoned) {
      metaSummary = `Abandoned • ⏱️ ${durationMins}m`;
    } else if (isFinished) {
      metaSummary = `Final (${m.teamA.setsWon} - ${m.teamB.setsWon}) • ⏱️ ${durationMins}m`;
    } else {
      metaSummary = `Set ${m.currentSet} (${m.teamA.setsWon} - ${m.teamB.setsWon})`;
    }

    const formatName = m.rules?.name || (m.rules?.setsToWin > 1 ? 'BWF Standard (Best of 3 to 21)' : 'Single Set to 21');
    const hasSetsHistory = m.setsHistory && m.setsHistory.length > 0;
    const hasEndedReason = Boolean(m.endedReason);

    if (isFinished || isAbandoned || hasSetsHistory || hasEndedReason) {
      let tooltipContent = `
        <div style="font-weight: 700; color: #fff; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 3px; font-size: 0.78rem;">
          ${escapeHtml(formatName)}
        </div>
      `;

      if (hasSetsHistory) {
        tooltipContent += `
          <div class="tooltip-sets" style="margin-top: 4px;">
            <div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 2px;">Set Breakdown</div>
            ${m.setsHistory.map(s => `<div>Set ${s.set}: <strong>${s.teamA} - ${s.teamB}</strong></div>`).join('')}
          </div>
        `;
      }

      if (hasEndedReason) {
        tooltipContent += `
          <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); color: #fca5a5; font-size: 0.72rem;">
            <strong>Note:</strong> ${escapeHtml(m.endedReason)}
          </div>
        `;
      }

      infoBadge = `
        <span class="info-icon-badge" tabindex="0" role="button" aria-label="Match Information">
          ℹ
          <span class="info-tooltip-text">${tooltipContent}</span>
        </span>
      `;
    }

    const formatTag = m.rules?.shortName || (m.rules?.setsToWin > 1 ? 'Bo3 to 21' : '1 Set');

    return `
      <div class="match-card ${isFinished || isAbandoned ? 'match-ended' : ''}" data-id="${m.id}">
        <div class="match-card-header">
          <div class="court-tag">
            <span class="court-dot ${isFinished || isAbandoned ? 'ended' : ''}"></span>
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
            <span class="set-indicator" style="${isFinished ? 'color: var(--accent-gold); font-weight: 700;' : isAbandoned ? 'color: #f87171; font-weight: 700;' : ''}">${metaSummary}</span>
            ${infoBadge}
          </div>
          <div class="card-btn-group">
            <a href="/match/${m.id}" class="btn btn-secondary btn-sm">${isFinished || isAbandoned ? 'Scoreboard' : 'Watch TV'}</a>
            <button class="btn ${isFinished || isAbandoned ? 'btn-secondary' : 'btn-primary'} btn-sm open-umpire-pin-btn" data-id="${m.id}" data-court="${escapeHtml(m.court)}">
              ${isFinished || isAbandoned ? 'Admin' : 'Umpire'}
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

  // Tap/click to toggle info tooltip on mobile or desktop
  document.querySelectorAll(".info-icon-badge").forEach(badge => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = badge.classList.contains("active");
      document.querySelectorAll(".info-icon-badge.active").forEach(b => b.classList.remove("active"));
      if (!isActive) badge.classList.add("active");
    });
  });

  // Clicking anywhere else dismisses open tooltips
  if (!window._infoBadgeDismissRegistered) {
    document.addEventListener("click", () => {
      document.querySelectorAll(".info-icon-badge.active").forEach(b => b.classList.remove("active"));
    });
    window._infoBadgeDismissRegistered = true;
  }
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
    updateTabCounts();
    renderMatches();
    updateVenueFilter();
  });
}

// Modal handling
document.addEventListener("DOMContentLoaded", () => {
  fetchMatches();

  // Tab switching (Live vs Past Results vs All)
  const tabBtns = document.querySelectorAll(".tab-pill-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      renderMatches();
    });
  });

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
