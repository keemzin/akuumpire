/**
 * Replay & Simulation Engine for ShuttleLive
 * Generates frame-by-frame match replay timeline for any completed match.
 * Zero server overhead — runs entirely client-side.
 */

function getMatchIndicators(state) {
  const { currentScore, rules, teamA, teamB } = state;
  const target = rules?.pointsPerSet || 21;
  const maxCap = rules?.maxPointsCap || 30;
  const setsToWin = rules?.setsToWin || 2;

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
    const couldWinSet = (score >= target - 1 && score > oppScore) || (score === maxCap - 1);
    if (couldWinSet) {
      if (setsWon + 1 >= setsToWin) {
        return "MATCH_POINT";
      }
      return "GAME_POINT";
    }
    return null;
  };

  const pointA = checkTeam(scoreA, scoreB, teamA?.setsWon || 0);
  const pointB = checkTeam(scoreB, scoreA, teamB?.setsWon || 0);

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
 * Builds an array of replay snapshots from match data.
 * If match.history exists with point snapshots, uses real recorded frames.
 * Otherwise, generates a realistic rally-by-rally simulation based on set scores.
 */
export function buildReplayFrames(match) {
  if (!match) return [];

  // Check if recorded history is a complete, untruncated match history starting at Set 1 (0-0)
  const firstSnap = Array.isArray(match.history) && match.history.length > 0 ? match.history[0] : null;
  const isFullMatchHistory = Boolean(
    firstSnap &&
    match.history.length > 2 &&
    firstSnap.currentSet === 1 &&
    firstSnap.currentScore &&
    firstSnap.currentScore.teamA === 0 &&
    firstSnap.currentScore.teamB === 0 &&
    (!firstSnap.setsHistory || firstSnap.setsHistory.length === 0)
  );

  // 1. If we have full recorded point-by-point history from live umpire scoring
  if (isFullMatchHistory) {
    const frames = match.history.map((snap, idx) => {
      const indicators = getMatchIndicators({
        currentScore: snap.currentScore,
        rules: match.rules,
        teamA: snap.teamA,
        teamB: snap.teamB,
        currentSet: snap.currentSet
      });

      return {
        frameIndex: idx,
        status: snap.status,
        currentSet: snap.currentSet,
        currentScore: { ...snap.currentScore },
        servingTeam: snap.servingTeam,
        setsHistory: snap.setsHistory ? deduplicateSets(snap.setsHistory) : [],
        teamA: { ...snap.teamA },
        teamB: { ...snap.teamB },
        indicators,
        note: `Set ${snap.currentSet}: ${snap.currentScore.teamA} - ${snap.currentScore.teamB}`
      };
    });

    // Add final finished frame
    const finalInd = getMatchIndicators(match);
    frames.push({
      frameIndex: frames.length,
      status: match.status,
      currentSet: match.currentSet,
      currentScore: { ...match.currentScore },
      servingTeam: match.servingTeam,
      setsHistory: match.setsHistory ? deduplicateSets(match.setsHistory) : [],
      teamA: { ...match.teamA },
      teamB: { ...match.teamB },
      winner: match.winner,
      indicators: finalInd,
      isMatchEnd: true,
      note: `Final: ${match.winner === 'A' ? match.teamA.name : match.teamB.name} wins!`
    });

    return frames;
  }

  // 2. Synthesize simulation from setsHistory and final score
  const setsToSimulate = [];

  if (Array.isArray(match.setsHistory) && match.setsHistory.length > 0) {
    const cleanSets = deduplicateSets(match.setsHistory);
    cleanSets.forEach(s => {
      setsToSimulate.push({
        set: s.set,
        targetA: Number(s.teamA) || 0,
        targetB: Number(s.teamB) || 0,
        winner: s.winner || (Number(s.teamA) > Number(s.teamB) ? 'A' : 'B')
      });
    });
  } else {
    // Single set or fallback to currentScore
    setsToSimulate.push({
      set: 1,
      targetA: match.currentScore?.teamA || 21,
      targetB: match.currentScore?.teamB || 19,
      winner: match.winner || (match.currentScore?.teamA > match.currentScore?.teamB ? 'A' : 'B')
    });
  }

  const frames = [];
  let setsWonA = 0;
  let setsWonB = 0;
  const setsHistoryAccumulator = [];
  let currentServingTeam = match.startingServerTeam || "A";

  // Initial zero frame
  frames.push({
    frameIndex: 0,
    status: "IN_PROGRESS",
    currentSet: 1,
    currentScore: { teamA: 0, teamB: 0 },
    servingTeam: currentServingTeam,
    setsHistory: [],
    teamA: { ...match.teamA, setsWon: 0 },
    teamB: { ...match.teamB, setsWon: 0 },
    indicators: { isGamePoint: false, isMatchPoint: false, isDeuce: false },
    note: "Match starts • 0 - 0"
  });

  setsToSimulate.forEach((setInfo, setIdx) => {
    const setNum = setInfo.set;
    const targetA = setInfo.targetA;
    const targetB = setInfo.targetB;

    let scoreA = 0;
    let scoreB = 0;

    // Start frame for Set 2, Set 3, etc.
    if (setIdx > 0) {
      frames.push({
        frameIndex: frames.length,
        status: "IN_PROGRESS",
        currentSet: setNum,
        currentScore: { teamA: 0, teamB: 0 },
        servingTeam: currentServingTeam,
        setsHistory: [...setsHistoryAccumulator],
        teamA: { ...match.teamA, setsWon: setsWonA },
        teamB: { ...match.teamB, setsWon: setsWonB },
        indicators: { isGamePoint: false, isMatchPoint: false, isDeuce: false },
        note: `Set ${setNum} starts • 0 - 0`
      });
    }

    // Build realistic rally sequence to reach targetA - targetB
    const pointSequence = generateRallySequence(targetA, targetB, setInfo.winner);

    pointSequence.forEach((scoringTeam, ptIndex) => {
      if (scoringTeam === "A") scoreA++;
      else scoreB++;

      // In badminton, the team that scores serves next
      currentServingTeam = scoringTeam;

      const mockState = {
        currentScore: { teamA: scoreA, teamB: scoreB },
        rules: match.rules || { pointsPerSet: 21, maxPointsCap: 30, setsToWin: 2 },
        teamA: { ...match.teamA, setsWon: setsWonA },
        teamB: { ...match.teamB, setsWon: setsWonB },
        currentSet: setNum
      };

      const indicators = getMatchIndicators(mockState);
      const isInterval = (scoreA === 11 || scoreB === 11) && Math.max(scoreA, scoreB) === 11;
      const isSetLastPoint = ptIndex === pointSequence.length - 1;

      let note = `Set ${setNum}: ${scoreA} - ${scoreB}`;
      if (indicators.isMatchPoint) note = `⚡ Match Point for ${indicators.leader === 'A' ? match.teamA.name : match.teamB.name}!`;
      else if (indicators.isGamePoint) note = `⚡ Game Point for ${indicators.leader === 'A' ? match.teamA.name : match.teamB.name}!`;
      else if (isInterval) note = `⏸ Interval reached at 11 points`;

      frames.push({
        frameIndex: frames.length,
        status: isInterval ? "INTERVAL" : "IN_PROGRESS",
        currentSet: setNum,
        currentScore: { teamA: scoreA, teamB: scoreB },
        servingTeam: currentServingTeam,
        setsHistory: [...setsHistoryAccumulator],
        teamA: { ...match.teamA, setsWon: setsWonA },
        teamB: { ...match.teamB, setsWon: setsWonB },
        indicators,
        isInterval,
        note
      });
    });

    // Set won
    if (setInfo.winner === "A") setsWonA++;
    else setsWonB++;

    setsHistoryAccumulator.push({
      set: setNum,
      teamA: targetA,
      teamB: targetB,
      winner: setInfo.winner
    });

    // Post-set pause frame
    frames.push({
      frameIndex: frames.length,
      status: "SET_ENDED",
      currentSet: setNum,
      currentScore: { teamA: targetA, teamB: targetB },
      servingTeam: currentServingTeam,
      setsHistory: [...setsHistoryAccumulator],
      teamA: { ...match.teamA, setsWon: setsWonA },
      teamB: { ...match.teamB, setsWon: setsWonB },
      indicators: { isGamePoint: false, isMatchPoint: false, isDeuce: false },
      isSetEnd: true,
      note: `Set ${setNum} won by ${setInfo.winner === 'A' ? match.teamA.name : match.teamB.name} (${targetA} - ${targetB})`
    });
  });

  // Final Conclusion frame
  const finalWinner = match.winner || (setsWonA > setsWonB ? "A" : "B");
  frames.push({
    frameIndex: frames.length,
    status: match.status || "FINISHED",
    currentSet: setsToSimulate.length,
    currentScore: { ...match.currentScore },
    servingTeam: currentServingTeam,
    setsHistory: [...setsHistoryAccumulator],
    teamA: { ...match.teamA, setsWon: setsWonA },
    teamB: { ...match.teamB, setsWon: setsWonB },
    winner: finalWinner,
    indicators: { isGamePoint: false, isMatchPoint: false, isDeuce: false },
    isMatchEnd: true,
    note: `🏆 Match Finished! ${finalWinner === 'A' ? match.teamA.name : match.teamB.name} wins!`
  });

  return frames;
}

