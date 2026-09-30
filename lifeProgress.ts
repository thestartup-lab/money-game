/** 人生進程：里程碑、夢想清單、第二人生、65 歲轉折、死亡與終局 */
import { GameState, Player, GamePhase } from './gameDataModels';
import { computePension, computeConsultantIncome, addLifeExperience, getCurrentAge, calculateLifeScore } from './gameLogic';
import { BASIC_PENSION_MONTHLY, LIFE_EXP, RETIREMENT_ROUND, RETIREMENT_STARTUP_AMOUNTS, RETIREMENT_STARTUP_SUCCESS_ROLL, RETIREMENT_STARTUP_RETURN_RATE, RETIREMENT_DEFER_HP_COST, RETIREMENT_MAX_DEFERRALS, CONSULTANT_HP_COST_PER_CYCLE, CONSULTANT_MIN_HP, CONSULTANT_SK_RATE, CONSULTANT_NT_RATE, PENSION_RATE_BY_QUADRANT, SKILL_CAREER_CHANGE_THRESHOLD } from './gameConfig';
import { handlePlayerDeath, evaluateSecondLifeEligibility } from './cardSystem';
import { assignBucketList, evaluateBucketList, getBucketGoal } from './bucketList';
import { serializeGameState, buildAvailableProfessions, careerBlockReason } from './playerView';
import { beginFacilitatorScene, revealFacilitatorResult } from './facilitatorScenes';
import {
  boardNotices, calcNetWorth, emitAdaptiveDirectorStatus, emitCellEvent, emitClient, emitToRoom,
  getPlayerSocket, logPlayerEvent, secondLifeQueue,
} from './socketServer';

/**
 * 檢查玩家夢想清單，達成則 emit `bucketGoalAchieved`，全部達成額外發送 `bucketListAllDone`。
 * 在外圈玩家發生重要事件後呼叫（payday、charity、結婚、生子、買資產、FQ 升級…）。
 *
 * 注意：未進入外圈的玩家（bucketList 為空）不會觸發任何事件。
 */
export function checkBucketGoals(
  player: Player,
  gs: GameState,
  roomId: string,
  socket: import('socket.io').Socket
): void {
  if (!player.bucketList || player.bucketList.length === 0) return;
  const result = evaluateBucketList(player, gs);
  if (result.newlyClaimed.length === 0) return;

  for (const goal of result.newlyClaimed) {
    emitCellEvent(
      socket,
      roomId,
      player.name,
      '夢想達成',
      `${goal.emoji} 完成夢想：${goal.title}！+傳承 ${goal.legacyReward}、+體驗 ${goal.lifeExpReward}${goal.cashReward ? `、+現金 $${goal.cashReward.toLocaleString()}` : ''}。`
    );
    emitToRoom(roomId, 'bucketGoalAchieved', {
      playerId: player.id,
      playerName: player.name,
      goalId: goal.id,
      goalTitle: goal.title,
      goalEmoji: goal.emoji,
      legacyReward: goal.legacyReward,
      lifeExpReward: goal.lifeExpReward,
      cashReward: goal.cashReward ?? 0,
    });
    logPlayerEvent(
      player,
      gs,
      'bucket_goal_achieved',
      `🎯 夢想達成：${goal.title}（傳承 +${goal.legacyReward}）`,
      player.cash - (goal.cashReward ?? 0),
      player.monthlyCashflow,
      calcNetWorth(player) - (goal.cashReward ?? 0),
      { goalId: goal.id, legacyReward: goal.legacyReward }
    );
  }

  if (result.allDone && result.perfectBonus) {
    emitCellEvent(
      socket,
      roomId,
      player.name,
      '人生圓滿',
      `🌟 完成所有夢想！額外獎勵：傳承 +${result.perfectBonus.legacy}、體驗 +${result.perfectBonus.lifeExp}、現金 +$${result.perfectBonus.cash.toLocaleString()}。`
    );
    emitToRoom(roomId, 'bucketListAllDone', {
      playerId: player.id,
      playerName: player.name,
      bonus: result.perfectBonus,
    });
  }
}

/**
 * 人生里程碑檢查（40 / 60 / 80 歲）。
 * 玩家年齡跨越關卡時觸發人生回顧事件，依當下狀態自動加分。
 *
 * 在玩家行動與發薪結算後呼叫；年齡只在完整桌次輪結束時前進。
 */
