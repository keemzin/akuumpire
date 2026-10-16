import { showToast } from "./socket.js";
import { setupCustomSelect } from "./dropdown.js";

const form = document.getElementById("create-match-form");
const matchTypeSelect = document.getElementById("match-type");
const rulePresetSelect = document.getElementById("rule-preset");
const doublesRows = document.querySelectorAll(".doubles-only");
const successModal = document.getElementById("success-modal");

// Initialize sleek dark custom dropdowns
if (matchTypeSelect) setupCustomSelect(matchTypeSelect);
if (rulePresetSelect) setupCustomSelect(rulePresetSelect);

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

/**
 * Smart-Shrink Image Helper (Client-side HTML5 Canvas)
 * Fits images up to 450px width and 180px height (accommodates both square badges and wide banners).
 * Auto-detects white/off-white background corners and flood-fills them to transparent alpha.
 * Compresses to ~15KB WebP.
 */
function smartShrinkImage(file, maxW = 450, maxH = 180) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return reject(new Error("Please select a valid image file."));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to load image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW || height > maxH) {
          const ratio = Math.min(maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        // Clear canvas for transparent PNG/WebP preservation
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Auto-Remove White/Light Background (Magic Keying)
        try {
          const imgData = ctx.getImageData(0, 0, width, height);
          const d = imgData.data;
          const visited = new Uint8Array(width * height);
          const queue = [];

          const corners = [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1]
          ];

          for (const [cx, cy] of corners) {
            const idx = (cy * width + cx) * 4;
            const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
            // If corner is opaque and near-white/light gray (common photo/JPG background)
            if (a > 100 && r > 215 && g > 215 && b > 215 && !visited[cy * width + cx]) {
              queue.push([cx, cy, r, g, b]);
              visited[cy * width + cx] = 1;
            }
          }

          if (queue.length > 0) {
            let head = 0;
            const tolerance = 38;
            while (head < queue.length) {
              const [x, y, tr, tg, tb] = queue[head++];
              const idx = (y * width + x) * 4;
              d[idx + 3] = 0; // Transparent!

              const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
              for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nPos = ny * width + nx;
                  if (!visited[nPos]) {
                    visited[nPos] = 1;
                    const nIdx = nPos * 4;
                    const nr = d[nIdx], ng = d[nIdx + 1], nb = d[nIdx + 2];
                    const diff = Math.sqrt((nr - tr)**2 + (ng - tg)**2 + (nb - tb)**2);
                    if (diff <= tolerance || (nr > 232 && ng > 232 && nb > 232)) {
                      queue.push([nx, ny, tr, tg, tb]);
                    }
                  }
                }
              }
            }
            ctx.putImageData(imgData, 0, 0);
          }
        } catch (autoTransErr) {
          console.warn("Auto-transparency skipped:", autoTransErr);
        }

        let dataUrl = canvas.toDataURL("image/webp", 0.9);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/png");
        }
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Wire up logo dropzone, smart shrink, preview, and async upload for a team block
 */
function setupLogoUploader(prefix) {
  const dropzone = document.getElementById(`${prefix}-logo-dropzone`);
  const input = document.getElementById(`${prefix}-logo-input`);
  const hiddenUrl = document.getElementById(`${prefix}-logo-url`);
  const previewBox = document.getElementById(`${prefix}-logo-preview`);
  const previewImg = document.getElementById(`${prefix}-logo-img`);
  const previewInfo = document.getElementById(`${prefix}-logo-info`);
  const removeBtn = document.getElementById(`${prefix}-logo-remove`);

  if (!dropzone || !input) return;

  dropzone.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      if (previewInfo) previewInfo.textContent = "Shrinking & uploading...";
      dropzone.style.display = "none";
      previewBox.style.display = "flex";

      // 1. Client-Side Smart Shrink (450px max width, 180px max height, preserves ratio & transparency)
      const shrunkDataUrl = await smartShrinkImage(file, 450, 180);
      previewImg.src = shrunkDataUrl;

      // 2. Upload to server
      const res = await fetch("/api/upload-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: shrunkDataUrl, team: prefix === "team-a" ? "teamA" : "teamB" })
      });

      if (!res.ok) {
        throw new Error("Upload request failed");
      }

      const { url } = await res.json();
      hiddenUrl.value = url;
      if (previewInfo) previewInfo.textContent = "✓ Optimized (Cloud)";
    } catch (err) {
      console.warn("Logo upload fallback:", err);
      // Fallback: Use client-shrunk dataUrl directly (only ~15KB)
      if (previewImg.src && previewImg.src.startsWith("data:image/")) {
        hiddenUrl.value = previewImg.src;
        if (previewInfo) previewInfo.textContent = "✓ Optimized (Local)";
      } else {
        dropzone.style.display = "flex";
        previewBox.style.display = "none";
        showToast("Could not process logo: " + err.message, "error");
      }
    }
  });

  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      input.value = "";
      hiddenUrl.value = "";
      previewImg.src = "";
      previewBox.style.display = "none";
      dropzone.style.display = "flex";
    });
  }
}

setupLogoUploader("team-a");
setupLogoUploader("team-b");

// Toggle info bubble on tap / click (great for mobile touch devices)
document.querySelectorAll(".info-bubble-wrap").forEach((wrap) => {
  const btn = wrap.querySelector(".info-bubble-btn");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isActive = wrap.classList.contains("active");
      document.querySelectorAll(".info-bubble-wrap").forEach(w => w.classList.remove("active"));
      if (!isActive) wrap.classList.add("active");
    });
  }
});

document.addEventListener("click", () => {
  document.querySelectorAll(".info-bubble-wrap").forEach(w => w.classList.remove("active"));
});

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
      teamALogo: document.getElementById("team-a-logo-url")?.value || null,
      teamAPlayer1: document.getElementById("team-a-player-1").value.trim() || "Player 1",
      teamAPlayer2: document.getElementById("team-a-player-2")?.value.trim() || null,

      teamBName: document.getElementById("team-b-name").value.trim() || "Team B",
      teamBLogo: document.getElementById("team-b-logo-url")?.value || null,
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
