import express from "express";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import { Server } from "socket.io";
import { matchStore } from "./models/matchStore.js";
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
app.use(express.json());
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