export function checkLifeMilestones(
  player: Player,
  gs: GameState,
  roomId: string,
  socket: import('socket.io').Socket
): void {
  if (!player.milestonesPassed) {
    player.milestonesPassed = { age40: false, age60: false, age80: false };
  }
  const personalAge = Math.max(player.startAge ?? 20, getCurrentAge(gs));

  type Milestone = { age: 40 | 60 | 80; key: 'age40' | 'age60' | 'age80'; emoji: string; theme: string };
  const list: Milestone[] = [
    { age: 40, key: 'age40', emoji: '🌱', theme: '中年成就' },
    { age: 60, key: 'age60', emoji: '🍂', theme: '黃金歲月' },
    { age: 80, key: 'age80', emoji: '🌟', theme: '長壽傳承' },
  ];

  for (const m of list) {
    if (player.milestonesPassed[m.key] || personalAge < m.age) continue;
    player.milestonesPassed[m.key] = true;

    // 依當下狀態給人生回顧加分（家庭/事業/財富/體驗）
    const review = {
      family: 0,
      wealth: 0,
      health: 0,
      legacy: 0,
      cash: 0,
      lifeExp: 0,
    };
    if (player.isMarried) review.family += 10;
    if (player.numberOfChildren >= 1) review.family += 5 * player.numberOfChildren;
    if (calcNetWorth(player) >= 1_000_000) review.wealth += 10;
    if (calcNetWorth(player) >= 5_000_000) review.wealth += 15;
    if ((player.stats?.health ?? 0) >= 70) review.health += 10;
    if ((player.charityTotal ?? 0) >= 50_000) review.legacy += 10;
    if (player.totalPassiveIncome >= 10_000) review.wealth += 10;

    // 統合：legacy/lifeExp 加成
    const legacyGain = review.family + review.wealth + review.health + review.legacy;
    const lifeExpGain = 20; // 每個里程碑固定 +20 體驗
    const cashGain = m.age >= 60 ? 30_000 : 15_000; // 60+ 歲多給點養老金紅利
    player.legacyBonusPoints = (player.legacyBonusPoints ?? 0) + legacyGain;
    player.lifeExperience = (player.lifeExperience ?? 0) + lifeExpGain;
    player.cash += cashGain;

    emitCellEvent(
      socket,
      roomId,
      player.name,
      `${m.emoji} ${m.age} 歲人生回顧`,
      `${m.theme}！家庭 +${review.family}、財富 +${review.wealth}、健康 +${review.health}、慈善 +${review.legacy}（傳承 +${legacyGain}、體驗 +${lifeExpGain}、現金 +$${cashGain.toLocaleString()}）`
    );
    emitToRoom(roomId, 'lifeMilestoneReached', {
      playerId: player.id,
      playerName: player.name,
      age: m.age,
      theme: m.theme,
      emoji: m.emoji,
      review,
      legacyGain,
      lifeExpGain,
      cashGain,
    });
    logPlayerEvent(
      player,
      gs,
      'life_milestone',
      `${m.emoji} ${m.age} 歲人生回顧：傳承 +${legacyGain}、體驗 +${lifeExpGain}、現金 +$${cashGain.toLocaleString()}`,
      player.cash - cashGain,
      player.monthlyCashflow,
      calcNetWorth(player) - cashGain,
      { age: m.age, ...review, legacyGain, lifeExpGain, cashGain }
    );

    // 跨越里程碑可能讓「長壽人生」夢想達標
    checkBucketGoals(player, gs, roomId, socket);
  }
}

/**
 * 建立賽後使用的第二人生資格快照。
 * 已進圈者優先採用進圈當下的事件資料；未進圈者採用終局狀態，
 * 讓復盤能說明當時走了哪條路，或最後還欠缺哪些人生面向。
 */
