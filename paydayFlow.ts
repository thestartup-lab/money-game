/** 全體發薪：計時、全員同時規劃、依序結算 */
import { Socket } from 'socket.io';
import { GameState, Player, PaydayPlanPayload, GamePhase } from './gameDataModels';
import { BASIC_INVESTMENTS, buyBasicInvestment } from './basicInvestments';
import { LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS } from './gameConfig';
import { triggerPayday, checkAndApplyAnnualTax, getCurrentAge, applyFastTrackAppreciation, applyFastTrackPaydayBonus, pauseGameClock, resumeGameClock } from './gameLogic';
import { MONTHS_PER_GLOBAL_PAYDAY, PAYDAY_MAX_ROUNDS, MONTHS_PER_ROUND, CONSULTANT_HP_COST_PER_CYCLE, GROWTH_CYCLES_PER_GLOBAL_PAYDAY, YEARS_PER_COMPLETED_ROUND, STOCK_DCA_MONTHLY_RETURN_RATE, STOCK_DCA_MONTHLY_DIVIDEND_RATE } from './gameConfig';
import { expireWorldEffects } from './worldEvents';
import { applyPaydayPlan, checkBedriddenStatus, applyHPChange } from './statsSystem';
import { serializeGameState, buildActionInfo, buildAffordableOptions } from './playerView';
import {
  advanceTurn, announceCareerUnlock, beginHostDecisionPhase, calcNetWorth, checkBucketGoals, checkLifeMilestones,
  emitCellEvent, emitClient, emitToRoom, evaluateAndMaybeTriggerAdaptiveEvent, executeSocialAction, executeTravelAction,
  getPlayerSocket, getQuarterTravelDestinations, logPlayerEvent, maybeCompleteActionPhase, pendingSubmissions, privateReplay,
  queueSecondLifeCandidates, tryOpenSecondLife, tryOpenWorldEvent, waitForHostRelease,
} from './socketServer';

export function emitQuarterMilestones(
  socket: Socket,
  gs: GameState,
  player: Player,
  planResult: ReturnType<typeof applyPaydayPlan>,
): void {
  void planResult;
  announceCareerUnlock(gs, player);

  const ntLabels: Record<number, string> = {
    3: '人脈護盾解鎖 — 危機時可豁免一次！',
    5: '交易加持解鎖 — 落地交易格可抽 2 張牌！',
    8: '人脈大師 — 達成成就！',
  };
  for (const nt of planResult.ntMilestonesUnlocked ?? []) {
    emitCellEvent(socket, gs.gameId, player.name, `NT ${nt} 達成`, `🌐 ${ntLabels[nt] ?? ''}`);
    emitToRoom(gs.gameId, 'milestoneAnnounced', {
      playerId: player.id,
      playerName: player.name,
      milestone: `NT ${nt}`,
      description: `${player.name} 人脈值達到 ${nt}！${ntLabels[nt] ?? ''}`,
    });
  }
}

