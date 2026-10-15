import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchState,
  addPoint,
  undoLastPoint,
  startNextSet,
  getMatchIndicators,
  concludeMatchEarly,
  abandonMatch
} from "../server/rules/badmintonRules.js";
import { matchStore } from "../server/models/matchStore.js";
import { buildReplayFrames } from "../public/js/replayEngine.js";

test("creates initial match state correctly", () => {
  const match = createMatchState({
    id: "match-101",
    venue: "Arena Hall",
    court: "Court 1",
    matchType: "MS",
    teamAPlayer1: "Viktor Axelsen",
    teamBPlayer1: "Lee Zii Jia",
    startingServerTeam: "A"
  });

  assert.equal(match.id, "match-101");
  assert.equal(match.currentScore.teamA, 0);
  assert.equal(match.currentScore.teamB, 0);
  assert.equal(match.servingTeam, "A");
  assert.equal(match.currentSet, 1);
  assert.equal(match.status, "NOT_STARTED");
});

test("updates points and handles serve change on receiving point", () => {
  let match = createMatchState({
    id: "match-102",
    startingServerTeam: "A"
  });

  // Team A scores first point (serving side keeps serve)
  match = addPoint(match, "A");
  assert.equal(match.currentScore.teamA, 1);
  assert.equal(match.servingTeam, "A");
  assert.equal(match.status, "IN_PROGRESS");

  // Team B wins rally (serve transfers to Team B)
  match = addPoint(match, "B");
  assert.equal(match.currentScore.teamB, 1);
  assert.equal(match.servingTeam, "B");
});

test("triggers interval when first team reaches 11 points", () => {
  let match = createMatchState({ id: "match-103" });

  for (let i = 0; i < 11; i++) {
    match = addPoint(match, "A");
  }

  assert.equal(match.currentScore.teamA, 11);
  assert.equal(match.status, "INTERVAL");
  assert.equal(match.intervalReached, true);
});

test("handles deuce and set win at 21 with 2-point margin", () => {
  let match = createMatchState({ id: "match-104" });

  // Simulate 20-20 deuce
  match.currentScore.teamA = 20;
  match.currentScore.teamB = 20;

  const indicators = getMatchIndicators(match);
  assert.equal(indicators.isDeuce, true);

  // 21-20 (Game point for Team A)
  match = addPoint(match, "A");
  const gpIndicators = getMatchIndicators(match);
  assert.equal(gpIndicators.isGamePoint, true);
  assert.equal(gpIndicators.leader, "A");
  assert.equal(match.status, "IN_PROGRESS");

  // 22-20 (Team A wins Set 1)
  match = addPoint(match, "A");
  assert.equal(match.status, "SET_ENDED");
  assert.equal(match.teamA.setsWon, 1);
  assert.equal(match.setsHistory.length, 1);
  assert.equal(match.setsHistory[0].winner, "A");
});

test("enforces 30-point golden point cap (29-29 -> 30-29 wins)", () => {
  let match = createMatchState({ id: "match-105" });
  match.currentScore.teamA = 29;
  match.currentScore.teamB = 29;

  match = addPoint(match, "B");
  assert.equal(match.currentScore.teamB, 30);
  assert.equal(match.status, "SET_ENDED");
  assert.equal(match.teamB.setsWon, 1);
});

test("handles 42-point social marathon via custom rules with interval at 21", () => {
  let match = createMatchState({
    id: "match-42-pts",
    preset: "CUSTOM",
    customRules: {
      pointsPerSet: 42,
      setsToWin: 1,
      hasDeuce: false,
      intervalAt: 21
    }
  });

  // Reach interval at 21 points
  match.currentScore.teamA = 20;
  match = addPoint(match, "A");
  assert.equal(match.currentScore.teamA, 21);
  assert.equal(match.status, "INTERVAL");
  assert.equal(match.intervalReached, true);

  // Finish game at 42 points
  match.status = "IN_PROGRESS";
  match.currentScore.teamA = 41;
  match = addPoint(match, "A");
  assert.equal(match.currentScore.teamA, 42);
  assert.equal(match.status, "FINISHED");
  assert.equal(match.winner, "A");
});

test("reverts score and server on undo", () => {
  let match = createMatchState({ id: "match-106", startingServerTeam: "A" });

  match = addPoint(match, "A"); // 1-0
  match = addPoint(match, "B"); // 1-1, serve B
  assert.equal(match.currentScore.teamA, 1);
  assert.equal(match.currentScore.teamB, 1);
  assert.equal(match.servingTeam, "B");

  match = undoLastPoint(match); // Undo to 1-0, serve A
  assert.equal(match.currentScore.teamA, 1);
  assert.equal(match.currentScore.teamB, 0);
  assert.equal(match.servingTeam, "A");
});