export function buildSecondLifeReview(player: Player): object {
  const current = evaluateSecondLifeEligibility(player);
  const escapeEvent = player.eventLog.find((event) => event.type === 'rat_race_escaped');
  const meta = escapeEvent?.meta;
  const route = typeof meta?.escapeRoute === 'string'
    ? meta.escapeRoute
    : current.route;
  const routeLabel = typeof meta?.escapeRouteLabel === 'string'
    ? meta.escapeRouteLabel
    : route === 'balancedLife'
      ? '平衡人生'
      : route === 'financialBreakthrough'
        ? '財務突破'
        : null;

  return {
    escaped: player.isInFastTrack,
    passedSecondLife: player.hasPassedSecondLife,
    route,
    routeLabel,
    rawPassiveIncome: Number(meta?.passiveIncome ?? current.rawPassiveIncome),
    effectivePassiveIncome: Number(meta?.effectivePassiveIncome ?? current.effectivePassiveIncome),
    totalExpenses: Number(meta?.totalExpenses ?? current.totalExpenses),
    coverageRatio: Number(meta?.coverageRatio ?? current.coverageRatio),
    achievedIndicatorCount: Number(meta?.achievedIndicatorCount ?? current.achievedIndicatorCount),
    indicators: Array.isArray(meta?.indicators) ? meta.indicators : current.indicators,
    financialBreakthroughMet: Boolean(meta?.financialBreakthroughMet ?? current.financialBreakthroughMet),
    balancedLifeMet: Boolean(meta?.balancedLifeMet ?? current.balancedLifeMet),
  };
}

/**
 * 統一完成玩家死亡結算。玩家仍保留在房間資料中，讓本人與全場在終局復盤時
 * 都能看到完整人生軌跡；advanceToNextTurn 會自動略過 isAlive=false 的玩家。
 */
export function deathAgeLabel(player: Player): string {
  return player.currentAge >= 90 ? '高壽' : '';
}

export function eliminatePlayer(
  player: Player,
  gs: GameState,
  cause: string,
  description: string,
): { deathAge: number; finalScore: ReturnType<typeof calculateLifeScore> } {
  const deathAge = Math.round(Math.max(player.startAge ?? 20, getCurrentAge(gs)));
  const cashBefore = player.cash;
  const cashflowBefore = player.monthlyCashflow;
  const netWorthBefore = calcNetWorth(player);

  logPlayerEvent(
    player,
    gs,
    'death',
    description,
    cashBefore,
    cashflowBefore,
    netWorthBefore,
    { cause, deathAge },
  );

  const finalScore = calculateLifeScore(player, deathAge, gs.monthsPerRound);
  const deathEvent = player.eventLog[player.eventLog.length - 1];
  if (deathEvent?.type === 'death') deathEvent.meta = { ...deathEvent.meta, finalScore };
  handlePlayerDeath(player, gs);

  emitToRoom(gs.gameId, 'playerFinalScore', {
    playerId: player.id,
    playerName: player.name,
    deathAge,
    cause,
    score: finalScore,
    profession: player.profession.name,
    quadrant: player.profession.quadrant,
    isMarried: player.isMarried,
    numberOfChildren: player.numberOfChildren,
    lifeExperience: player.lifeExperience,
  });
  emitToRoom(gs.gameId, 'playerEliminated', {
    playerId: player.id,
    playerName: player.name,
    deathAge,
    cause,
  });

  if ([...gs.players.values()].every((candidate) => !candidate.isAlive)) {
    finishGame(gs, 'allPlayersEliminated');
  }

  return { deathAge, finalScore };
}

