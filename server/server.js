import express from "express";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import cors from "cors";
import { Server } from "socket.io";
import { matchStore } from "./models/matchStore.js";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch (e) {
    // Ignore if .env doesn't exist
  }
}
import {
  MATCH_TYPES,
  RULE_PRESETS,
  addPoint,
  undoLastPoint,
  startNextSet,
  switchServingTeam,
  switchCourtEnds,
  resumeFromInterval,
  concludeMatchEarly,
  abandonMatch
} from "./rules/badmintonRules.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(process.cwd(), "public");

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUBLIC_DIR));

// Friendly URL routes
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/match/:id", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "match.html"));
});

app.get("/umpire/:id", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "umpire.html"));
});

app.get("/superadmin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "superadmin.html"));
});

// ==========================================
// REST API
// ==========================================

// Preset configurations (types, rules)
app.get("/api/meta", (req, res) => {
  res.json({
    matchTypes: MATCH_TYPES,
    rulePresets: RULE_PRESETS
  });
});

// List all matches
app.get("/api/matches", (req, res) => {
  res.json(matchStore.listPublicMatches());
});

// Create new match (100% free, generates 4-digit PIN + token)
app.post("/api/matches", (req, res) => {
  try {
    const result = matchStore.createMatch(req.body);
    // Broadcast to landing pages that a new match was created
    io.emit("matches:list_updated", matchStore.listPublicMatches());
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single match public state
app.get("/api/matches/:id", (req, res) => {
  const match = matchStore.getPublicMatch(req.params.id);
  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }
  res.json(match);
});

// Verify PIN / Token
app.post("/api/matches/:id/verify", (req, res) => {
  const { pinOrToken } = req.body;
  const valid = matchStore.verifyAdmin(req.params.id, pinOrToken);
  if (!valid) {
    return res.status(401).json({ valid: false, error: "Invalid PIN or Token" });
  }

  const raw = matchStore.getRawRecord(req.params.id);
  res.json({
    valid: true,
    adminPin: raw.adminPin,
    adminToken: raw.adminToken,
    matchState: matchStore.getPublicMatch(req.params.id)
  });
});

// Upload Team / Tournament Logo (Smart-Shrunk on client, stored in Supabase or local disk)
app.post("/api/upload-logo", async (req, res) => {
  try {
    const { image, team } = req.body;
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Invalid image data" });
    }

    const matches = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid data URL format" });
    }

    let ext = matches[1].toLowerCase();
    if (ext === "jpeg") ext = "jpg";
    const buffer = Buffer.from(matches[2], "base64");

    // Guardrail: Max 500KB after shrink
    if (buffer.length > 500 * 1024) {
      return res.status(400).json({ error: "Image too large (must be under 500KB)" });
    }

    const safePrefix = team === "teamB" ? "teamB" : "teamA";
    const fileName = `${safePrefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
    const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

    // 1. Try Supabase Storage if configured
    if (matchStore.supabase) {
      try {
        const { data, error } = await matchStore.supabase.storage
          .from("logos")
          .upload(fileName, buffer, {
            contentType,
            upsert: true
          });

        if (!error && data?.path) {
          const { data: publicUrlData } = matchStore.supabase.storage
            .from("logos")
            .getPublicUrl(data.path);

          if (publicUrlData?.publicUrl) {
            return res.json({ url: publicUrlData.publicUrl });
          }
        }
        if (error) {
          console.warn("⚠️  [Supabase Storage] Upload error, falling back to local file:", error.message);
        }
      } catch (sbErr) {
        console.warn("⚠️  [Supabase Storage] Exception, falling back to local file:", sbErr.message);
      }
    }

    // 2. Fallback: Save to local public/uploads/logos/ directory
    const uploadsDir = path.resolve(process.cwd(), "public", "uploads", "logos");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, buffer);

    return res.json({ url: `/uploads/logos/${fileName}` });
  } catch (err) {
    console.error("Error uploading logo:", err);
    return res.status(500).json({ error: "Failed to upload logo" });
  }
});

// Delete match
app.delete("/api/matches/:id", (req, res) => {
  const pinOrToken = req.headers["x-admin-token"] || req.query.token || req.body.token;
  if (!matchStore.verifyAdmin(req.params.id, pinOrToken)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  matchStore.deleteMatch(req.params.id);
  io.to(`match:${req.params.id}`).emit("match:deleted", { matchId: req.params.id });
  io.emit("matches:list_updated", matchStore.listPublicMatches());
  res.json({ success: true });
});

// ==========================================
// SUPER ADMIN SECURITY & AUTHENTICATION
// ==========================================
// Supports arbitrary length: SUPERADMIN_PASSWORD, SUPERADMIN_KEY, or legacy SUPERADMIN_PIN
const SUPERADMIN_SECRET = process.env.SUPERADMIN_PASSWORD || 
                          process.env.SUPERADMIN_KEY || 
                          process.env.SUPERADMIN_PIN || 
                          "9999";

// Timing-safe constant-time string comparison via SHA-256 (safe for any length)
function timingSafeVerify(input, target) {
  if (typeof input !== "string" || typeof target !== "string") return false;
  const a = crypto.createHash("sha256").update(input.trim()).digest();
  const b = crypto.createHash("sha256").update(target.trim()).digest();
  return crypto.timingSafeEqual(a, b);
}

// Active session token store: token -> { expiresAt }
const superadminSessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Brute-force protection & rate limiting per IP
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15-minute lockout

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function checkSuperAdmin(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = req.headers["x-superadmin-token"] || 
                req.headers["x-superadmin-pin"] || 
                req.query.superadminPin || 
                req.body?.superadminPin ||
                (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Missing Super Admin credentials" });
  }

  // 1. Check if token is an active authenticated session
  const session = superadminSessions.get(token);
  if (session) {
    if (Date.now() < session.expiresAt) {
      return next();
    } else {
      superadminSessions.delete(token);
    }
  }

  // 2. Direct master key fallback (for scripts / cURL / automation)
  if (timingSafeVerify(token, SUPERADMIN_SECRET)) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized: Invalid or expired Super Admin credentials" });
}

// Verify Super Admin credentials and issue temporary session token with brute-force lockout
app.post("/api/superadmin/auth", (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // Check lockout
  const attemptInfo = loginAttempts.get(ip);
  if (attemptInfo && attemptInfo.lockedUntil && now < attemptInfo.lockedUntil) {
    const remainingMins = Math.ceil((attemptInfo.lockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Too many failed attempts. Locked out for ${remainingMins} more minute${remainingMins === 1 ? '' : 's'}.`
    });
  }

  const { pin, password, secret } = req.body;
  const inputSecret = String(secret || password || pin || "");

  if (timingSafeVerify(inputSecret, SUPERADMIN_SECRET)) {
    // Reset failed attempts on success
    loginAttempts.delete(ip);

    // Issue cryptographic random session token (never stores master secret in browser)
    const token = "sa_" + crypto.randomBytes(32).toString("hex");
    const expiresAt = now + SESSION_TTL_MS;
    superadminSessions.set(token, { expiresAt });

    return res.json({
      success: true,
      token,
      expiresAt,
      message: "Super Admin authorized"
    });
  } else {
    // Increment failed attempts
    const count = (attemptInfo ? attemptInfo.count : 0) + 1;
    let lockedUntil = null;
    if (count >= MAX_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS;
      loginAttempts.set(ip, { count, lockedUntil });
      return res.status(429).json({
        error: "Too many failed attempts. Locked out for 15 minutes."
      });
    }

    loginAttempts.set(ip, { count, lockedUntil: null });
    const remaining = MAX_ATTEMPTS - count;
    return res.status(401).json({
      error: `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before 15m lockout.`
    });
  }
});

