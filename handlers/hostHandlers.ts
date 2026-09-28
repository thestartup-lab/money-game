/** 主持人設定：開局、節奏、發薪、暫停、重開、調整數值（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { GamePhase } from '../gameDataModels';
import { syncPlayerAges } from '../gameLogic';
import { MONTHS_PER_ROUND_OPTIONS } from '../gameConfig';
import { createPlayer, getCurrentAge, startGameClock, pauseGameClock, resumeGameClock } from '../gameLogic';
import { MIN_GAME_DURATION_MS, MAX_GAME_DURATION_MS, YEARS_PER_COMPLETED_ROUND, TOTAL_LIFE_ROUNDS } from '../gameConfig';
import { CRISIS_EVENTS, SMALL_DEALS, Deck, BIG_DEALS, DOODADS, MARKET_CARDS } from '../gameCards';
import {
  OnSafe, announceCareerUnlock, autoCompletePre20, boardNotices, continueAfterTurnAdvance, emitAdaptiveDirectorStatus,
  emitClient, emitToRoom, getPlayerSocket, getRoomState, isRoomAdmin, pausePaydayClock,
  playerSessions, privateReplay, resumePaydayClock, secondLifeQueue, serializeGameState, skipCurrentEducationTurns,
} from '../socketServer';

export function registerHostHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 落格說明自動放行秒數 (setReadingAutoContinue) — 0 表示每次都等主持人
  // ----------------------------------------------------------
  onSafe('setReadingAutoContinue', (payload: { seconds?: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整落格說明節奏。' }); return; }
    const seconds = Number(payload?.seconds ?? 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) { emitClient(socket, 'error', { message: '秒數需介於 0 到 60。' }); return; }
    gs.readingAutoContinueMs = Math.round(seconds * 1000);
    console.log(`[setReadingAutoContinue] 房間 ${gs.gameId} 落格說明自動放行：${seconds} 秒`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 送出後自動揭曉 (setAutoRevealOnSubmit)
  // ----------------------------------------------------------
  onSafe('setAutoRevealOnSubmit', (payload: { enabled: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整揭曉方式。' }); return; }
    gs.autoRevealOnSubmit = payload.enabled === true;
    console.log(`[setAutoRevealOnSubmit] 房間 ${gs.gameId} 送出後自動揭曉：${gs.autoRevealOnSubmit ? '開' : '關'}`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('startGame', (payload?: { durationMinutes?: number; force?: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以啟動遊戲。' });
      return;
    }
    if (gs.players.size === 0) {
      emitClient(socket, 'error', { message: '目前沒有玩家，請先讓至少一位玩家加入後再啟動遊戲。' });
      return;
    }

    if (gs.gamePhase !== GamePhase.WaitingForPlayers && gs.gamePhase !== GamePhase.Pre20) {
      emitClient(socket, 'error', { message: '遊戲已經開始，無法重新啟動。若要重來請使用「重啟遊戲」。' });
      return;
    }

    // pre20Done 為硬性條件：任何玩家（含斷線中的）未完成職業選擇都不允許開始。
    // 斷線玩家開局後無法再補選職業，所以不能放行；主持人可移除或強制補齊。
    // force=true 時主持人選擇「強制開始」：為未完成 Pre-20 的玩家自動補齊
    //   1. 隨機投胎社會階層（套用 cash bonus 與 growth points）
    //   2. 自動分配成長點（學業/體能/社交/資源 平均分配）
    //   3. 隨機 E 象限職業
    // 注意：與舊版 force 不同，這裡會把玩家正常推進到「真正的職業」而非 placeholder。
    const notReady = [...gs.players.values()].filter((p) => !p.pre20Done);
    if (notReady.length > 0) {
      if (!payload?.force) {
        const names = notReady.map((p) => `${p.name}${p.isDisconnected ? '（離線）' : ''}`).join('、');
        emitClient(socket, 'error', {
          message: `以下玩家尚未完成職業選擇：${names}。可請他們完成、移除離線玩家，或按「強制開始」由系統自動分配。`,
        });
        return;
      }
      // 強制開始：為未完成玩家自動跑完 Pre-20
      for (const p of notReady) {
        autoCompletePre20(p, gs, roomId);
      }
      console.log(`[startGame:force] ${notReady.length} 位玩家未完成 Pre-20，已自動補齊`);
    }

    const minutes = payload?.durationMinutes ?? 90;
    const durationMs = Math.min(
      MAX_GAME_DURATION_MS,
      Math.max(MIN_GAME_DURATION_MS, minutes * 60 * 1000)
    );

    gs.gameDurationMs = durationMs;
    gs.gamePhase = GamePhase.RatRace;
    syncPlayerAges(gs);
    gs.turnNumber = 0;
    gs.roundsSinceGlobalPayday = 0;
    gs.roundsAtLastPayday = 0;
    gs.lastPaydayActiveMs = 0;
    gs.paydayPausedMs = 0;
    gs.paydayPausedAt = null;
    gs.retirementQueue = [];
    gs.globalPaydayPending = false;
    gs.globalPaydayInProgress = false;
    gs.globalPaydayNumber = 0;
    gs.finalRoundStarted = false;
    gs.finalRoundPendingPlayerIds = [];
    gs.adaptiveDirector.mode = 'balanced';
    gs.adaptiveDirector.score = 50;
    gs.adaptiveDirector.reason = '等待第一次季度評估';
    gs.adaptiveDirector.lastEvaluatedPayday = 0;
    gs.adaptiveDirector.lastTriggeredPayday = 0;
    gs.adaptiveDirector.lastEventId = undefined;
    gs.adaptiveDirector.lastEventTitle = undefined;
    gs.facilitatorScene = null;
    gs.facilitatorSceneContext = null;
    gs.facilitatorEchoHistory = new Set();
    boardNotices.delete(gs);
    gs.careerRequests = [];
    gs.pendingWorldEvent = null;
    gs.worldEventHistory = [];
    gs.turnInProgress = false;
    for (const player of gs.players.values()) player.worldEffects = [];
    startGameClock(gs);
    emitAdaptiveDirectorStatus(gs);

    console.log(`[startGame] 房間 ${roomId} 遊戲啟動；每完整回合 +${YEARS_PER_COMPLETED_ROUND} 歲，活動倒數：${minutes} 分鐘`);

    emitToRoom(roomId, 'gameStarted', {
      gameStartTime: gs.gameStartTime,
      gameDurationMs: gs.gameDurationMs,
      durationMinutes: minutes,
      yearsPerRound: YEARS_PER_COMPLETED_ROUND,
      totalLifeRounds: TOTAL_LIFE_ROUNDS,
      endTime: new Date(gs.gameStartTime!.getTime() + durationMs),
    });

    // 若首位（或連續多位）玩家選擇進修，開局立即完成其延後回合並交棒。
    skipCurrentEducationTurns(gs);

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    // 第一輪的全體行動時間
    continueAfterTurnAdvance(gs);
  });

  // ----------------------------------------------------------
  // 計時發薪設定 (setPaydayTimer) 與立即發薪 (triggerPaydayNow)
  // ----------------------------------------------------------
  onSafe('setPaydayTimer', (payload: { minutes?: number; enabled?: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整發薪計時。' }); return; }
    if (payload?.enabled !== undefined) gs.paydayTimerEnabled = payload.enabled === true;
    if (payload?.minutes !== undefined) {
      const minutes = Number(payload.minutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) { emitClient(socket, 'error', { message: '發薪間隔需介於 1 到 60 分鐘。' }); return; }
      gs.paydayIntervalMs = Math.round(minutes * 60 * 1000);
    }
    console.log(`[setPaydayTimer] 房間 ${gs.gameId} 計時發薪：${gs.paydayTimerEnabled ? `${gs.paydayIntervalMs / 60000} 分鐘` : '關閉（每三輪）'}`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('triggerPaydayNow', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以立即發薪。' }); return; }
    if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) { emitClient(socket, 'error', { message: '遊戲尚未進行中。' }); return; }
    if (gs.finalRoundStarted) { emitClient(socket, 'error', { message: '最後一輪不再發薪。' }); return; }
    if (gs.globalPaydayPending || gs.globalPaydayInProgress) { emitClient(socket, 'error', { message: '發薪已排入或進行中。' }); return; }
    if (gs.turnNumber - gs.roundsAtLastPayday < 1) { emitClient(socket, 'error', { message: '上次發薪後還沒完成任何一輪，暫時沒有可結算的薪資。' }); return; }
    gs.globalPaydayPending = true;
    console.log(`[triggerPaydayNow] 房間 ${gs.gameId} 主持人立即發薪`);
    if (!gs.turnInProgress && !gs.decisionPhase && !gs.facilitatorScene) continueAfterTurnAdvance(gs);
    else emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 結婚禮金金額 (setMarriageGift)：不帶 amount（或 0）= 恢復預設
  // ----------------------------------------------------------
  onSafe('setMarriageGift', (payload: { amount?: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整結婚禮金。' }); return; }
    const amount = Number(payload?.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > 5_000_000) { emitClient(socket, 'error', { message: '禮金需介於 0 到 $5,000,000。' }); return; }
    gs.marriageGiftOverride = amount > 0 ? Math.round(amount) : null;
    console.log(`[setMarriageGift] 房間 ${gs.gameId} 結婚禮金：${gs.marriageGiftOverride ?? '預設'}`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // 每輪結算月數 (setMonthsPerRound)：12／24／48
  onSafe('setMonthsPerRound', (payload: { months: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整結算月數。' }); return; }
    const months = Number(payload?.months);
    if (!(MONTHS_PER_ROUND_OPTIONS as readonly number[]).includes(months)) { emitClient(socket, 'error', { message: `結算月數只能是 ${MONTHS_PER_ROUND_OPTIONS.join('／')}。` }); return; }
    if (gs.globalPaydayInProgress) { emitClient(socket, 'error', { message: '發薪進行中，稍後再調整。' }); return; }
    gs.monthsPerRound = months;
    console.log(`[setMonthsPerRound] 房間 ${gs.gameId} 每輪結算 ${months} 個月`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 全體行動時間開關 (setActionPhaseEnabled)
  // ----------------------------------------------------------
  onSafe('setActionPhaseEnabled', (payload: { enabled: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有管理員可以調整行動時間設定。' }); return; }
    gs.actionPhaseEnabled = payload.enabled === true;
    console.log(`[setActionPhaseEnabled] 房間 ${gs.gameId} 全體行動時間：${gs.actionPhaseEnabled ? '開' : '關'}`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('pauseGame', (payload?: { reason?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以暫停遊戲。' });
      return;
    }
    if (gs.pausedAt !== null) {
      emitClient(socket, 'error', { message: '遊戲已在暫停中。' });
      return;
    }

    pauseGameClock(gs);
    pausePaydayClock(gs);
    console.log(`[pauseGame] 房間 ${roomId} 時鐘暫停`);

    emitToRoom(roomId, 'gamePaused', {
      reason: payload?.reason ?? '主持人暫停',
      pausedAt: gs.pausedAt,
      currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('resumeGame', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以恢復遊戲。' });
      return;
    }
    if (gs.decisionPhase) {
      emitClient(socket, 'error', { message: '目前是主持人控制的決策階段，請使用「結束決策並繼續」。' });
      return;
    }
    if (gs.facilitatorScene) {
      emitClient(socket, 'error', { message: '大螢幕舞台事件尚未結束，請先揭曉並關閉舞台。' });
      return;
    }
    if (gs.pausedAt === null) {
      emitClient(socket, 'error', { message: '遊戲未在暫停中。' });
      return;
    }

    resumeGameClock(gs);
    resumePaydayClock(gs);
    gs.restoredAt = null;
    const currentAge = getCurrentAge(gs);
    console.log(`[resumeGame] 房間 ${roomId} 時鐘恢復，目前年齡：${currentAge.toFixed(1)} 歲`);

    emitToRoom(roomId, 'gameResumed', {
      resumedAt: new Date(),
      currentAge: Math.round(currentAge * 10) / 10,
    });

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 重啟遊戲 (restartGame) — 主持人專用
  // ----------------------------------------------------------
  /**
   * 將遊戲重置到 Pre20 階段，所有玩家回到重新投胎狀態。
   * 保留同一房間內的玩家名單（socket ID 與姓名），讓大家重新分配成長點數、選職業。
   */
  onSafe('restartGame', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以重啟遊戲。' });
      return;
    }
    if (gs.decisionPhase || gs.facilitatorScene) {
      emitClient(socket, 'error', { message: '請先結束目前的決策或大螢幕舞台事件，再重新開始遊戲。' });
      return;
    }

    // 保存現有玩家名單（ID + 姓名）
    const playerInfos = gs.playerOrder.map((id) => {
      const p = gs.players.get(id)!;
      return { id, name: p.name };
    });

    // 重置玩家狀態（保留 socket ID 與名字，其他全清空重新投胎）
    gs.players.clear();
    gs.playerOrder = [];
    for (const { id, name } of playerInfos) {
      const session = playerSessions.get(id);
      if (session) session.setupStep = undefined;
      privateReplay.delete(id);
      const freshPlayer = createPlayer(id, name);
      freshPlayer.isDisconnected = !getPlayerSocket(id)?.connected;
      gs.players.set(id, freshPlayer);
      gs.playerOrder.push(id);
    }

    // 重置遊戲狀態
    gs.gamePhase = playerInfos.length > 0 ? GamePhase.Pre20 : GamePhase.WaitingForPlayers;
    gs.turnNumber = 0;
    gs.currentPlayerTurnId = gs.playerOrder[0] ?? '';
    gs.gameStartTime = null;
    gs.pausedAt = null;
    gs.totalPausedMs = 0;
    gs.marketEvents = [];
    gs.paydayPlanningConfirmed = new Set();
    gs.pendingPartnershipOffers = {};
    gs.pendingLoanOffers = {};
    gs.pendingLoanRequests = {};
    boardNotices.delete(gs);
    gs.careerRequests = [];
    gs.activeAuctions = {};
    gs.decisionPhase = null;
    gs.facilitatorScene = null;
    gs.facilitatorSceneContext = null;
    gs.facilitatorEchoHistory = new Set();
    gs.roundsSinceGlobalPayday = 0;
    gs.pendingWorldEvent = null;
    gs.worldEventHistory = [];
    gs.turnInProgress = false;
    gs.globalPaydayPending = false;
    gs.globalPaydayInProgress = false;
    gs.globalPaydayNumber = 0;
    gs.finalRoundStarted = false;
    gs.finalRoundPendingPlayerIds = [];
    gs.adaptiveDirector.mode = 'balanced';
    gs.adaptiveDirector.score = 50;
    gs.adaptiveDirector.reason = '等待第一次季度評估';
    gs.adaptiveDirector.lastEvaluatedPayday = 0;
    gs.adaptiveDirector.lastTriggeredPayday = 0;
    gs.adaptiveDirector.lastEventId = undefined;
    gs.adaptiveDirector.lastEventTitle = undefined;

    secondLifeQueue.delete(gs);
    // 重置牌組
    gs.smallDealDeck = new Deck(SMALL_DEALS);
    gs.bigDealDeck   = new Deck(BIG_DEALS);
    gs.doodadDeck    = new Deck(DOODADS);
    gs.crisisDeck    = new Deck(CRISIS_EVENTS);
    gs.marketDeck    = new Deck(MARKET_CARDS);

    console.log(`[restartGame] 房間 ${roomId} 重啟，${playerInfos.length} 位玩家回到投胎`);

    emitToRoom(roomId, 'gameRestarted', { roomId, playerCount: playerInfos.length });
    emitAdaptiveDirectorStatus(gs);
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 管理員：手動調整玩家能力值 (setPlayerStats)
  // ----------------------------------------------------------
  onSafe('setPlayerStats', (payload: {
    targetPlayerId: string;
    stats: { fq?: number; hp?: number; sk?: number; nt?: number };
  }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以調整玩家能力值。' });
      return;
    }

    const target = gs.players.get(payload?.targetPlayerId);
    if (!target) {
      emitClient(socket, 'error', { message: '目標玩家不存在。' });
      return;
    }

    const stats = payload?.stats ?? {};
    const MAX_STAT = 100;
    const MIN_STAT = 0;
    const clamp = (val: number) => Math.max(MIN_STAT, Math.min(MAX_STAT, Math.round(val)));

    // FQ 有效範圍 1–10：0 會讓玩家永遠無法升級，>10 會失去乘數
    if (stats.fq !== undefined) target.stats.financialIQ = Math.max(1, Math.min(10, Math.round(stats.fq)));
    if (stats.hp !== undefined) {
      target.stats.health = clamp(stats.hp);
      if (target.stats.health > 0) target.isBedridden = false;
      else target.isBedridden = true;
    }
    if (stats.sk !== undefined) target.stats.careerSkill = clamp(stats.sk);
    if (stats.nt !== undefined) target.stats.network = Math.max(1, Math.min(10, Math.round(stats.nt)));

    const changed: Record<string, number> = {};
    if (stats.fq !== undefined) changed.fq = target.stats.financialIQ;
    if (stats.hp !== undefined) changed.hp = target.stats.health;
    if (stats.sk !== undefined) changed.sk = target.stats.careerSkill;
    if (stats.nt !== undefined) changed.nt = target.stats.network;

    console.log(`[admin] 房間 ${gs.gameId} 調整 ${target.name} 能力值：${JSON.stringify(changed)}`);

    announceCareerUnlock(gs, target);
    emitClient(socket, 'setPlayerStatsResult', { success: true, targetPlayerId: target.id, stats: changed });
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });
}