export function finishGame(gs: GameState, reason: 'finalRoundComplete' | 'allPlayersEliminated'): void {
  if (gs.gamePhase === GamePhase.GameOver) return;

  gs.gamePhase = GamePhase.GameOver;
  boardNotices.delete(gs);
  gs.careerRequests = [];
  gs.pendingWorldEvent = null;
  emitAdaptiveDirectorStatus(gs);
  gs.decisionPhase = null;
  gs.facilitatorScene = null;
  gs.facilitatorSceneContext = null;
  gs.globalPaydayPending = false;
  gs.globalPaydayInProgress = false;
  gs.finalRoundPendingPlayerIds = [];

  const currentAge = Math.round(getCurrentAge(gs));
  const finalScores = [...gs.players.values()].map((player) => {
    const deathEvent = [...player.eventLog].reverse().find((event) => event.type === 'death');
    const deathAge = player.isAlive
      ? currentAge
      : Number(deathEvent?.meta?.deathAge ?? Math.max(player.startAge ?? 20, currentAge));
    // 已故玩家沿用死亡當下公布的分數，避免死後市場卡等變動讓排名跟公布的不同
    const frozenScore = deathEvent?.meta?.finalScore as ReturnType<typeof calculateLifeScore> | undefined;
    return {
      playerId: player.id,
      playerName: player.name,
      deathAge,
      score: !player.isAlive && frozenScore ? frozenScore : calculateLifeScore(player, deathAge, gs.monthsPerRound),
      isAlive: player.isAlive,
      profession: player.profession.name,
      quadrant: player.profession.quadrant,
    };
  }).sort((a, b) => b.score.total - a.score.total);

  console.log(`[gameEnded] 房間 ${gs.gameId} 遊戲結束（${reason}）！`);
  emitToRoom(gs.gameId, 'gameEnded', { reason, finalAge: currentAge, finalScores });
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function startFinalRound(gs: GameState): void {
  if (gs.finalRoundStarted || gs.gamePhase === GamePhase.GameOver) return;

  const aliveIds = gs.playerOrder.filter((id) => gs.players.get(id)?.isAlive);
  if (aliveIds.length === 0) {
    finishGame(gs, 'allPlayersEliminated');
    return;
  }

  const currentIndex = aliveIds.indexOf(gs.currentPlayerTurnId);
  const orderedIds = currentIndex >= 0
    ? [...aliveIds.slice(currentIndex), ...aliveIds.slice(0, currentIndex)]
    : aliveIds;

  gs.finalRoundStarted = true;
  gs.pendingWorldEvent = null;
  emitAdaptiveDirectorStatus(gs);
  gs.finalRoundPendingPlayerIds = orderedIds;
  gs.currentPlayerTurnId = orderedIds[0];
  gs.globalPaydayPending = false;

  emitToRoom(gs.gameId, 'finalRoundStarted', {
    currentAge: getCurrentAge(gs),
    finalAge: 100,
    completedLifeRounds: gs.turnNumber,
    playerOrder: orderedIds.map((id) => ({ id, name: gs.players.get(id)?.name ?? '' })),
    firstPlayerId: orderedIds[0],
    firstPlayerName: gs.players.get(orderedIds[0])?.name ?? '',
  });
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function retirementSceneDescription(player: Player): string {
  const pension = computePension(player);
  const consultant = computeConsultantIncome(player);
  const rate = Math.round((PENSION_RATE_BY_QUADRANT[player.profession.quadrant] ?? 0) * 100);
  const lines = [
    `${player.name}（${player.profession.name}）滿 65 歲。職涯平均月薪 $${player.averageCareerSalary.toLocaleString()}，目前月薪 $${player.salary.toLocaleString()}，被動收入 $${player.totalPassiveIncome.toLocaleString()}／月。`,
    `1. 退休：薪資歸零，改領退休金 $${pension.toLocaleString()}／月（${player.profession.quadrant} 象限替代率 ${rate}%，至少是基本年金 $${BASIC_PENSION_MONTHLY.toLocaleString()}）。`,
    `2. 當顧問：月收入 = 第二專長 ${player.stats.careerSkill} × ${CONSULTANT_SK_RATE} + 人脈 ${player.stats.network} × ${CONSULTANT_NT_RATE.toLocaleString()} = $${consultant.toLocaleString()}，另加基本年金；每輪扣 HP ${CONSULTANT_HP_COST_PER_CYCLE}，HP 低於 ${CONSULTANT_MIN_HP} 接不到案。`,
    `3. 創業：投入 $${RETIREMENT_STARTUP_AMOUNTS.map((a) => (a / 10000) + '萬').join('／')}，擲骰 ≥ ${RETIREMENT_STARTUP_SUCCESS_ROLL}（人脈 ≥ 5 加 1）成功，月現金流 = 投入 × ${RETIREMENT_STARTUP_RETURN_RATE * 100}%；失敗損失一半。`,
    player.retirementDeferrals < RETIREMENT_MAX_DEFERRALS ? `4. 延後一輪退休：多領一輪薪水，HP 額外 −${RETIREMENT_DEFER_HP_COST}。` : '',
    `選退休、顧問或創業後，生活支出降兩成；創業另領基本年金 $${BASIC_PENSION_MONTHLY.toLocaleString()}。`,
    '65 歲起 HP 低於 60 每月多 $3,000 醫療，低於 30 再加 $9,000 長照。',
  ].filter(Boolean);
  return lines.join('\n');
}

/** 到達轉折輪時：所有存活玩家進入高齡支出階段；還在內圈工作的玩家排入轉折隊列。 */
export function queueRetirementCandidates(gs: GameState): void {
  if (gs.turnNumber < RETIREMENT_ROUND) return;
  for (const id of gs.playerOrder) {
    const player = gs.players.get(id);
    if (!player?.isAlive) continue;
    player.isSenior = true;
    if (player.isInFastTrack || player.retirementStatus !== 'working') continue;
    if (player.retirementDeferrals > 0 && player.retirementDeferralRound === gs.turnNumber) continue;
    if (!gs.retirementQueue.includes(id)) gs.retirementQueue.push(id);
  }
}

export function tryOpenRetirementScene(gs: GameState): boolean {
  if (gs.facilitatorScene || gs.decisionPhase || gs.turnInProgress || gs.globalPaydayInProgress) return false;
  while (gs.retirementQueue.length > 0) {
    const id = gs.retirementQueue.shift()!;
    const player = gs.players.get(id);
    if (!player?.isAlive || player.isInFastTrack || player.retirementStatus !== 'working') continue;
    beginFacilitatorScene(gs, {
      kind: 'retirement', kicker: '65 歲人生轉折', title: `${player.name} 的退休選擇`,
      description: retirementSceneDescription(player), participantNames: [player.name],
      careerPlayerId: player.id, careerConfirmed: false,
      reminderEndsAt: Date.now() + 90_000, options: [],
    }, { playerId: player.id, choice: null });
    return true;
  }
  return false;
}

/** 僅在完整操作結算後保存達標快照，不在月結中途判斷。 */
export function queueSecondLifeCandidates(gs: GameState, settledPlayer?: Player): void {
  if (![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase)) return;
  const queue = secondLifeQueue.get(gs) ?? [];
  for (const player of settledPlayer ? [settledPlayer] : gs.players.values()) {
    if (!player.isAlive || player.isInFastTrack || !player.hasPassedSecondLife || queue.some(e => e.playerId === player.id)) continue;
    const eligibility = evaluateSecondLifeEligibility(player);
    if (eligibility.eligible) queue.push({ playerId: player.id, eligibility });
  }
  secondLifeQueue.set(gs, queue);
}

export function tryOpenSecondLife(gs: GameState): boolean {
  if (gs.gamePhase === GamePhase.GameOver || gs.facilitatorScene || gs.decisionPhase || gs.turnInProgress || gs.globalPaydayInProgress) return false;
  const queue = secondLifeQueue.get(gs) ?? [];
  while (queue.length && (!gs.players.get(queue[0].playerId)?.isAlive || gs.players.get(queue[0].playerId)?.isInFastTrack)) queue.shift();
  const player = queue[0] && gs.players.get(queue[0].playerId);
  if (!player) return false;
  beginFacilitatorScene(gs, { kind: 'second_life', kicker: '第二人生資格已達成',
    title: player.name + ' 的第二人生即將啟動',
    description: '已路過第二人生格，並在完整結算後達成資格。由主持人揭曉，無須再繞一圈。',
    participantNames: [player.name], options: [{ id: 'reveal', label: '揭曉第二人生', description: '正式進入外圈。' }] },
    { playerId: player.id });
  return true;
}

export function revealSecondLife(gs: GameState): void {
  const entry = secondLifeQueue.get(gs)?.shift();
  const player = entry && gs.players.get(entry.playerId);
  if (!entry || !player?.isAlive || player.isInFastTrack) {
    revealFacilitatorResult(gs, '資格公告已結束', '請主持人繼續遊戲。'); return;
  }
  promoteSecondLife(gs, player, entry.eligibility);
}

export function promoteSecondLife(gs: GameState, player: Player, secondLifeEligibility: ReturnType<typeof evaluateSecondLifeEligibility>): void {
  const roomId = gs.gameId;
  const socket = getPlayerSocket(player.id);
  const escapeRouteLabel = secondLifeEligibility.route === 'balancedLife'
    ? '平衡人生'
    : '財務突破';
  const achievedLifeIndicators = secondLifeEligibility.indicators
    .filter((indicator) => indicator.achieved)
    .map((indicator) => indicator.label);
  console.log(`[ratRace] ${player.name}（${roomId}）透過「${escapeRouteLabel}」進入第二人生！`);
  const _rrCB = player.cash; const _rrFB = player.monthlyCashflow; const _rrNWB = calcNetWorth(player);
  player.isInFastTrack = true;
  const allAlivePlayersAreInFastTrack = [...gs.players.values()]
    .filter((candidate) => candidate.isAlive)
    .every((candidate) => candidate.isInFastTrack);
  if (allAlivePlayersAreInFastTrack) gs.gamePhase = GamePhase.FastTrack;
  addLifeExperience(player, LIFE_EXP.FAST_TRACK_ENTER);

  // B1：進入外圈時隨機抽 3 個人生夢想目標
  assignBucketList(player, gs, 3);
  const goalDetails = player.bucketList
    .map((e) => getBucketGoal(e.id))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((g) => ({
      id: g.id,
      emoji: g.emoji,
      title: g.title,
      description: g.describe?.(player) ?? g.description,
      legacyReward: g.legacyReward,
      lifeExpReward: g.lifeExpReward,
      cashReward: g.cashReward ?? 0,
    }));

  logPlayerEvent(
    player,
    gs,
    'rat_race_escaped',
    `進入第二人生（${escapeRouteLabel}）：有效被動收入 $${secondLifeEligibility.effectivePassiveIncome.toLocaleString()}，完成人生指標 ${achievedLifeIndicators.join('、')}`,
    _rrCB,
    _rrFB,
    _rrNWB,
    {
      escapeRoute: secondLifeEligibility.route,
      escapeRouteLabel,
      passiveIncome: secondLifeEligibility.rawPassiveIncome,
      effectivePassiveIncome: secondLifeEligibility.effectivePassiveIncome,
      totalExpenses: secondLifeEligibility.totalExpenses,
      coverageRatio: secondLifeEligibility.coverageRatio,
      achievedIndicatorCount: secondLifeEligibility.achievedIndicatorCount,
      indicators: secondLifeEligibility.indicators,
      financialBreakthroughMet: secondLifeEligibility.financialBreakthroughMet,
      balancedLifeMet: secondLifeEligibility.balancedLifeMet,
    },
  );
  emitToRoom(roomId, 'ratRaceEscaped', {
    playerId: player.id,
    playerName: player.name,
    route: secondLifeEligibility.route,
    routeLabel: escapeRouteLabel,
    monthlyPassiveIncome: secondLifeEligibility.rawPassiveIncome,
    effectivePassiveIncome: secondLifeEligibility.effectivePassiveIncome,
    totalExpenses: secondLifeEligibility.totalExpenses,
    achievedLifeIndicators,
    lifeExpGained: LIFE_EXP.FAST_TRACK_ENTER,
    canCongratulate: true,   // 前端可顯示祝賀按鈕
    bucketList: goalDetails,
  });
  if (socket) emitClient(socket, 'bucketListAssigned', { goals: goalDetails });

  // 立刻檢查一次：高被動收入、長壽等可能在進外圈當下就達成
  if (socket) checkBucketGoals(player, gs, roomId, socket);
  revealFacilitatorResult(gs, player.name + ' 的第二人生啟動了！', '完成「' + escapeRouteLabel + '」，正式進入外圈。新的機會與風險，現在開始。');
}

/** SK 首次達 100 時通知本人一次（發薪、旅遊、主持人調數值都可能觸發） */
export function announceCareerUnlock(gs: GameState, player: Player): void {
  if (!player.isAlive || player.careerUnlockAnnounced || player.stats.careerSkill < SKILL_CAREER_CHANGE_THRESHOLD) return;
  player.careerUnlockAnnounced = true;
  const socket = getPlayerSocket(player.id);
  const blocked = careerBlockReason(player, gs);
  if (socket) emitClient(socket, 'careerChangeUnlocked', {
    message: blocked
      ? `第二專長已達 100，可以轉職！但目前${blocked}。手機「🎯 申請轉職」區會列出所有職業。`
      : '第二專長已達 100，可以轉職！打開手機「🎯 申請轉職」區，點職業看薪資與代價，送出申請後由主持人在大螢幕開舞台。',
    availableProfessions: buildAvailableProfessions(player),
    blockReason: blocked,
  });
  emitToRoom(gs.gameId, 'milestoneAnnounced', {
    playerId: player.id, playerName: player.name, milestone: '轉職解鎖',
    description: `${player.name} 的第二專長達到頂峰，可以申請轉職了！`,
  });
}
