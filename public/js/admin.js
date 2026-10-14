import { showToast } from "./socket.js";

const form = document.getElementById("create-match-form");
const matchTypeSelect = document.getElementById("match-type");
const doublesRows = document.querySelectorAll(".doubles-only");
const successModal = document.getElementById("success-modal");

// Toggle player 2 fields when match type changes
if (matchTypeSelect) {
  matchTypeSelect.addEventListener("change", () => {
    const isDoubles = ["MD", "WD", "XD"].includes(matchTypeSelect.value);
    doublesRows.forEach(row => {
      row.style.display = isDoubles ? "block" : "none";
      const input = row.querySelector("input");
      if (input) input.required = isDoubles;
    });
  });
}

// Custom rules panel toggle
const rulePresetSelect = document.getElementById("rule-preset");
const customRulesPanel = document.getElementById("custom-rules-panel");
const customPointsInput = document.getElementById("custom-points");
const customIntervalInput = document.getElementById("custom-interval");
const customCapInput = document.getElementById("custom-cap");
const customDeuceCheck = document.getElementById("custom-deuce");
const maxCapGroup = document.getElementById("max-cap-group");

if (rulePresetSelect && customRulesPanel) {
  rulePresetSelect.addEventListener("change", () => {
    customRulesPanel.style.display = rulePresetSelect.value === "CUSTOM" ? "block" : "none";
  });
}

if (customPointsInput && customIntervalInput) {
  customPointsInput.addEventListener("input", () => {
    const pts = parseInt(customPointsInput.value, 10) || 21;
    customIntervalInput.value = Math.max(1, Math.floor(pts / 2));
    if (customCapInput) customCapInput.value = pts + 9;
  });
}

if (customDeuceCheck && maxCapGroup) {
  customDeuceCheck.addEventListener("change", () => {
    maxCapGroup.style.display = customDeuceCheck.checked ? "block" : "none";
  });
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating Court...";
    }

    const presetVal = document.getElementById("rule-preset").value;
    const payload = {
      venue: document.getElementById("venue").value.trim() || "Arena Hall",
      court: document.getElementById("court").value.trim() || "Court 1",
      matchType: matchTypeSelect.value,
      preset: presetVal,
      
      teamAName: document.getElementById("team-a-name").value.trim() || "Team A",
      teamAPlayer1: document.getElementById("team-a-player-1").value.trim() || "Player 1",
      teamAPlayer2: document.getElementById("team-a-player-2")?.value.trim() || null,

      teamBName: document.getElementById("team-b-name").value.trim() || "Team B",
      teamBPlayer1: document.getElementById("team-b-player-1").value.trim() || "Player 1",
      teamBPlayer2: document.getElementById("team-b-player-2")?.value.trim() || null,

      startingServerTeam: document.querySelector('input[name="starting-server"]:checked')?.value || "A",
      customPin: document.getElementById("custom-pin")?.value.trim() || null
    };

    if (presetVal === "CUSTOM") {
      payload.customRules = {
        pointsPerSet: parseInt(customPointsInput.value, 10) || 21,
        setsToWin: parseInt(document.querySelector('input[name="custom-sets"]:checked')?.value, 10) || 2,
        hasDeuce: customDeuceCheck ? customDeuceCheck.checked : true,
        maxPointsCap: parseInt(customCapInput.value, 10) || 30,
        intervalAt: parseInt(customIntervalInput.value, 10) || 11
      };
    }

    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create match");
      }

      const created = await res.json();

      // Store credentials locally for instant friction-free access on this device
      localStorage.setItem(`shuttle_token_${created.id}`, created.adminToken);
      localStorage.setItem(`shuttle_pin_${created.id}`, created.adminPin);

      showCreatedSuccess(created);
    } catch (err) {
      showToast(err.message, "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Match & Generate PIN";
      }
    }
  });
}

function showCreatedSuccess(data) {
  const pinDisplay = document.getElementById("display-pin");
  const spectatorLinkInput = document.getElementById("spectator-link");
  const umpireLinkInput = document.getElementById("umpire-link");
  const goUmpireBtn = document.getElementById("go-umpire-btn");
  const goSpectatorBtn = document.getElementById("go-spectator-btn");

  const origin = window.location.origin;
  const specUrl = `${origin}/match/${data.id}`;
  const umpUrl = `${origin}/umpire/${data.id}?token=${data.adminToken}`;

  if (pinDisplay) pinDisplay.textContent = data.adminPin;
  if (spectatorLinkInput) spectatorLinkInput.value = specUrl;
  if (umpireLinkInput) umpireLinkInput.value = umpUrl;

  if (goUmpireBtn) goUmpireBtn.href = `/umpire/${data.id}?token=${data.adminToken}`;
  if (goSpectatorBtn) goSpectatorBtn.href = `/match/${data.id}`;

  successModal.classList.add("active");
}

// Copy link buttons
document.querySelectorAll(".copy-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value);
      showToast("Link copied to clipboard!", "success");
    }
  });
});
