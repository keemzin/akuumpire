import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createMatchState, getMatchIndicators } from "../rules/badmintonRules.js";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch (e) {
    // Ignore if .env doesn't exist
  }
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "matches.json");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

class MatchStore {
  constructor() {
    this.matches = new Map();
    this.supabase = null;
    this.ensureDataDir();
    this.loadFromDisk();
    this.seedDemoIfEmpty();
    this.reapStaleMatches();

    if (SUPABASE_URL && SUPABASE_KEY) {
      this.initSupabase();
    }

    // Periodic reaper for AFK abandoned courts (every 10 minutes)
    setInterval(() => {
      this.reapStaleMatches();
    }, 10 * 60 * 1000).unref();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const list = JSON.parse(raw);
        for (const item of list) {
          if (Array.isArray(item.matchState?.setsHistory)) {
            const map = new Map();
            item.matchState.setsHistory.forEach((s, idx) => {
              const k = s.set || (idx + 1);
              map.set(k, { ...s, set: k });
            });
            item.matchState.setsHistory = Array.from(map.values());
          }
          this.matches.set(item.id, item);
        }
      }
    } catch (err) {
      console.warn("Could not load matches from disk, starting empty:", err.message);
    }
  }

  saveToDisk() {
    try {
      const list = Array.from(this.matches.values());
      fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to persist matches to disk:", err.message);
    }
  }

  async initSupabase() {
    try {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
      console.log(`☁️  Supabase cloud database enabled: ${SUPABASE_URL}`);

      const { data, error } = await this.supabase
        .from("matches")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        console.warn("⚠️  [Supabase] Failed to fetch matches, using local data:", error.message);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        this.matches.clear();
        for (const row of data) {
          if (Array.isArray(row.match_state?.setsHistory)) {
            const map = new Map();
            row.match_state.setsHistory.forEach((s, idx) => {
              const k = s.set || (idx + 1);
              map.set(k, { ...s, set: k });
            });
            row.match_state.setsHistory = Array.from(map.values());
          }
          this.matches.set(row.id, {
            id: row.id,
            adminPin: row.admin_pin,
            adminToken: row.admin_token,
            createdAt: row.created_at,
            matchState: row.match_state
          });
        }
        this.saveToDisk();
        console.log(`✅ [Supabase] Synced ${data.length} match(es) from cloud database.`);
      } else if (this.matches.size > 0) {
        console.log("☁️  [Supabase] Cloud database is empty. Uploading current matches...");
        for (const record of this.matches.values()) {
          this.persistToSupabase(record);
        }
      }
    } catch (err) {
      console.warn("⚠️  [Supabase] Initialization error:", err.message);
    }
  }

  persistRecord(record) {
    this.saveToDisk();
    this.persistToSupabase(record);
  }

  persistToSupabase(record) {
    if (!this.supabase || !record) return;
    const state = record.matchState || {};
    this.supabase
      .from("matches")
      .upsert({
        id: record.id,
        admin_pin: record.adminPin,
        admin_token: record.adminToken,
        created_at: record.createdAt || state.createdAt || new Date().toISOString(),
        updated_at: state.updatedAt || new Date().toISOString(),
        match_state: state
      })
      .then(({ error }) => {
        if (error) {
          console.error(`⚠️  [Supabase] Upsert error for match ${record.id}:`, error.message);
        }
      })
      .catch((err) => {
        console.error(`⚠️  [Supabase] Network error for match ${record.id}:`, err.message);
      });
  }

  /**
   * Generates a random 4-digit PIN
   */
  generatePin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /**
   * Generates a URL-friendly match ID
   */
  generateMatchId(courtName = "court") {
    const cleanCourt = courtName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 15) || "court";
    const randomSuffix = crypto.randomBytes(3).toString("hex");
    return `${cleanCourt}-${randomSuffix}`;
  }

  /**
   * Seeds demo matches so the landing page immediately looks lively and ready to test!
   */
  /**
   * Seeds demo matches so the landing page immediately looks lively and ready to test!
   */
  seedDemoIfEmpty(force = false) {
    if (!force && this.matches.size > 0) return;

    const now = new Date().toISOString();

    // Demo Match 1: Olympic / World Championship style Men's Singles
    const match1Id = "court-1-demo";
    const match1State = createMatchState({
      id: match1Id,
      venue: "Sports Arena Central",
      court: "Court 1",
      matchType: "MS",
      teamAName: "DEN",
      teamAPlayer1: "Viktor Axelsen",
      teamBName: "MAS",
      teamBPlayer1: "Lee Zii Jia",
      preset: "BWF_STANDARD",
      startingServerTeam: "A"
    });
    match1State.status = "IN_PROGRESS";
    match1State.currentScore = { teamA: 18, teamB: 17 };
    match1State.setsHistory = [{ set: 1, teamA: 21, teamB: 19, winner: "A" }];
    match1State.currentSet = 2;
    match1State.createdAt = now;
    match1State.updatedAt = now;

    this.matches.set(match1Id, {
      id: match1Id,
      adminPin: "1234",
      adminToken: "demo_token_court_1",
      createdAt: now,
      matchState: match1State
    });

    // Demo Match 2: Heated Men's Doubles
    const match2Id = "court-2-demo";
    const match2State = createMatchState({
      id: match2Id,
      venue: "Sports Arena Central",
      court: "Court 2",
      matchType: "MD",
      teamAName: "MAS",
      teamAPlayer1: "Aaron Chia",
      teamAPlayer2: "Soh Wooi Yik",
      teamBName: "INA",
      teamBPlayer1: "Fajar Alfian",
      teamBPlayer2: "M. R. Ardianto",
      preset: "BWF_STANDARD",
      startingServerTeam: "B"
    });
    match2State.status = "IN_PROGRESS";
    match2State.currentScore = { teamA: 14, teamB: 12 };
    match2State.currentSet = 1;
    match2State.createdAt = now;
    match2State.updatedAt = now;

    this.matches.set(match2Id, {
      id: match2Id,
      adminPin: "8888",
      adminToken: "demo_token_court_2",
      createdAt: now,
      matchState: match2State
    });

    this.saveToDisk();
    if (this.supabase) {
      for (const record of this.matches.values()) {
        this.persistToSupabase(record);
      }
    }
  }

  createMatch(config) {
    const id = this.generateMatchId(config.court);
    const adminPin = config.customPin && /^\d{4,6}$/.test(config.customPin) 
      ? config.customPin 
      : this.generatePin();
    const adminToken = "tok_" + crypto.randomBytes(12).toString("hex");

    const matchState = createMatchState({
      ...config,
      id
    });

    const matchRecord = {
      id,
      adminPin,
      adminToken,
      createdAt: new Date().toISOString(),
      matchState
    };

    this.matches.set(id, matchRecord);
    this.persistRecord(matchRecord);

    return {
      id,
      adminPin,
      adminToken,
      matchState: this.sanitizePublicState(matchState)
    };
  }

  verifyAdmin(matchId, pinOrToken) {
    if (!pinOrToken) return false;
    const match = this.matches.get(matchId);
    if (!match) return false;

    const trimmed = String(pinOrToken).trim();
    return match.adminPin === trimmed || match.adminToken === trimmed;
  }

  setActiveUmpireDevice(matchId, deviceId) {
    const raw = this.matches.get(matchId);
    if (!raw) return;
    raw.activeUmpireDeviceId = deviceId;
    raw.activeUmpireDeviceLastSeen = Date.now();
  }

  getActiveUmpireDevice(matchId) {
    const raw = this.matches.get(matchId);
    if (!raw) return { deviceId: null, lastSeen: null };
    return {
      deviceId: raw.activeUmpireDeviceId || null,
      lastSeen: raw.activeUmpireDeviceLastSeen || null
    };
  }

  getPublicMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return null;
    return this.sanitizePublicState(match.matchState);
  }

  getRawRecord(matchId) {
    return this.matches.get(matchId) || null;
  }

  reapStaleMatches() {
    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    let modified = false;

    for (const [id, record] of this.matches.entries()) {
      const state = record.matchState;
      if (!state) continue;

      const createdTime = new Date(record.createdAt || state.createdAt).getTime();
      const updatedTime = new Date(state.updatedAt || record.createdAt).getTime();

      // Case 1: Warm-up court never started, AFK > 2 hours with 0 points scored
      // (Do not delete demo courts from disk on warm-up)
      if (state.status === "NOT_STARTED" && !id.endsWith("-demo")) {
        const hasNoPoints = (!state.currentScore || (state.currentScore.teamA === 0 && state.currentScore.teamB === 0)) &&
          (!state.setsHistory || state.setsHistory.length === 0);
        
        if (hasNoPoints && (now - createdTime > TWO_HOURS_MS)) {
          this.matches.delete(id);
          if (this.supabase) {
            this.supabase.from("matches").delete().eq("id", id).catch(() => {});
          }
          modified = true;
          continue;
        }
      }

      // Case 2: Active match left AFK for > 3 hours with no score updates
      // This applies to ALL matches (including demo courts that were left unattended)
      if (state.status === "IN_PROGRESS" || state.status === "INTERVAL" || state.status === "SET_ENDED") {
        if (now - updatedTime > THREE_HOURS_MS) {
          state.status = "ABANDONED";
          state.finishedAt = new Date().toISOString();
          state.updatedAt = new Date().toISOString();
          state.endedReason = "Inactivity timeout (3h AFK)";
          modified = true;
        }
      }
    }

    if (modified) {
      this.saveToDisk();
      if (this.supabase) {
        for (const record of this.matches.values()) {
          if (record.matchState?.status === "ABANDONED") {
            this.persistToSupabase(record);
          }
        }
      }
    }
    return modified;
  }

  listPublicMatches() {
    this.reapStaleMatches();
    return Array.from(this.matches.values())
      .map(m => this.sanitizePublicState(m.matchState))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }

  listAllRecordsForAdmin() {
    this.reapStaleMatches();
    return Array.from(this.matches.values()).map(r => {
      const m = r.matchState;
      const lastActionTime = m.updatedAt || r.createdAt;
      const idleMinutes = Math.max(0, Math.floor((Date.now() - new Date(lastActionTime).getTime()) / 60000));
      return {
        id: r.id,
        adminPin: r.adminPin,
        adminToken: r.adminToken,
        createdAt: r.createdAt,
        updatedAt: m.updatedAt,
        idleMinutes,
        matchState: this.sanitizePublicState(m)
      };
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }

  resetDemoMatches() {
    this.seedDemoIfEmpty(true);
    return true;
  }

  purgeHistory() {
    const toDelete = [];
    for (const [id, record] of this.matches.entries()) {
      if (record.matchState?.status === "FINISHED" || record.matchState?.status === "ABANDONED") {
        this.matches.delete(id);
        toDelete.push(id);
      }
    }
    if (toDelete.length > 0) {
      this.saveToDisk();
      if (this.supabase) {
        this.supabase
          .from("matches")
          .delete()
          .in("id", toDelete)
          .then(({ error }) => {
            if (error) console.error("⚠️  [Supabase] Purge error:", error.message);
          })
          .catch((err) => {
            console.error("⚠️  [Supabase] Purge network error:", err.message);
          });
      }
    }
    return toDelete.length;
  }

  sanitizePublicState(matchState) {
    const indicators = getMatchIndicators(matchState);
    return {
      ...matchState,
      indicators
    };
  }

  updateMatchState(matchId, newState) {
    const record = this.matches.get(matchId);
    if (!record) return null;

    record.matchState = newState;
    this.persistRecord(record);
    return this.sanitizePublicState(record.matchState);
  }

  deleteMatch(matchId) {
    const existed = this.matches.delete(matchId);
    if (existed) {
      this.saveToDisk();
      if (this.supabase) {
        this.supabase
          .from("matches")
          .delete()
          .eq("id", matchId)
          .then(({ error }) => {
            if (error) console.error(`⚠️  [Supabase] Delete error for match ${matchId}:`, error.message);
          })
          .catch((err) => {
            console.error(`⚠️  [Supabase] Delete network error for match ${matchId}:`, err.message);
          });
      }
    }
    return existed;
  }
}

export const matchStore = new MatchStore();
