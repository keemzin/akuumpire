// Client Socket & Sound Manager

export const socket = window.io ? window.io({
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
  timeout: 3000
}) : null;

// Always wipe queued buffer on disconnect so stale offline clicks never phantom-fire
if (socket) {
  socket.on("disconnect", () => {
    if (socket.sendBuffer) socket.sendBuffer = [];
  });
}

// Lightweight Web Audio synthesizer for tactile umpire clicks
export function playScoreBeep(isSpecial = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isSpecial ? "triangle" : "sine";
    osc.frequency.setValueAtTime(isSpecial ? 880 : 587.33, ctx.currentTime); // A5 or D5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch (e) {
    // AudioContext blocked by browser autoplay policy until first gesture
  }
}

// Low-frequency alert tone + haptic pulse when actions are attempted while offline
export function playWarningBeep() {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([100, 60, 100]);
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, ctx.currentTime); // Low A3 alert tone
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.23);
  } catch (e) {
    // AudioContext blocked or not allowed
  }
}

// Toast notification helper
export function showToast(message, type = "info") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}