/** 將季度中的三個月逐月入帳，保留月支出、複利、年度稅與健康衰退。 */
export function settleQuarterMonths(
  socket: Socket | undefined,
  gs: GameState,
  player: Player,
  maintenanceCovered: boolean,
  settlementMonths = MONTHS_PER_GLOBAL_PAYDAY,
  growthCycles = GROWTH_CYCLES_PER_GLOBAL_PAYDAY,
): void {
  // 復盤用：每 12 個月記一筆發薪事件，年齡依「距上次發薪經過的輪數」往前推，讓時間軸每輪一點
  const monthsPerRound = gs.monthsPerRound || MONTHS_PER_ROUND;
  const yearsCovered = Math.max(1, Math.round(settlementMonths / monthsPerRound));
  const currentAgeNow = Math.max(player.startAge ?? 20, getCurrentAge(gs));
  let yearCashBefore = player.cash;
  let yearFlowBefore = player.monthlyCashflow;
  let yearWorthBefore = calcNetWorth(player);
  for (let month = 1; month <= settlementMonths; month += 1) {
    const dcaAsset = player.assets.find((asset) => asset.id === 'stock-dca');
    let dcaDividend = 0;

    if (dcaAsset) {
      const valueBeforeGrowth = dcaAsset.currentValue ?? dcaAsset.cost;
      dcaDividend = Math.round(valueBeforeGrowth * STOCK_DCA_MONTHLY_DIVIDEND_RATE);
      dcaAsset.monthlyCashflow = dcaDividend;
    }

    triggerPayday(player, gs, maintenanceCovered, month <= growthCycles);
    if (month <= growthCycles && player.retirementStatus === 'consultant' && player.salary > 0) applyHPChange(player, -CONSULTANT_HP_COST_PER_CYCLE);
    if (month % monthsPerRound === 0 || month === settlementMonths) {
      const yearIndex = Math.ceil(month / monthsPerRound);
      const eventAge = Math.round(currentAgeNow - (yearsCovered - yearIndex) * YEARS_PER_COMPLETED_ROUND);
      logPlayerEvent(
        player,
        gs,
        'payday',
        `第 ${gs.globalPaydayNumber + 1} 次發薪・第 ${yearIndex}/${yearsCovered} 輪結算（${monthsPerRound} 個月，現金 ${player.cash - yearCashBefore >= 0 ? '+' : '-'}$${Math.abs(player.cash - yearCashBefore).toLocaleString()}）`,
        yearCashBefore,
        yearFlowBefore,
        yearWorthBefore,
        { globalPaydayNumber: gs.globalPaydayNumber + 1, yearIndex, yearsCovered, monthsSettled: month },
        eventAge,
      );
      yearCashBefore = player.cash;
      yearFlowBefore = player.monthlyCashflow;
      yearWorthBefore = calcNetWorth(player);
    }

    if (dcaAsset) {
      const previousValue = dcaAsset.currentValue ?? dcaAsset.cost;
      dcaAsset.currentValue = Math.round(previousValue * (1 + STOCK_DCA_MONTHLY_RETURN_RATE));
    }

    if (!player.profession.hasFlexibleSchedule) player.actionTokensThisPayday = 1;

    const { triggered, taxResult } = checkAndApplyAnnualTax(player);
    if (triggered && taxResult) {
      emitToRoom(gs.gameId, 'annualTaxResult', {
        playerId: player.id,
        playerName: player.name,
        year: player.paydayCount / 12,
        annualIncome: taxResult.annualIncome,
        deductions: taxResult.deductions,
        taxableIncome: taxResult.taxableIncome,
        taxBeforeCredit: taxResult.taxBeforeCredit,
        taxCreditRate: taxResult.taxCreditRate,
        taxCreditAmount: taxResult.taxCreditAmount,
        taxAmount: taxResult.taxAmount,
        bracketBreakdown: taxResult.bracketBreakdown,
        cashAfterTax: player.cash,
      });
    }
  }

  if (player.isInFastTrack) {
    const bonus = applyFastTrackPaydayBonus(player);
    applyFastTrackAppreciation(player);
    emitToRoom(gs.gameId, 'fastTrackPayday', {
      playerId: player.id,
      playerName: player.name,
      cashflow: player.monthlyCashflow * settlementMonths,
      bonus,
      cashAfter: player.cash,
    });
  }

  const justBedridden = checkBedriddenStatus(player);
  if (justBedridden) {
    emitToRoom(gs.gameId, 'playerBedridden', {
      playerId: player.id,
      playerName: player.name,
      age: Math.round(getCurrentAge(gs)),
    });
  }

  if (socket && player.isAlive) {
    checkLifeMilestones(player, gs, gs.gameId, socket);
    checkBucketGoals(player, gs, gs.gameId, socket);
  }
}

/** 遊戲開始後扣掉暫停的有效經過毫秒數（舞台事件、決策、手動暫停都不算）。 */
export function getActiveElapsedMs(gs: GameState): number {
  if (!gs.gameStartTime) return 0;
  const pausedNow = gs.pausedAt ? Date.now() - gs.pausedAt.getTime() : 0;
  return Math.max(0, Date.now() - gs.gameStartTime.getTime() - gs.totalPausedMs - pausedNow);
}

/** 距上次發薪經過的輪數（至少算一輪）。 */
export function roundsSinceLastPayday(gs: GameState): number {
  return Math.max(1, gs.turnNumber - gs.roundsAtLastPayday);
}

