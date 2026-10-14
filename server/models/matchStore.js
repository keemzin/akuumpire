import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createMatchState, getMatchIndicators } from "../rules/badmintonRules.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "matches.json");

class MatchStore {
  constructor() {
    this.matches = new Map();
    this.ensureDataDir();
    this.loadFromDisk();
    this.seedDemoIfEmpty();
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
  seedDemoIfEmpty() {
    if (this.matches.size > 0) return;

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

    this.matches.set(match1Id, {
      id: match1Id,
      adminPin: "1234",
      adminToken: "demo_token_court_1",
      createdAt: new Date().toISOString(),
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

    this.matches.set(match2Id, {
      id: match2Id,
      adminPin: "8888",
      adminToken: "demo_token_court_2",
      createdAt: new Date().toISOString(),
      matchState: match2State
    });

    this.saveToDisk();
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
    this.saveToDisk();

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

  getPublicMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return null;
    return this.sanitizePublicState(match.matchState);
  }

  getRawRecord(matchId) {
    return this.matches.get(matchId) || null;
  }

  listPublicMatches() {
    return Array.from(this.matches.values())
      .map(m => this.sanitizePublicState(m.matchState))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
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
    this.saveToDisk();
    return this.sanitizePublicState(record.matchState);
  }

  deleteMatch(matchId) {
    const existed = this.matches.delete(matchId);
    if (existed) this.saveToDisk();
    return existed;
  }
}

export const matchStore = new MatchStore();
