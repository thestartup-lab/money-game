/** 20 歲前設定：投胎、成長點數、進修、選職業（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { createPlayer, rollSocialClass, applyGrowthStats, getAvailableProfessions, applyEducationLoan } from '../gameLogic';
import { SOCIAL_CLASS_CONFIG, LIFE_EXP, E_PROFESSION_POOLS, S_PROFESSION_POOLS, B_PROFESSION_POOLS, I_PROFESSION_POOLS, QUADRANT_SELECT_THRESHOLDS, PROFESSIONS } from '../gameConfig';
import { syncHouseholdLoans } from '../householdLoans';
import {
  OnSafe, calcNetWorth, emitClient, emitToRoom, getRoomState, logPlayerEvent,
  playerIdentity, playerSessions, serializeGameState,
} from '../socketServer';

export function registerSetupHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 百歲人生：開局流程事件
  // ----------------------------------------------------------

  onSafe('rollSocialClass', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }

    const session = playerSessions.get(player.id);
    if (session?.setupStep) { emitClient(socket, 'error', { message: '出生背景已確定，不能重複抽取。' }); return; }
    if (session) session.setupStep = 'allocate';
    const sc = rollSocialClass();
    const config = SOCIAL_CLASS_CONFIG[sc];

    player.socialClass = sc;
    player.growthPointsRemaining = config.growthPoints;
    player.cash += config.startingCashBonus;

    console.log(`[rollSocialClass] ${player.name}（${gs.gameId}）投胎為「${config.label}」`);

    emitClient(socket, 'socialClassRolled', {
      socialClass: sc,
      label: config.label,
      growthPoints: config.growthPoints,
      startingCashBonus: config.startingCashBonus,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('allocateGrowthStats', (payload: { academic: number; health: number; social: number; resource: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }
    const session = playerSessions.get(player.id);
    if (session?.setupStep !== 'allocate') { emitClient(socket, 'error', { message: '請先確定出生背景，且成長點數只能分配一次。' }); return; }

    const { academic, health, social, resource } = payload;
    const total = academic + health + social + resource;

    if (total > player.growthPointsRemaining) {
      emitClient(socket, 'error', { message: `分配點數 (${total}) 超過可用點數 (${player.growthPointsRemaining})。` });
      return;
    }
    if ([academic, health, social, resource].some((v) => v < 0)) {
      emitClient(socket, 'error', { message: '各維度點數不可為負數。' });
      return;
    }

    const _gsCashBefore = player.cash;
    applyGrowthStats(player, { academic, health, social, resource });
    session.setupStep = 'career';
    const resourceCashGain = player.cash - _gsCashBefore;

    const availableProfessions = getAvailableProfessions(player).map((p) => ({
      id: p.id,
      name: p.name,
      quadrant: p.quadrant,
      startingSalary: p.startingSalary,
      salaryType: p.salaryType,
      hasFlexibleSchedule: p.hasFlexibleSchedule,
    }));

    emitClient(socket, 'growthStatsApplied', {
      stats: player.stats,
      availableProfessions,
      canContinueEducation: true,
      resourceCashGain,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('continueEducation', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }
    if (player.hasContinuedEducation) {
      emitClient(socket, 'error', { message: '你已選擇繼續進修。' });
      return;
    }

    const _edCB = player.cash; const _edFB = player.monthlyCashflow; const _edNWB = calcNetWorth(player);
    applyEducationLoan(player);
    logPlayerEvent(player, gs, 'education', '選擇繼續進修（產生學貸，解鎖高階職業）', _edCB, _edFB, _edNWB, { fqAfter: player.stats.financialIQ });

    const availableProfessions = getAvailableProfessions(player).map((p) => ({
      id: p.id,
      name: p.name,
      quadrant: p.quadrant,
      startingSalary: p.startingSalary,
      salaryType: p.salaryType,
      hasFlexibleSchedule: p.hasFlexibleSchedule,
    }));

    emitClient(socket, 'educationLoanApplied', {
      newFQ: player.stats.financialIQ,
      lifeExpGained: LIFE_EXP.CONTINUED_EDUCATION,
      availableProfessions,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('selectQuadrant', (payload: { quadrant: 'E' | 'S' | 'B' | 'I' }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(playerIdentity(socket));
    if (!player) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }

    const { quadrant } = payload;
    const hasEdu = player.hasContinuedEducation;

    // B / I 象限門檻檢查
    if (quadrant === 'B' || quadrant === 'I') {
      const t = QUADRANT_SELECT_THRESHOLDS[quadrant];
      if (
        player.growthStats.academic < t.academicMin ||
        player.growthStats.resource < t.resourceMin
      ) {
        emitClient(socket, 'error', {
          message: `${quadrant} 象限門檻：${t.description}（你目前 學識=${player.growthStats.academic}、資源=${player.growthStats.resource}）。`,
        });
        return;
      }
    }

    // 建立隨機職業池
    let pool: string[];
    if (quadrant === 'E') {
      pool = hasEdu
        ? [...E_PROFESSION_POOLS.advanced]
        : [...E_PROFESSION_POOLS.basic];
    } else if (quadrant === 'S') {
      pool = hasEdu
        ? [...S_PROFESSION_POOLS.advanced]
        : [...S_PROFESSION_POOLS.basicLow, ...S_PROFESSION_POOLS.basicMid];
    } else if (quadrant === 'B') {
      pool = [...B_PROFESSION_POOLS.basic];
    } else {
      pool = [...I_PROFESSION_POOLS.basic];
    }

    const randomId = pool[Math.floor(Math.random() * pool.length)];
    const chosen = PROFESSIONS.find((p) => p.id === randomId);

    if (!chosen) {
      emitClient(socket, 'error', { message: '職業分配失敗，請重試。' });
      return;
    }

    // 處理 placeholder 職業情境：玩家進房時 createPlayer 已用佔位職業（cash=0、薪資=0），
    // 此處才把「真正選定的職業」startingCash 注入。
    // 若先前已指派過真實職業（例如重複呼叫 selectQuadrant），先扣回舊的 startingCash 避免疊加。
    const previousProfession = player.profession;
    if (previousProfession && previousProfession.id !== '__placeholder__') {
      player.cash -= previousProfession.startingCash;
    }
    player.cash += chosen.startingCash;

    player.profession = chosen;
    player.salary = chosen.startingSalary;
    player.expenses.taxes = chosen.startingTaxes;
    player.expenses.rent = chosen.startingHomeMortgage;
    player.expenses.homeMortgagePayment = 0;
    player.housing = 'rent';
    player.expenses.carLoanPayment = chosen.startingCarLoan;
    player.expenses.creditCardPayment = chosen.startingCreditCard;
    player.expenses.otherExpenses = chosen.startingOtherExpenses;
    syncHouseholdLoans(player);
    player.actionTokensThisPayday = chosen.hasFlexibleSchedule ? Infinity : 1;
    player.startAge = hasEdu ? 25 : 22;
    player.pre20Done = true;

    // B / I 象限：注入起始資產與 startingFQ（修正之前 selectQuadrant 不處理的 bug）
    if (chosen.startingAssets && chosen.startingAssets.length > 0) {
      // 先清掉先前 createPlayer 階段（隨機指派）注入的 startingAssets / 對應負債，
      // 避免「我原本被隨機分到 angel_investor，後來改選 E，但 $450K 投組還在」
      player.assets = player.assets.filter((a) => !a.id.startsWith(`start-${player.id}-`));
      player.liabilities = player.liabilities.filter((l) => !l.id.startsWith(`start-liability-${player.id}-`));

      chosen.startingAssets.forEach((template, idx) => {
        const assetId = `start-${player.id}-${idx}`;
        const liabilityId = template.liabilityAmount
          ? `start-liability-${player.id}-${idx}`
          : undefined;

        player.assets.push({
          id: assetId,
          name: template.name,
          type: template.type,
          cost: template.cost,
          monthlyCashflow: template.monthlyCashflow,
          currentValue: template.currentValue,
          linkedLiabilityId: liabilityId,
        });

        if (template.liabilityAmount && liabilityId) {
          player.liabilities.push({
            id: liabilityId,
            name: template.liabilityName ?? `${template.name}貸款`,
            totalDebt: template.liabilityAmount,
            monthlyPayment:
              template.liabilityMonthlyPayment ??
              Math.round(template.liabilityAmount * 0.005),
          });
        }
      });
    } else {
      // E / S 象限：清掉所有 createPlayer 階段被隨機指派注入的 starting 資產
      player.assets = player.assets.filter((a) => !a.id.startsWith(`start-${player.id}-`));
      player.liabilities = player.liabilities.filter((l) => !l.id.startsWith(`start-liability-${player.id}-`));
    }

    if (chosen.startingFQ !== undefined) {
      player.stats.financialIQ = Math.max(player.stats.financialIQ, chosen.startingFQ);
    }

    console.log(`[selectQuadrant] ${player.name}（${roomId}）選擇 ${quadrant} 象限，分配職業：${chosen.name}${hasEdu ? '（進修後）' : ''}`);

    emitClient(socket, 'professionAssigned', {
      profession: chosen,
      quadrant,
      initialCashflow: player.monthlyCashflow,
    });

    const allReady = [...gs.players.values()].every((p) => p.pre20Done);
    emitToRoom(roomId, 'playerReady', {
      playerId: player.id,
      playerName: player.name,
      professionName: chosen.name,
      quadrant: chosen.quadrant,
      allPlayersReady: allReady,
    });

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });
}
