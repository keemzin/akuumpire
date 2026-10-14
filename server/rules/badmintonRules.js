/**
 * Official BWF Badminton Scoring & Court Rotation Logic
 */

export const MATCH_TYPES = {
  MS: "Men's Singles",
  WS: "Women's Singles",
  MD: "Men's Doubles",
  WD: "Women's Doubles",
  XD: "Mixed Doubles"
};

export const RULE_PRESETS = {
  BWF_STANDARD: {
    id: "BWF_STANDARD",
    name: "BWF Standard (Best of 3 to 21)",
    setsToWin: 2,
    pointsPerSet: 21,
    maxPointsCap: 30,
    intervalAt: 11
  },
  ONE_SET_21: {
    id: "ONE_SET_21",
    name: "Single Set to 21 (Sudden Death)",
    setsToWin: 1,
    pointsPerSet: 21,
    maxPointsCap: 30,
    intervalAt: 11
  },
  ONE_SET_30: {
    id: "ONE_SET_30",
    name: "Single Set to 30 (Golden Point)",
    setsToWin: 1,
    pointsPerSet: 30,
    maxPointsCap: 30,
    intervalAt: 15
  },
  ONE_SET_42: {
    id: "ONE_SET_42",
    name: "Social Club Marathon (1 Set to 42)",
    setsToWin: 1,
    pointsPerSet: 42,
    maxPointsCap: 42,
    intervalAt: 21
  },
  BEST_OF_3_15: {
    id: "BEST_OF_3_15",
    name: "Fast Play (Best of 3 to 15)",
    setsToWin: 2,
    pointsPerSet: 15,
    maxPointsCap: 21,
    intervalAt: 8
  }
};

/**
 * Creates an initial match state object
 */
export function createMatchState(config) {
  const presetKey = config.preset || "BWF_STANDARD";
  const rules = RULE_PRESETS[presetKey] || RULE_PRESETS.BWF_STANDARD;
  const isDoubles = ["MD", "WD", "XD"].includes(config.matchType);

  const teamA = {
    name: config.teamAName || "Team A",
    player1: config.teamAPlayer1 || "Player 1",
    player2: isDoubles ? (config.teamAPlayer2 || "Player 2") : null,
    setsWon: 0,
    color: config.teamAColor || "#22c55e" // Emerald green
  };

  const teamB = {
    name: config.teamBName || "Team B",
    player1: config.teamBPlayer1 || "Player 1",
    player2: isDoubles ? (config.teamBPlayer2 || "Player 2") : null,
    setsWon: 0,
    color: config.teamBColor || "#3b82f6" // Electric blue
  };

  // Determine starting server
  const startingServerTeam = config.startingServerTeam === "B" ? "B" : "A";

  const state = {
    id: config.id,
    venue: config.venue || "Court Central",
    court: config.court || "Court 1",
    matchType: config.matchType || "MS",
    rules,
    status: "NOT_STARTED", // NOT_STARTED, IN_PROGRESS, INTERVAL, SET_ENDED, FINISHED
    currentSet: 1,
    setsHistory: [], // [{ set: 1, teamA: 21, teamB: 19, winner: 'A' }]
    
    currentScore: {
      teamA: 0,
      teamB: 0
    },

    // Who currently holds the service
    servingTeam: startingServerTeam,
    
    // Detailed court positioning for singles/doubles
    courtPositions: {
      teamA: {
        rightBox: teamA.player1,
        leftBox: isDoubles ? teamA.player2 : null
      },
      teamB: {
        rightBox: teamB.player1,
        leftBox: isDoubles ? teamB.player2 : null
      }
    },

    // Which end of court team A is playing on: 'LEFT' or 'RIGHT'
    teamACourtEnd: config.teamACourtEnd || "LEFT",
    
    intervalReached: false,
    winner: null,
    history: [], // For undo functionality
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    teamA,
    teamB
  };

  return state;
}

/**
 * Checks if a game or match point is active
 */
export function getMatchIndicators(state) {
  const { currentScore, rules, teamA, teamB, currentSet } = state;
  const target = rules.pointsPerSet;
  const maxCap = rules.maxPointsCap;

  let isGamePoint = false;
  let isMatchPoint = false;
  let leader = null;
  let isDeuce = false;

  const scoreA = currentScore.teamA;
  const scoreB = currentScore.teamB;

  if (scoreA >= target - 1 && scoreB >= target - 1 && scoreA === scoreB) {
    isDeuce = true;
  }

  const checkTeam = (score, oppScore, setsWon) => {
    // Reached target - 1 or deuce advantage point
    const couldWinSet = (score >= target - 1 && score > oppScore) || (score === maxCap - 1);
    if (couldWinSet) {
      if (setsWon + 1 >= rules.setsToWin) {
        return "MATCH_POINT";
      }
      return "GAME_POINT";
    }
    return null;
  };

  const pointA = checkTeam(scoreA, scoreB, teamA.setsWon);
  const pointB = checkTeam(scoreB, scoreA, teamB.setsWon);

  if (pointA === "MATCH_POINT") {
    isMatchPoint = true;
    leader = "A";
  } else if (pointB === "MATCH_POINT") {
    isMatchPoint = true;
    leader = "B";
  } else if (pointA === "GAME_POINT") {
    isGamePoint = true;
    leader = "A";
  } else if (pointB === "GAME_POINT") {
    isGamePoint = true;
    leader = "B";
  }

  return { isGamePoint, isMatchPoint, leader, isDeuce };
}

/**
 * Apply a point to Team A or Team B according to BWF rules
 */