// Logout session endpoint
app.post("/api/superadmin/logout", (req, res) => {
  const token = req.headers["x-superadmin-token"] || 
                (req.headers["authorization"]?.startsWith("Bearer ") ? req.headers["authorization"].slice(7).trim() : null);
  if (token) {
    superadminSessions.delete(token);
  }
  res.json({ success: true, message: "Logged out successfully" });
});

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of superadminSessions.entries()) {
    if (now >= s.expiresAt) superadminSessions.delete(t);
  }
}, 60 * 60 * 1000).unref();

// List all matches with full admin metadata & idle counters
app.get("/api/superadmin/matches", checkSuperAdmin, (req, res) => {
  res.json(matchStore.listAllRecordsForAdmin());
});

// Trigger AFK / Stale match reaper on demand
app.post("/api/superadmin/reap", checkSuperAdmin, (req, res) => {
  const modified = matchStore.reapStaleMatches();
  if (modified) {
    io.emit("matches:list_updated", matchStore.listPublicMatches());
  }
  res.json({ success: true, modified, matches: matchStore.listAllRecordsForAdmin() });
});

// Force delete any match
app.delete("/api/superadmin/matches/:id", checkSuperAdmin, (req, res) => {
  const id = req.params.id;
  const existed = matchStore.deleteMatch(id);
  if (existed) {
    io.to(`match:${id}`).emit("match:deleted", { matchId: id });
    io.emit("matches:list_updated", matchStore.listPublicMatches());
  }
  res.json({ success: true, id, existed });
});