/**
 * Generates a realistic distribution of rallies that lands on targetA & targetB.
 */
function generateRallySequence(targetA, targetB, winner) {
  const points = [];
  const winSide = winner || (targetA > targetB ? "A" : "B");

  // The set winner must score the final set-winning point
  let aRemaining = winSide === "A" ? Math.max(0, targetA - 1) : targetA;
  let bRemaining = winSide === "B" ? Math.max(0, targetB - 1) : targetB;

  while (aRemaining > 0 || bRemaining > 0) {
    if (aRemaining === 0) {
      points.push("B");
      bRemaining--;
    } else if (bRemaining === 0) {
      points.push("A");
      aRemaining--;
    } else {
      // Probability proportional to remaining points with slight streakiness
      const probA = aRemaining / (aRemaining + bRemaining);
      if (Math.random() < probA) {
        points.push("A");
        aRemaining--;
      } else {
        points.push("B");
        bRemaining--;
      }
    }
  }

  // Final set-winning point
  points.push(winSide);
  return points;
}

/**
 * Deduplicate sets by set number (taking the latest entry for each set)
 */
export function deduplicateSets(sets) {
  if (!Array.isArray(sets)) return [];
  const map = new Map();
  sets.forEach((s, idx) => {
    const setKey = s.set || (idx + 1);
    map.set(setKey, { ...s, set: setKey });
  });
  return Array.from(map.values());
}