test("completes match when a team wins 2 sets (Best of 3)", () => {
  let match = createMatchState({ id: "match-107" });

  // Set 1 won by A (21-0)
  match.currentScore.teamA = 20;
  match = addPoint(match, "A");
  assert.equal(match.status, "SET_ENDED");

  // Start Set 2
  match = startNextSet(match);
  assert.equal(match.currentSet, 2);
  assert.equal(match.currentScore.teamA, 0);

  // Set 2 won by A (21-0)
  match.currentScore.teamA = 20;
  match = addPoint(match, "A");

  assert.equal(match.status, "FINISHED");
  assert.equal(match.winner, "A");
  assert.equal(match.teamA.setsWon, 2);
});

test("supports custom match rules (Single set to 15, sudden death)", () => {
  let match = createMatchState({
    id: "match-custom-15",
    preset: "CUSTOM",
    customRules: {
      pointsPerSet: 15,
      setsToWin: 1,
      hasDeuce: false,
      intervalAt: 8
    }
  });

  assert.equal(match.rules.pointsPerSet, 15);
  assert.equal(match.rules.hasDeuce, false);

  // 14-14 (No deuce) -> 15-14 wins immediately
  match.currentScore.teamA = 14;
  match.currentScore.teamB = 14;
  match = addPoint(match, "A");

  assert.equal(match.currentScore.teamA, 15);
  assert.equal(match.status, "FINISHED");
  assert.equal(match.winner, "A");
  assert.ok(match.finishedAt);
});

test("safeguards AFK court with early conclusion and abandon actions", () => {
  let match = createMatchState({ id: "match-early-end" });
  match.currentScore = { teamA: 11, teamB: 6 };
  match.status = "IN_PROGRESS";

  // Conclude early: Leader (Team A) should be awarded the win
  match = concludeMatchEarly(match, "Player retired");
  assert.equal(match.status, "FINISHED");
  assert.equal(match.winner, "A");
  assert.equal(match.endedReason, "Player retired");
  assert.ok(match.finishedAt);

  // Abandon court: status becomes ABANDONED
  let afkMatch = createMatchState({ id: "match-afk" });
  afkMatch.status = "IN_PROGRESS";
  afkMatch = abandonMatch(afkMatch, "Inactivity timeout (3h AFK)");
  assert.equal(afkMatch.status, "ABANDONED");
  assert.equal(afkMatch.endedReason, "Inactivity timeout (3h AFK)");
  assert.ok(afkMatch.finishedAt);
});

test("super admin reaper correctly auto-archives matches idle > 3 hours", () => {
  // Test matchStore listAllRecordsForAdmin
  const allRecords = matchStore.listAllRecordsForAdmin();
  assert.ok(Array.isArray(allRecords));

  // Create an old idle match
  const testMatch = matchStore.createMatch({ court: "Court Test Super" });
  const raw = matchStore.getRawRecord(testMatch.id);
  raw.matchState.status = "IN_PROGRESS";
  raw.matchState.updatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(); // 4 hours ago

  // Run reaper
  matchStore.reapStaleMatches();
  const reaped = matchStore.getPublicMatch(testMatch.id);
  assert.equal(reaped.status, "ABANDONED");
  assert.equal(reaped.endedReason, "Inactivity timeout (3h AFK)");

  // Clean up
  matchStore.deleteMatch(testMatch.id);
});

test("buildReplayFrames generates valid simulation frames from 0-0 to final score", () => {
  const dummyMatch = {
    id: "court-3-demo",
    status: "FINISHED",
    winner: "B",
    currentScore: { teamA: 18, teamB: 21 },
    currentSet: 3,
    setsHistory: [
      { set: 1, teamA: 17, teamB: 21, winner: "B" },
      { set: 2, teamA: 21, teamB: 7, winner: "A" },
      { set: 3, teamA: 18, teamB: 21, winner: "B" }
    ],
    rules: { pointsPerSet: 21, maxPointsCap: 30, setsToWin: 2 },
    teamA: { name: "Tigers", player1: "Alex Tan", player2: "Kenji Sato", setsWon: 1 },
    teamB: { name: "Falcons", player1: "David Lim", player2: "Marcus Ray", setsWon: 2 }
  };

  const frames = buildReplayFrames(dummyMatch);
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 50, "Should generate detailed rally sequence");

  // First frame is 0-0
  assert.equal(frames[0].currentScore.teamA, 0);
  assert.equal(frames[0].currentScore.teamB, 0);

  // Last frame is final match conclusion
  const lastFrame = frames[frames.length - 1];
  assert.equal(lastFrame.isMatchEnd, true);
  assert.equal(lastFrame.winner, "B");
});

