import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchState,
  addPoint,
  undoLastPoint,
  startNextSet,
  getMatchIndicators
} from "../server/rules/badmintonRules.js";

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

test("handles 42-point social marathon with interval at 21", () => {
  let match = createMatchState({
    id: "match-42-pts",
    preset: "ONE_SET_42"
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
