/** 全體發薪：計時、全員同時規劃、依序結算 */
import { Socket } from 'socket.io';
import { GameState, Player, PaydayPlanPayload, GamePhase } from './gameDataModels';
import { BASIC_INVESTMENTS, buyBasicInvestment } from './basicInvestments';
import { currentBondRate, shiftBondRate } from './bondFund';
import { resolveNegativeCash } from './bankruptcy';
import { ageCar } from './cars';
import { LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS } from './gameConfig';
import { syncPlayerAges, triggerPayday, checkAndApplyAnnualTax, getCurrentAge, applyFastTrackAppreciation, applyFastTrackPaydayBonus, pauseGameClock, resumeGameClock } from './gameLogic';
import { PLAN_COVER_ROUNDS, FAST_TRACK_ROUND_SHARE, MONTHS_PER_GLOBAL_PAYDAY, PAYDAY_MAX_ROUNDS, MONTHS_PER_ROUND, CONSULTANT_HP_COST_PER_CYCLE, GROWTH_CYCLES_PER_GLOBAL_PAYDAY, YEARS_PER_COMPLETED_ROUND, STOCK_DCA_MONTHLY_RETURN_RATE, STOCK_DCA_MONTHLY_DIVIDEND_RATE } from './gameConfig';
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

/** 逐月入帳，保留月支出、複利、年度稅與健康衰退；回傳每 12 個月的現金變化（逐年顯示用）。 */
export function settleQuarterMonths(
  socket: Socket | undefined,
  gs: GameState,
  player: Player,
  maintenanceCovered: boolean,
  settlementMonths = MONTHS_PER_GLOBAL_PAYDAY,
  growthCycles = GROWTH_CYCLES_PER_GLOBAL_PAYDAY,
  fastTrackShare = 1,
  /** 傳入時改為累計稅額，不逐年廣播（每輪發薪一次說明，避免大螢幕洗版） */
  taxTotals?: { paid: number; saved: number },
): number[] {
  const yearlyCash: number[] = [];
  let yearStartCash = player.cash;
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
      const cashDelta = player.cash - yearCashBefore;
      const fromAge = Math.max(player.startAge ?? 20, eventAge - YEARS_PER_COMPLETED_ROUND);
      logPlayerEvent(
        player,
        gs,
        'payday',
        `${fromAge}–${eventAge} 歲發薪（${Math.round(Math.min(settlementMonths, monthsPerRound) / 12)} 年）：現金 ${cashDelta >= 0 ? '+' : '-'}$${Math.abs(cashDelta).toLocaleString()}`,
        yearCashBefore,
        yearFlowBefore,
        yearWorthBefore,
        { round: gs.turnNumber, yearIndex, yearsCovered, monthsSettled: month },
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
    if (month % 12 === 0 || month === settlementMonths) {
      yearlyCash.push(player.cash - yearStartCash);
      yearStartCash = player.cash;
    }

    const { triggered, taxResult } = checkAndApplyAnnualTax(player);
    if (triggered && taxResult && taxTotals) {
      taxTotals.paid += taxResult.taxAmount;
      taxTotals.saved += taxResult.taxCreditAmount ?? 0;
    } else if (triggered && taxResult) {
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
    const bonus = applyFastTrackPaydayBonus(player, fastTrackShare);
    applyFastTrackAppreciation(player, fastTrackShare);
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
  return yearlyCash;
}

/**
 * 一輪（4 年）結束就發薪；跳過進修、移除玩家也可能完成一輪，所以依「已發到第幾輪」補發。
 * 舊存檔沒有這個欄位時從目前輪數開始算，不補發過去的輪。
 */
export function payCompletedRounds(gs: GameState): void {
  if (typeof gs.lastPaidRound !== 'number' || gs.lastPaidRound > gs.turnNumber) gs.lastPaidRound = gs.turnNumber;
  while (gs.lastPaidRound < gs.turnNumber) {
    gs.lastPaidRound += 1;
    syncPlayerAges(gs);
    settleRound(gs);
  }
}

export interface RoundPayout {
  playerId: string;
  playerName: string;
  fromAge: number;
  toAge: number;
  /** 每年的現金變化（依序對應 fromAge、fromAge+1…） */
  years: { age: number; cash: number }[];
  total: number;
  cashAfter: number;
  monthlyCashflow: number;
  /** 這一輪繳的所得稅與稅務規劃省下的金額（已含在每年的現金變化裡） */
  taxPaid: number;
  taxSaved: number;
}

/**
 * 每輪發薪：每輪人生 4 年，一輪結束就把這 4 年（monthsPerRound 個月）的收入與支出入帳。
 * 不需要任何人操作；投資、保險、生活方式等決定留給定期的「人生規劃」。
 */
export function settleRound(gs: GameState): RoundPayout[] {
  const monthsPerRound = gs.monthsPerRound || MONTHS_PER_ROUND;
  const toAge = Math.round(getCurrentAge(gs));
  const roundStartAge = toAge - YEARS_PER_COMPLETED_ROUND;
  const payouts: RoundPayout[] = [];
  for (const playerId of gs.playerOrder) {
    const player = gs.players.get(playerId);
    if (!player?.isAlive) continue;
    // 22 歲或進修到 25 歲才開始工作的人，只結算開始工作之後的年數
    const fromAge = Math.max(player.startAge ?? 20, roundStartAge);
    const yearsLived = toAge - fromAge;
    if (yearsLived <= 0) continue;
    const months = Math.round(monthsPerRound * yearsLived / YEARS_PER_COMPLETED_ROUND);
    const cashBefore = player.cash;
    const covered = (player.healthMaintenanceRounds ?? 0) > 0;
    const taxTotals = { paid: 0, saved: 0 };
    const yearly = settleQuarterMonths(getPlayerSocket(player.id), gs, player, covered, months, 1, FAST_TRACK_ROUND_SHARE * yearsLived / YEARS_PER_COMPLETED_ROUND, taxTotals);
    if (covered) player.healthMaintenanceRounds -= 1;
    // 車子折舊、好車帶來的體驗
    ageCar(player, yearsLived);
    const ageStep = yearly.length > 0 ? yearsLived / yearly.length : 1;
    payouts.push({
      playerId: player.id,
      playerName: player.name,
      fromAge,
      toAge,
      years: yearly.map((cash, index) => ({ age: Math.round(fromAge + index * ageStep), cash })),
      total: player.cash - cashBefore,
      cashAfter: player.cash,
      monthlyCashflow: player.monthlyCashflow,
      taxPaid: taxTotals.paid,
      taxSaved: taxTotals.saved,
    });
    // 現金為負：賣流動資產 → 應急借款 → 賣其他投資 → 破產重整
    const beforeResolveCash = player.cash; const beforeResolveFlow = player.monthlyCashflow; const beforeResolveWorth = calcNetWorth(player);
    const resolution = resolveNegativeCash(gs, player);
    if (resolution) {
      const text = resolution.steps.join('；');
      logPlayerEvent(player, gs, 'crisis', `${resolution.bankrupt ? '💥 破產重整' : '💸 現金透支處理'}：${text}`, beforeResolveCash, beforeResolveFlow, beforeResolveWorth, { bankrupt: resolution.bankrupt, source: 'negative_cash' });
      emitToRoom(gs.gameId, 'notification', { message: `${resolution.bankrupt ? '💥' : '💸'} ${player.name}：${text}` });
      if (resolution.bankrupt) emitToRoom(gs.gameId, 'playerBankrupt', { playerId: player.id, playerName: player.name, steps: resolution.steps });
    }
    queueSecondLifeCandidates(gs, player);
  }
  if (payouts.length > 0) {
    emitToRoom(gs.gameId, 'roundPayday', { round: gs.turnNumber, months: monthsPerRound, payouts });
  }
  return payouts;
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
  // 利率環境：每次人生規劃前調整一次，已持有的債券基金配息跟著重算
  const rateShift = shiftBondRate(gs);
  if (rateShift.to !== rateShift.from) {
    const arrow = rateShift.to > rateShift.from ? '📈 升息' : '📉 降息';
    emitToRoom(roomId, 'notification', { message: `${arrow}：債券基金年殖利率 ${(rateShift.from * 100).toFixed(1)}% → ${(rateShift.to * 100).toFixed(1)}%，已持有的配息跟著調整。` });
  }
  gs.bondRateHistory ??= [];
  gs.bondRateHistory.push({ age: Math.round(getCurrentAge(gs)), rate: rateShift.to });

  // 薪水每輪已經入帳；人生規劃只做決定。健康維護等花費涵蓋接下來 PLAN_COVER_ROUNDS 輪。
  const settlementMonths = 0;
  const growthCycles = PLAN_COVER_ROUNDS;

  emitToRoom(roomId, 'globalPaydayStarted', {
    globalPaydayNumber: gs.globalPaydayNumber + 1,
    settlementMonths,
    growthCycles,
    playerCount: playerIds.length,
  });
  emitToRoom(roomId, 'gamePaused', {
    reason: `第 ${gs.globalPaydayNumber + 1} 次人生規劃`,
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
    `第 ${gs.globalPaydayNumber + 1} 次人生規劃`,
    '所有人同時在手機規劃接下來幾輪：投資、保險、進修、生活方式。薪水每輪已自動入帳；全員送出後生效，主持人也可提前以空白方案結束。',
    { publicLines: [
      `🗓️ 每人可配置：財商升級、健康投資（涵蓋 ${PLAN_COVER_ROUNDS} 輪）、專長培訓、人脈投資、保險、股票定期定額、債券`,
      `🏦 目前利率：債券基金年殖利率 ${(currentBondRate(gs) * 100).toFixed(1)}%（每次人生規劃會變動）`,
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
      actionInfo: buildActionInfo(player, gs),
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

    const quarterlyPlan = { ...plan, settlementMonths, growthCycles, bondRateAnnual: currentBondRate(gs) };
    const planCash = player.cash;
    const planFlow = player.monthlyCashflow;
    const planWorth = calcNetWorth(player);
    const lifestyleBefore = player.lifestyle;
    const habitBefore = player.healthHabit;
    if (quarterlyPlan.lifestyle && LIFESTYLE_OPTIONS[quarterlyPlan.lifestyle]) player.lifestyle = quarterlyPlan.lifestyle;
    if (quarterlyPlan.healthHabit && HEALTH_HABIT_OPTIONS[quarterlyPlan.healthHabit]) player.healthHabit = quarterlyPlan.healthHabit;
    const planResult = applyPaydayPlan(player, quarterlyPlan);
    logPaydayPlan(gs, player, planResult, lifestyleBefore, habitBefore, planCash, planFlow, planWorth);
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
    // 健康維護涵蓋接下來幾輪的每輪發薪（不再在這裡入帳）
    if (maintenanceCovered) player.healthMaintenanceRounds = Math.max(player.healthMaintenanceRounds ?? 0, PLAN_COVER_ROUNDS);
    if (playerSocket && player.isAlive) {
      checkLifeMilestones(player, gs, gs.gameId, playerSocket);
      checkBucketGoals(player, gs, gs.gameId, playerSocket);
    }
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

const INSURANCE_LABELS: Record<string, string> = { medical: '醫療險', life: '壽險', property: '產險' };

/**
 * 把一次發薪日的個人規劃寫進事件紀錄，復盤時間軸才看得到定期定額、債券、保險與成長投資。
 * meta.monthlyCashflow 是這次新增的被動收入估計，讓「第一筆資產」的年齡能被算到。
 */
export function logPaydayPlan(
  gs: GameState,
  player: Player,
  result: ReturnType<typeof applyPaydayPlan>,
  lifestyleBefore: Player['lifestyle'],
  habitBefore: Player['healthHabit'],
  cashBefore: number,
  cashflowBefore: number,
  netWorthBefore: number,
): void {
  const parts: string[] = [];
  let passiveAdded = 0;
  if (result.stockDCA.executed && result.stockDCA.amount > 0) {
    parts.push(`股票定期定額 $${result.stockDCA.amount.toLocaleString()}`);
    passiveAdded += Math.round(result.stockDCA.amount * STOCK_DCA_MONTHLY_DIVIDEND_RATE);
  }
  if (result.bond.executed && result.bond.amount > 0) {
    parts.push(`債券基金 $${result.bond.amount.toLocaleString()}（月配息 +$${Math.round(result.bond.monthlyIncome).toLocaleString()}）`);
    passiveAdded += Math.round(result.bond.monthlyIncome);
  }
  const growth = Object.values(result.investments).filter((item) => item.executed).map((item) => item.description);
  parts.push(...growth);
  const insurance = result.insurancePurchases.filter((item) => item.success).map((item) => INSURANCE_LABELS[item.type] ?? item.type);
  if (insurance.length > 0) parts.push(`投保 ${insurance.join('、')}`);
  if (player.lifestyle !== lifestyleBefore) {
    parts.push(`生活方式 ${LIFESTYLE_OPTIONS[lifestyleBefore]?.label ?? lifestyleBefore} → ${LIFESTYLE_OPTIONS[player.lifestyle]?.label ?? player.lifestyle}`);
  }
  if (player.healthHabit !== habitBefore) {
    parts.push(`健康習慣 ${HEALTH_HABIT_OPTIONS[habitBefore]?.label ?? habitBefore} → ${HEALTH_HABIT_OPTIONS[player.healthHabit]?.label ?? player.healthHabit}`);
  }
  if (parts.length === 0) return;
  logPlayerEvent(player, gs, 'payday_plan', `發薪規劃：${parts.join('；')}`, cashBefore, cashflowBefore, netWorthBefore, {
    globalPaydayNumber: gs.globalPaydayNumber + 1,
    stockDCA: result.stockDCA.executed ? result.stockDCA.amount : 0,
    bond: result.bond.executed ? result.bond.amount : 0,
    growth,
    insurance,
    lifestyle: player.lifestyle,
    healthHabit: player.healthHabit,
    monthlyCashflow: passiveAdded,
    totalCost: result.totalCostDeducted,
  });
}