/** 本次（或下一次）發薪要結算的月數 = 經過輪數 × 12。 */
export function paydaySettlementMonths(gs: GameState): number {
  return roundsSinceLastPayday(gs) * (gs.monthsPerRound || MONTHS_PER_ROUND);
}

/**
 * 發薪計時用的經過時間：只扣主持人手動暫停與發薪進行中的時間。
 * 決策、落格說明、舞台都照常計時——工作坊大部分時間都在這些階段，若也暫停會整場等不到發薪。
 */
export function getPaydayElapsedMs(gs: GameState): number {
  if (!gs.gameStartTime) return 0;
  const pausedNow = gs.paydayPausedAt ? Date.now() - gs.paydayPausedAt.getTime() : 0;
  return Math.max(0, Date.now() - gs.gameStartTime.getTime() - gs.paydayPausedMs - pausedNow);
}

export function pausePaydayClock(gs: GameState): void { if (!gs.paydayPausedAt) gs.paydayPausedAt = new Date(); }

export function resumePaydayClock(gs: GameState): void {
  if (!gs.paydayPausedAt) return;
  gs.paydayPausedMs += Date.now() - gs.paydayPausedAt.getTime();
  gs.paydayPausedAt = null;
}

/** 計時發薪的剩餘毫秒數（只在手動暫停與發薪中凍結）。 */
export function paydayRemainingMs(gs: GameState): number {
  if (!gs.paydayTimerEnabled) return -1;
  return Math.max(0, gs.paydayIntervalMs - (getPaydayElapsedMs(gs) - gs.lastPaydayActiveMs));
}

/**
 * 混合制：計時器到期「而且」至少經過一輪才到期；計時器關閉時由 advanceToNextTurn 的每三輪備援處理。
 * 到期的發薪排在目前玩家行動結束時（advanceTurn）或全場空檔時執行。
 */
export function isPaydayDue(gs: GameState): boolean {
  if (!gs.paydayTimerEnabled || gs.gamePhase === GamePhase.GameOver || gs.finalRoundStarted) return false;
  const rounds = gs.turnNumber - gs.roundsAtLastPayday;
  if (rounds < 1) return false;
  // 保底：不管計時器，超過 PAYDAY_MAX_ROUNDS 輪一定發薪
  if (rounds >= PAYDAY_MAX_ROUNDS) return true;
  return paydayRemainingMs(gs) <= 0;
}

export function schedulePaydayIfDue(gs: GameState): boolean {
  if (gs.globalPaydayPending || gs.globalPaydayInProgress) return false;
  if (!isPaydayDue(gs)) return false;
  gs.globalPaydayPending = true;
  console.log(`[paydayTimer] 房間 ${gs.gameId} 計時到期，發薪排入目前行動結束後（經過 ${roundsSinceLastPayday(gs)} 輪）`);
  return true;
}