// Force conclude or force abandon any match
app.post("/api/superadmin/matches/:id/action", checkSuperAdmin, (req, res) => {
  const { action, reason } = req.body;
  const id = req.params.id;
  const raw = matchStore.getRawRecord(id);
  if (!raw) return res.status(404).json({ error: "Match not found" });

  if (action === "ABANDON") {
    abandonMatch(raw.matchState, reason || "Abandoned by Super Admin");
  } else if (action === "CONCLUDE") {
    concludeMatchEarly(raw.matchState, reason || "Concluded by Super Admin");
  }
  const updated = matchStore.updateMatchState(id, raw.matchState);
  io.to(`match:${id}`).emit("match:updated", updated);
  io.emit("matches:list_updated", matchStore.listPublicMatches());
  res.json({ success: true, matchState: updated });
});

// Reset demo matches to fresh live action
app.post("/api/superadmin/reset-demos", checkSuperAdmin, (req, res) => {
  matchStore.resetDemoMatches();
  io.emit("matches:list_updated", matchStore.listPublicMatches());
  res.json({ success: true, message: "Demo courts reset to live action" });
});

// Purge all ended / abandoned match history
app.post("/api/superadmin/purge-history", checkSuperAdmin, (req, res) => {
  const count = matchStore.purgeHistory();
  io.emit("matches:list_updated", matchStore.listPublicMatches());
  res.json({ success: true, deletedCount: count });
});

// ==========================================
// REAL-TIME WEBSOCKETS (Socket.io)
// ==========================================

io.on("connection", (socket) => {
  // Join a match room
  socket.on("match:join", ({ matchId }) => {
    socket.join(`match:${matchId}`);
    const match = matchStore.getPublicMatch(matchId);
    if (match) {
      socket.emit("match:updated", match);
    }
  });

  // Leave room
  socket.on("match:leave", ({ matchId }) => {
    socket.leave(`match:${matchId}`);
  });

  // Helper to handle authenticated umpire actions
  const handleUmpireAction = (data, actionFn) => {
    const { matchId, pinOrToken } = data;
    if (!matchStore.verifyAdmin(matchId, pinOrToken)) {
      socket.emit("error", { message: "Invalid credentials for this match" });
      return;
    }

    const raw = matchStore.getRawRecord(matchId);
    if (!raw) return;

    actionFn(raw.matchState);
    const updated = matchStore.updateMatchState(matchId, raw.matchState);

    // Broadcast updated score to all spectators and umpires on this match
    io.to(`match:${matchId}`).emit("match:updated", updated);
    // Notify landing page match list
    io.emit("matches:list_updated", matchStore.listPublicMatches());
  };

  // Umpire tapped score (+1 Team A or +1 Team B)
  socket.on("match:point", (data) => {
    handleUmpireAction(data, (state) => {
      addPoint(state, data.scoringTeam);
    });
  });

  // Umpire tapped Undo
  socket.on("match:undo", (data) => {
    handleUmpireAction(data, (state) => {
      undoLastPoint(state);
    });
  });

  // Umpire tapped Start Next Set
  socket.on("match:next_set", (data) => {
    handleUmpireAction(data, (state) => {
      startNextSet(state);
    });
  });

  // Umpire manual serve switch
  socket.on("match:switch_serve", (data) => {
    handleUmpireAction(data, (state) => {
      switchServingTeam(state);
    });
  });

  // Umpire manual court ends switch
  socket.on("match:swap_ends", (data) => {
    handleUmpireAction(data, (state) => {
      switchCourtEnds(state);
    });
  });

  // Resume from 11-point interval
  socket.on("match:resume_interval", (data) => {
    handleUmpireAction(data, (state) => {
      resumeFromInterval(state);
    });
  });

  // Umpire concludes or abandons match early
  socket.on("match:conclude_early", (data) => {
    handleUmpireAction(data, (state) => {
      if (data.action === "ABANDON") {
        abandonMatch(state, data.reason || "Abandoned by court official");
      } else {
        concludeMatchEarly(state, data.reason || "Concluded early by umpire");
      }
    });
  });
});

import os from "node:os";

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`\n🏸 ShuttleLive server listening on ${HOST}:${PORT}`);
  console.log(`  > Local:   http://localhost:${PORT}`);
  if (process.env.SUPABASE_URL) {
    console.log(`  > Cloud DB: Connected (Supabase)`);
  } else {
    console.log(`  > Local DB: data/matches.json`);
  }
  
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  > Network (${name}): http://${net.address}:${PORT}`);
      }
    }
  }
  console.log("");
});