export function addPoint(state, scoringTeam) {
  if (state.status === "FINISHED") {
    return state;
  }

  // Save snapshot for undo
  const snapshot = JSON.parse(JSON.stringify({
    status: state.status,
    currentSet: state.currentSet,
    setsHistory: state.setsHistory,
    currentScore: state.currentScore,
    servingTeam: state.servingTeam,
    courtPositions: state.courtPositions,
    teamACourtEnd: state.teamACourtEnd,
    intervalReached: state.intervalReached,
    winner: state.winner,
    teamA: state.teamA,
    teamB: state.teamB
  }));
  state.history.push(snapshot);
  if (state.history.length > 50) state.history.shift(); // Limit undo stack

  if (state.status === "NOT_STARTED") {
    state.status = "IN_PROGRESS";
  }

  // Increment point
  if (scoringTeam === "A") {
    state.currentScore.teamA += 1;
  } else {
    state.currentScore.teamB += 1;
  }

  const isDoubles = ["MD", "WD", "XD"].includes(state.matchType);
  const scoreScoringSide = scoringTeam === "A" ? state.currentScore.teamA : state.currentScore.teamB;

  // Rotation logic:
  if (state.servingTeam === scoringTeam) {
    // The serving side won the rally -> in doubles, players switch boxes
    if (isDoubles) {
      const pos = scoringTeam === "A" ? state.courtPositions.teamA : state.courtPositions.teamB;
      const temp = pos.rightBox;
      pos.rightBox = pos.leftBox;
      pos.leftBox = temp;
    }
  } else {
    // The receiving side won the rally -> serve transfers
    state.servingTeam = scoringTeam;
    // In doubles, nobody switches boxes on receiving side winning rally
  }

  // Check 11-point Interval
  const maxScore = Math.max(state.currentScore.teamA, state.currentScore.teamB);
  if (!state.intervalReached && maxScore === state.rules.intervalAt) {
    state.intervalReached = true;
    state.status = "INTERVAL";
  }

  // Check Deciding set change of ends at 11 points:
  // In the 3rd set (or final set of best of 3), players change ends when the leading score reaches 11
  const isDeciderSet = state.rules.setsToWin > 1 && state.currentSet === (state.rules.setsToWin * 2 - 1);
  if (isDeciderSet && maxScore === state.rules.intervalAt && !state.deciderEndSwapped) {
    state.teamACourtEnd = state.teamACourtEnd === "LEFT" ? "RIGHT" : "LEFT";
    state.deciderEndSwapped = true;
  }

  // Check Set Win
  const scoreA = state.currentScore.teamA;
  const scoreB = state.currentScore.teamB;
  const target = state.rules.pointsPerSet;
  const maxCap = state.rules.maxPointsCap;

  let setWinner = null;
  if ((scoreA >= target && scoreA - scoreB >= 2) || scoreA === maxCap) {
    setWinner = "A";
  } else if ((scoreB >= target && scoreB - scoreA >= 2) || scoreB === maxCap) {
    setWinner = "B";
  }

  if (setWinner) {
    if (setWinner === "A") state.teamA.setsWon += 1;
    if (setWinner === "B") state.teamB.setsWon += 1;

    state.setsHistory.push({
      set: state.currentSet,
      teamA: scoreA,
      teamB: scoreB,
      winner: setWinner
    });

    // Check Match Win
    if (state.teamA.setsWon >= state.rules.setsToWin) {
      state.status = "FINISHED";
      state.winner = "A";
    } else if (state.teamB.setsWon >= state.rules.setsToWin) {
      state.status = "FINISHED";
      state.winner = "B";
    } else {
      // Set ended, next set ready
      state.status = "SET_ENDED";
    }
  }

  state.updatedAt = new Date().toISOString();
  return state;
}

/**
 * Start the next set (clears score, swaps court ends, sets server to set winner)
 */
export function startNextSet(state) {
  if (state.status !== "SET_ENDED") return state;

  state.currentSet += 1;
  state.currentScore = { teamA: 0, teamB: 0 };
  state.intervalReached = false;
  state.deciderEndSwapped = false;
  
  // Swap court ends between sets
  state.teamACourtEnd = state.teamACourtEnd === "LEFT" ? "RIGHT" : "LEFT";

  // Winner of previous set serves first in next set (BWF rule)
  const lastSet = state.setsHistory[state.setsHistory.length - 1];
  if (lastSet) {
    state.servingTeam = lastSet.winner;
  }

  state.status = "IN_PROGRESS";
  state.updatedAt = new Date().toISOString();
  return state;
}

/**
 * Reverts to the previous score state
 */
export function undoLastPoint(state) {
  if (!state.history || state.history.length === 0) {
    return state;
  }

  const prev = state.history.pop();
  state.status = prev.status;
  state.currentSet = prev.currentSet;
  state.setsHistory = prev.setsHistory;
  state.currentScore = prev.currentScore;
  state.servingTeam = prev.servingTeam;
  state.courtPositions = prev.courtPositions;
  state.teamACourtEnd = prev.teamACourtEnd;
  state.intervalReached = prev.intervalReached;
  state.winner = prev.winner;
  state.teamA = prev.teamA;
  state.teamB = prev.teamB;
  state.updatedAt = new Date().toISOString();

  return state;
}

/**
 * Manual override actions for umpire
 */
export function switchServingTeam(state) {
  state.servingTeam = state.servingTeam === "A" ? "B" : "A";
  state.updatedAt = new Date().toISOString();
  return state;
}

export function switchCourtEnds(state) {
  state.teamACourtEnd = state.teamACourtEnd === "LEFT" ? "RIGHT" : "LEFT";
  state.updatedAt = new Date().toISOString();
  return state;
}

export function resumeFromInterval(state) {
  if (state.status === "INTERVAL") {
    state.status = "IN_PROGRESS";
    state.updatedAt = new Date().toISOString();
  }
  return state;
}