/** 計時到期後排在目前行動結束執行；全員同時規劃、依回合順序結算，結算月數 = 經過輪數 × 12。 */
export async function runGlobalPayday(gs: GameState): Promise<void> {
  const roomId = gs.gameId;
  const wasPaused = gs.pausedAt !== null;
  if (!wasPaused) pauseGameClock(gs);
  pausePaydayClock(gs);

  gs.globalPaydayPending = false;
  const playerIds = gs.playerOrder.filter((id) => gs.players.get(id)?.isAlive);
  const settlementMonths = paydaySettlementMonths(gs);
  const growthCycles = roundsSinceLastPayday(gs);

  emitToRoom(roomId, 'globalPaydayStarted', {
    globalPaydayNumber: gs.globalPaydayNumber + 1,
    settlementMonths,
    growthCycles,
    playerCount: playerIds.length,
  });
  emitToRoom(roomId, 'gamePaused', {
    reason: `第 ${gs.globalPaydayNumber + 1} 季全體發薪`,
    currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    controlledByHost: true,
  });
  emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

  const emptyPlan: PaydayPlanPayload = {
    investInFQUpgrade: false,
    investInHealthMaintenance: false,
    investInHealthBoost: false,
    investInSkillTraining: false,
    investInNetwork: false,
    stockDCAAmount: 0,
    buyInsuranceTypes: [],
    settlementMonths,
    growthCycles,
  };

  // ── 全體同時規劃：一個決策階段，每人各自在手機送出；全員送出自動結算 ──
  const plans = new Map<string, PaydayPlanPayload>();
  const context = beginHostDecisionPhase(
    gs,
    { id: '__all_players__', name: '全體玩家' },
    'payday',
    `第 ${gs.globalPaydayNumber + 1} 次全體發薪規劃（結算 ${growthCycles} 輪 × ${gs.monthsPerRound || MONTHS_PER_ROUND} 個月）`,
    '所有人同時在手機填寫這段期間的規劃；全員送出後自動結算，主持人也可提前以空白方案結束。',
    { publicLines: [
      `💰 結算 ${settlementMonths} 個月薪資與支出；每人可配置：財商升級、健康投資、專長培訓、人脈投資、保險、股票定期定額`,
      `🏦 基本投資（每人最多一種、最多 10 份）：${BASIC_INVESTMENTS.map((b) => `${b.name} $${b.cost.toLocaleString()}／份、每月 +$${b.monthlyCashflow.toLocaleString()}`).join('；')}`,
    ] },
  );
  gs.actionPhaseDone = new Set();
  emitToRoom(roomId, 'paydayPlanningStarted', {
    paydayPosition: -1,
    settlementCount: settlementMonths,
    settlementMonths,
    growthCycles,
    globalPayday: true,
    globalPaydayNumber: gs.globalPaydayNumber + 1,
    playerCount: playerIds.length,
    currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    timeoutMs: 0,
    controlledByHost: true,
  });
  for (const [index, playerId] of playerIds.entries()) {
    const player = gs.players.get(playerId);
    if (!player?.isAlive) continue;
    const playerSocket = getPlayerSocket(player.id);
    if (!playerSocket || player.isDisconnected) {
      plans.set(player.id, emptyPlan);
      gs.actionPhaseDone.add(player.id);
      continue;
    }
    player.paydayPlanningPending = true;
    emitClient(playerSocket, 'paydayPlanningRequired', {
      paydayPosition: -1,
      paydayIndex: index + 1,
      totalPaydays: playerIds.length,
      combinedPlanning: true,
      settlementMonths,
      growthCycles,
      globalPayday: true,
      globalPaydayNumber: gs.globalPaydayNumber + 1,
      currentStats: player.stats,
      currentCash: player.cash,
      affordableOptions: buildAffordableOptions(player, growthCycles),
      basicInvestments: BASIC_INVESTMENTS,
      currentInsurance: player.insurance,
      currentLifestyle: player.lifestyle,
      currentHealthHabit: player.healthHabit,
      actionInfo: buildActionInfo(player),
      lifestyleOptions: LIFESTYLE_OPTIONS,
      healthHabitOptions: HEALTH_HABIT_OPTIONS,
      livingExpensesBase: player.expenses.otherExpenses,
      stockDCAPortfolioValue: player.assets.find((asset) => asset.id === 'stock-dca')?.currentValue ?? 0,
      travelDestinations: getQuarterTravelDestinations(player),
      timeoutMs: 0,
      controlledByHost: true,
      marketTip: null,
    });
    pendingSubmissions.set(player.id, {
      phaseId: context.phaseId,
      event: 'submitPaydayPlan',
      submit: (value) => {
        if (plans.has(player.id)) return; // 重複送出只算第一次
        plans.set(player.id, (value as PaydayPlanPayload) ?? emptyPlan);
        gs.actionPhaseDone.add(player.id);
        emitClient(playerSocket, 'decisionSubmitted', { phaseId: context.phaseId });
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        maybeCompleteActionPhase(gs);
      },
    });
  }
  emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  await waitForHostRelease(gs, context);
  for (const playerId of playerIds) {
    if (pendingSubmissions.get(playerId)?.phaseId === context.phaseId) pendingSubmissions.delete(playerId);
    privateReplay.delete(playerId);
  }
  gs.actionPhaseDone = new Set();

  // ── 依順序逐位結算 ──
  for (const [index, playerId] of playerIds.entries()) {
    const player = gs.players.get(playerId);
    if (!player?.isAlive) continue;
    const playerSocket = getPlayerSocket(player.id);
    const plan = plans.get(player.id) ?? emptyPlan;
    emitToRoom(roomId, 'globalPaydayPlayerTurn', {
      playerId: player.id,
      playerName: player.name,
      playerIndex: index + 1,
      playerCount: playerIds.length,
      globalPaydayNumber: gs.globalPaydayNumber + 1,
    });

    const quarterlyPlan = { ...plan, settlementMonths, growthCycles };
    if (quarterlyPlan.lifestyle && LIFESTYLE_OPTIONS[quarterlyPlan.lifestyle]) player.lifestyle = quarterlyPlan.lifestyle;
    if (quarterlyPlan.healthHabit && HEALTH_HABIT_OPTIONS[quarterlyPlan.healthHabit]) player.healthHabit = quarterlyPlan.healthHabit;
    const planResult = applyPaydayPlan(player, quarterlyPlan);
    const maintenanceCovered =
      planResult.investments.healthBoost.executed ||
      planResult.investments.healthMaintenance.executed;

    if (playerSocket) {
      if (quarterlyPlan.lifeChoice?.type === 'travel') {
        executeTravelAction(playerSocket, gs, player, quarterlyPlan.lifeChoice.destinationId);
      } else if (quarterlyPlan.lifeChoice?.type === 'social') {
        executeSocialAction(playerSocket, gs, player);
      }
      emitQuarterMilestones(playerSocket, gs, player, planResult);
    }

    const investmentCash = player.cash;
    const investmentFlow = player.monthlyCashflow;
    const investmentWorth = calcNetWorth(player);
    const basicInvestment = buyBasicInvestment(player, quarterlyPlan.basicInvestmentId, gs.globalPaydayNumber + 1, quarterlyPlan.basicInvestmentQuantity ?? 1);
    if (basicInvestment.success) {
      logPlayerEvent(player, gs, 'asset_buy', basicInvestment.message, investmentCash, investmentFlow, investmentWorth,
        { source: 'basic_investment', offerId: quarterlyPlan.basicInvestmentId, globalPaydayNumber: gs.globalPaydayNumber + 1 });
    }
    emitToRoom(roomId, 'basicInvestmentResult', { playerId: player.id, playerName: player.name, ...basicInvestment });
    settleQuarterMonths(playerSocket, gs, player, maintenanceCovered, settlementMonths, growthCycles);
    queueSecondLifeCandidates(gs, player);
    player.paydayPlanningPending = false;

    emitToRoom(roomId, 'paydayPlanResult', {
      playerId: player.id,
      playerName: player.name,
      paydayPosition: -1,
      settlementCount: settlementMonths,
      settlementMonths,
      globalPayday: true,
      globalPaydayNumber: gs.globalPaydayNumber + 1,
      planResult,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  }

  gs.roundsSinceGlobalPayday = 0;
  gs.roundsAtLastPayday = gs.turnNumber;
  resumePaydayClock(gs);
  gs.lastPaydayActiveMs = getPaydayElapsedMs(gs);
  gs.globalPaydayNumber += 1;
  gs.globalPaydayInProgress = false;
  const expiredWorldEvents = expireWorldEffects(gs);
  if (expiredWorldEvents.length) emitToRoom(roomId, 'globalEventAnnouncement', {
    event: { title: '限期影響結束', description: `${expiredWorldEvents.join('、')}的收入／生活費效果已解除。` }, stageManaged: true,
  });

  emitToRoom(roomId, 'globalPaydayCompleted', {
    globalPaydayNumber: gs.globalPaydayNumber,
    settlementMonths,
    nextPlayer: (() => {
      const player = gs.players.get(gs.currentPlayerTurnId);
      if (!player) return undefined;
      return {
        id: player.id,
        name: player.name,
        professionName: player.profession.name,
        colorIndex: Math.max(0, gs.playerOrder.indexOf(player.id)),
      };
    })(),
  });

  if (!wasPaused && gs.pausedAt !== null) {
    resumeGameClock(gs);
    emitToRoom(roomId, 'gameResumed', {
      resumedAt: new Date(),
      currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    });
  }
  queueSecondLifeCandidates(gs);
  tryOpenSecondLife(gs);
  evaluateAndMaybeTriggerAdaptiveEvent(gs);
  tryOpenWorldEvent(gs);
  emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
}
