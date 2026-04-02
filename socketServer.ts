import * as http from 'http';
import { Server, Socket } from 'socket.io';
import { GameState, Player, PaydayPlanPayload, GamePhase, PlayerEvent, PlayerEventType } from './gameDataModels';
import {
  createPlayer,
  applyGlobalEvent,
  rollDice,
  movePlayer,
  triggerPayday,
  checkAndApplyAnnualTax,
  sellAsset,
  buyInsurance,
  cancelInsurance,
  takeEmergencyLoan,
  takeLeverageLoan,
  repayLoan,
  InsuranceType,
  rollSocialClass,
  applyGrowthStats,
  getAvailableProfessions,
  applyEducationLoan,
  addLifeExperience,
  getCurrentAge,
  getLifeStage,
  calculateLifeScore,
  applyFastTrackAppreciation,
  applyFastTrackPaydayBonus,
  startGameClock,
  pauseGameClock,
  resumeGameClock,
  goTravel,
  checkBedriddenDeath,
  attendSocialEvent,
  activateRelationship,
  confirmMarriage,
  buyArrangedMarriage,
  getArrangedMarriageCost,
} from './gameLogic';
import {
  ADMIN_PASSWORD, PAYDAY_PLANNING_TIMEOUT_MS,
  SOCIAL_CLASS_CONFIG, DEFAULT_GAME_DURATION_MS,
  MIN_GAME_DURATION_MS, MAX_GAME_DURATION_MS,
  LIFE_EXP, LIFE_EVENT_WINDOWS,
  HP_ACTIVITY_THRESHOLDS,
  HOST_ACTIVATION_DRS_BONUS,
  CRISIS_FREQ_BY_STAGE,
  E_PROFESSION_POOLS, S_PROFESSION_POOLS, FRANCHISE_CASH_THRESHOLD, PROFESSIONS,
} from './gameConfig';
import { ADMIN_GLOBAL_EVENT_MAP } from './adminEvents';
import {
  applyPaydayPlan,
  executeCareerChange,
  getFQUpgradeCost,
  checkBedriddenStatus,
} from './statsSystem';
import {
  getSquareType,
  SquareType,
  DealCard,
  CharityCard,
  CHARITY_CARD,
  getFastTrackSquareType,
  FastTrackSquareType,
  FAST_TRACK_BOARD,
  MARRIAGE_CARDS,
  CRISIS_POOL_BY_STAGE,
  CRISIS_EVENTS,
  RELATIONSHIP_EVENTS,
  SMALL_DEALS,
} from './gameCards';
import {
  applyDoodadCard,
  applyBabyCard,
  applyDownsizingCard,
  applyMarketCard,
  acceptDealCard,
  applyCharityDonation,
  applyCrisisCard,
  handlePlayerDeath,
  checkRatRaceEscape,
  applyRelationshipCard,
} from './cardSystem';

// ============================================================
// 伺服器初始化
// ============================================================

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ============================================================
// 多房間狀態管理
// ============================================================

/**
 * 全域房間映射表：roomId → GameState
 * 每位主持人建立一個獨立房間，互不干擾。
 */
const rooms = new Map<string, GameState>();

/** 記錄每個 socket 目前所在的房間 ID（斷線清理用） */
const socketRoomMap = new Map<string, string>();

/**
 * 產生 6 字元隨機英數房間代碼，確保不重複。
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字元 0OI1
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

/**
 * 取得 socket 所在房間的 GameState。
 * 若 socket 未加入任何房間，回傳 null。
 */
function getRoomState(socket: Socket): GameState | null {
  const roomId = socketRoomMap.get(socket.id);
  return roomId ? (rooms.get(roomId) ?? null) : null;
}

/**
 * 對特定房間的所有連線廣播事件。
 * 等同於 io.to(roomId).emit(...)，方便統一呼叫。
 */
function emitToRoom(roomId: string, event: string, ...args: unknown[]): void {
  io.to(roomId).emit(event, ...args);
}

// ============================================================
// 事件日誌輔助
// ============================================================

/**
 * 計算玩家當前淨資產（資產市值 - 負債餘額）。
 */
function calcNetWorth(p: Player): number {
  const assetValue = p.assets.reduce((s, a) => s + (a.currentValue ?? a.cost), 0);
  const liabilityTotal = p.liabilities.reduce((s, l) => s + l.totalDebt, 0);
  return p.cash + assetValue - liabilityTotal;
}

/**
 * 在玩家事件日誌中記錄一筆快照。
 * 應在事件「執行後」呼叫，cashBefore/cashflowBefore 由呼叫者在執行前捕捉。
 */
function logPlayerEvent(
  player: Player,
  gs: GameState,
  type: PlayerEventType,
  description: string,
  cashBefore: number,
  cashflowBefore: number,
  netWorthBefore: number,
  meta?: Record<string, unknown>
): void {
  const event: PlayerEvent = {
    age: Math.round(getCurrentAge(gs) * 10) / 10,
    type,
    description,
    cashBefore,
    cashAfter: player.cash,
    cashflowBefore,
    cashflowAfter: player.monthlyCashflow,
    netWorthBefore,
    netWorthAfter: calcNetWorth(player),
    meta,
  };
  player.eventLog.push(event);
}

// ============================================================
// 序列化工具
// ============================================================

/**
 * 將 Player 轉換為可安全 JSON 序列化的純物件。
 * getter 值（totalIncome 等）需手動展開，Map 無法直接序列化。
 */
function serializePlayer(p: Player): object {
  return {
    id: p.id,
    name: p.name,
    profession: p.profession,
    quadrant: p.profession.quadrant,
    salaryType: p.profession.salaryType,
    currentPosition: p.currentPosition,
    isAlive: p.isAlive,
    cash: p.cash,
    salary: p.salary,
    expenses: p.expenses,
    assets: p.assets,
    liabilities: p.liabilities,
    insurance: p.insurance,
    numberOfChildren: p.numberOfChildren,
    paydayCount: p.paydayCount,
    stats: p.stats,
    paydayPlanningPending: p.paydayPlanningPending,
    turnsToSkip: p.turnsToSkip,
    downsizingTurnsLeft: p.downsizingTurnsLeft,
    bonusDice: p.bonusDice,
    creditScore: p.creditScore,
    socialClass: p.socialClass,
    growthStats: p.growthStats,
    growthPointsRemaining: p.growthPointsRemaining,
    lifeExperience: p.lifeExperience,
    hasContinuedEducation: p.hasContinuedEducation,
    isMarried: p.isMarried,
    marriageBonus: p.marriageBonus,
    relationshipPoints: p.relationshipPoints,
    relationshipActive: p.relationshipActive,
    marriageType: p.marriageType,
    isBedridden: p.isBedridden,
    travelPenaltyRemaining: p.travelPenaltyRemaining,
    isInFastTrack: p.isInFastTrack,
    pre20Done: p.pre20Done,
    actionTokensThisPayday: p.actionTokensThisPayday,
    hasFlexibleSchedule: p.profession.hasFlexibleSchedule,
    totalPassiveIncome: p.totalPassiveIncome,
    totalIncome: p.totalIncome,
    totalExpenses: p.totalExpenses,
    monthlyCashflow: p.monthlyCashflow,
    nextFQUpgradeCost: getFQUpgradeCost(p.stats.financialIQ),
    eventLog: p.eventLog,
  };
}

function serializeGameState(gs: GameState): object {
  const currentAge = getCurrentAge(gs);
  const currentStage = getLifeStage(currentAge);
  return {
    gameId: gs.gameId,
    roomId: gs.gameId,
    players: Array.from(gs.players.values()).map(serializePlayer),
    playerOrder: gs.playerOrder,
    currentPlayerTurnId: gs.currentPlayerTurnId,
    gamePhase: gs.gamePhase,
    turnNumber: gs.turnNumber,
    marketEvents: gs.marketEvents,
    createdAt: gs.createdAt,
    hasAdmin: gs.adminSocketId !== undefined,
    gameStartTime: gs.gameStartTime,
    gameDurationMs: gs.gameDurationMs,
    isPaused: gs.pausedAt !== null,
    currentAge: Math.round(currentAge * 10) / 10,
    currentStage,
  };
}

// ============================================================
// Socket.io 事件處理
// ============================================================

io.on('connection', (socket: Socket) => {
  console.log(`[連線] 新客戶端連線：${socket.id}`);

  // ----------------------------------------------------------
  // 主持人：建立房間 (createRoom)
  // ----------------------------------------------------------
  /**
   * Admin only（密碼驗證）。
   * Client → Server: { password: string }
   * Server → Caller: roomCreated { roomId, joinCode } | error
   *
   * 建立新的獨立遊戲房間，回傳給主持人的 joinCode 供玩家加入使用。
   * 同一主持人可建立多個房間（多開場次）。
   */
  socket.on('createRoom', (payload: { password: string }) => {
    if (payload?.password !== ADMIN_PASSWORD) {
      socket.emit('error', { message: '密碼錯誤，無法建立房間。' });
      return;
    }

    const roomCode = generateRoomCode();
    const gs = new GameState(roomCode);
    gs.adminSocketId = socket.id;
    rooms.set(roomCode, gs);

    // 主持人也加入 Socket.io 房間（可接收廣播）
    socket.join(roomCode);
    socketRoomMap.set(socket.id, roomCode);

    console.log(`[createRoom] 主持人 ${socket.id} 建立房間：${roomCode}（目前共 ${rooms.size} 個房間）`);

    socket.emit('roomCreated', {
      roomId: roomCode,
      joinCode: roomCode,
      adminSocketId: socket.id,
    });
  });

  // ----------------------------------------------------------
  // 主持人：刪除房間 (deleteRoom)
  // ----------------------------------------------------------
  /**
   * Admin only（需已在該房間）。
   * Client → Server: {}
   * Server → All in room: roomDeleted
   * Server → Caller: deleteRoomResult
   */
  socket.on('deleteRoom', () => {
    const gs = getRoomState(socket);
    if (!gs) {
      socket.emit('error', { message: '尚未加入任何房間。' });
      return;
    }
    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有建立此房間的主持人才能刪除它。' });
      return;
    }

    const roomId = gs.gameId;

    emitToRoom(roomId, 'roomDeleted', { roomId, reason: '主持人已關閉房間。' });

    rooms.delete(roomId);

    // 踢出所有在此房間的 socket
    io.in(roomId).socketsLeave(roomId);

    // 清理 socketRoomMap 中屬於此房間的紀錄
    for (const [sid, rid] of socketRoomMap) {
      if (rid === roomId) socketRoomMap.delete(sid);
    }

    console.log(`[deleteRoom] 房間 ${roomId} 已刪除（目前剩 ${rooms.size} 個房間）`);
    socket.emit('deleteRoomResult', { success: true, roomId });
  });

  // ----------------------------------------------------------
  // 管理員登入現有房間 (adminLogin)
  // ----------------------------------------------------------
  /**
   * 主持人重新連線時，重新取得指定房間的管理員身份。
   * Client → Server: { password: string, roomId: string }
   * Server → Caller: adminLoginSuccess | adminLoginFail
   */
  socket.on('adminLogin', (payload: { password: string; roomId?: string }) => {
    if (payload?.password !== ADMIN_PASSWORD) {
      socket.emit('adminLoginFail', { message: '密碼錯誤，請重試。' });
      return;
    }

    const targetRoomId = payload?.roomId;
    if (!targetRoomId) {
      // 未指定房間：直接回傳成功（可搭配 createRoom 使用）
      socket.emit('adminLoginSuccess', { adminSocketId: socket.id, roomId: null });
      return;
    }

    const gs = rooms.get(targetRoomId);
    if (!gs) {
      socket.emit('adminLoginFail', { message: `房間 ${targetRoomId} 不存在。` });
      return;
    }

    gs.adminSocketId = socket.id;
    socket.join(targetRoomId);
    socketRoomMap.set(socket.id, targetRoomId);

    console.log(`[adminLogin] 主持人重新登入房間 ${targetRoomId}：${socket.id}`);
    socket.emit('adminLoginSuccess', { adminSocketId: socket.id, roomId: targetRoomId });
  });

  // ----------------------------------------------------------
  // 查詢可加入的房間列表 (listRooms)
  // ----------------------------------------------------------
  /**
   * Client → Server: {}
   * Server → Caller: roomList [{ roomId, playerCount, gamePhase }]
   *
   * 供玩家確認房間代碼存在，或主持人確認房間狀態。
   */
  socket.on('listRooms', () => {
    const list = Array.from(rooms.entries()).map(([roomId, gs]) => ({
      roomId,
      playerCount: gs.players.size,
      gamePhase: gs.gamePhase,
      hasAdmin: gs.adminSocketId !== undefined,
    }));
    socket.emit('roomList', list);
  });

  // ----------------------------------------------------------
  // 玩家加入 (playerJoin)
  // ----------------------------------------------------------
  /**
   * Client → Server: { playerName: string, roomCode: string, professionId?: string }
   *
   * 玩家透過主持人分享的 roomCode 加入對應房間。
   * roomCode 是建立房間時回傳的 6 字元代碼。
   */
  socket.on(
    'playerJoin',
    (payload: { playerName: string; roomCode: string; professionId?: string }) => {
      const { playerName, roomCode, professionId } = payload;

      const gs = rooms.get(roomCode);
      if (!gs) {
        socket.emit('error', { message: `房間代碼「${roomCode}」不存在，請確認後再試。` });
        return;
      }

      if (gs.gamePhase === GamePhase.GameOver) {
        socket.emit('error', { message: '此房間的遊戲已結束，無法加入。' });
        return;
      }

      // 加入 Socket.io 房間與映射表
      socket.join(roomCode);
      socketRoomMap.set(socket.id, roomCode);

      console.log(
        `[playerJoin] ${playerName}（socket: ${socket.id}）加入房間 ${roomCode}，職業指定：${professionId ?? '隨機'}`
      );

      const player = createPlayer(socket.id, playerName, professionId);
      gs.addPlayer(player);

      // 第一位玩家加入後，進入 Pre-20 設定階段
      if (gs.gamePhase === GamePhase.WaitingForPlayers) {
        gs.gamePhase = GamePhase.Pre20;
        console.log(`[playerJoin] 房間 ${roomCode} 進入 Pre-20 階段`);
      }

      // 若是第一位玩家，設定為當前回合玩家
      if (gs.playerOrder.length === 1) {
        gs.currentPlayerTurnId = socket.id;
      }

      console.log(
        `[playerJoin] ${playerName} 職業：${player.profession.name}，` +
          `起始現金：$${player.cash}，月現金流：$${player.monthlyCashflow}`
      );

      emitToRoom(roomCode, 'gameStateUpdate', serializeGameState(gs));
    }
  );

  // ----------------------------------------------------------
  // 玩家擲骰 (playerRoll)
  // ----------------------------------------------------------
  /**
   * Client → Server: { diceCount?: 1 | 2 }   預設 1 顆骰子
   */
  socket.on(
    'playerRoll',
    async (payload: { diceCount?: 1 | 2 }) => {
      const gs = getRoomState(socket);
      if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
      const roomId = gs.gameId;

      // --- 1. 回合驗證 ---
      if (socket.id !== gs.currentPlayerTurnId) {
        socket.emit('error', { message: '尚未輪到你的回合。' });
        return;
      }

      const player = gs.players.get(socket.id);
      if (!player || !player.isAlive) {
        socket.emit('error', { message: '玩家不存在或已出局。' });
        return;
      }

      // --- 1b. 臥床狀態：自動跳過並判斷死亡 ---
      if (player.isBedridden) {
        const died = checkBedriddenDeath(player);
        if (died) {
          const deathAge = Math.round(getCurrentAge(gs));
          const finalScore = calculateLifeScore(player, deathAge);
          handlePlayerDeath(player, gs);

          console.log(`[bedridden] ${player.name} 臥床自然死亡（${deathAge} 歲），人生評分：${finalScore.total} 分`);

          emitToRoom(roomId, 'playerFinalScore', {
            playerId: player.id,
            playerName: player.name,
            deathAge,
            cause: 'bedridden',
            score: finalScore,
            profession: player.profession.name,
            quadrant: player.profession.quadrant,
            isMarried: player.isMarried,
            numberOfChildren: player.numberOfChildren,
            lifeExperience: player.lifeExperience,
          });

          emitToRoom(roomId, 'playerEliminated', {
            playerId: player.id,
            playerName: player.name,
            deathAge,
            cause: 'bedridden',
          });

          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        } else {
          socket.emit('turnSkipped', {
            playerId: player.id,
            reason: 'bedridden',
            turnsRemaining: 0,
          });
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        }
        gs.advanceToNextTurn();
        return;
      }

      // --- 1c. turnsToSkip 跳回合檢查 ---
      if (player.turnsToSkip > 0) {
        player.turnsToSkip -= 1;
        socket.emit('turnSkipped', {
          playerId: player.id,
          reason: 'crisis',
          turnsRemaining: player.turnsToSkip,
        });
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        gs.advanceToNextTurn();
        return;
      }

      // --- 2. 擲骰 & 移動（含 bonusDice 加成）---
      const baseDice = payload?.diceCount ?? 1;
      const diceCount = (baseDice + player.bonusDice) as 1 | 2 | 3;
      player.bonusDice = 0;

      const rolled = rollDice(diceCount > 2 ? 2 : diceCount);
      const { passedPaydays, requiresPaydayPlanning } = movePlayer(player, rolled);

      console.log(
        `[playerRoll] ${player.name}（${roomId}）擲出 ${rolled}，` +
          `移動至位置 ${player.currentPosition}，` +
          `路過發薪日：${passedPaydays.length > 0 ? passedPaydays.join(', ') : '無'}`
      );

      socket.emit('rollResult', {
        diceCount,
        rolled,
        newPosition: player.currentPosition,
        passedPaydays,
      });

      // --- 3–4. 每個發薪日：暫停時鐘 → 全員規劃 → 發薪 → 繳稅 ---
      if (requiresPaydayPlanning) {
        for (const paydayPos of passedPaydays) {
          pauseGameClock(gs);
          gs.paydayPlanningConfirmed.clear();
          emitToRoom(roomId, 'gamePaused', { reason: '發薪日規劃', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });

          player.paydayPlanningPending = true;
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

          const affordableOptions = buildAffordableOptions(player);

          emitToRoom(roomId, 'paydayPlanningStarted', {
            paydayPosition: paydayPos,
            currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
            timeoutMs: PAYDAY_PLANNING_TIMEOUT_MS,
          });

          socket.emit('paydayPlanningRequired', {
            paydayPosition: paydayPos,
            currentStats: player.stats,
            currentCash: player.cash,
            affordableOptions,
            timeoutMs: PAYDAY_PLANNING_TIMEOUT_MS,
          });

          const plan = await waitForPaydayPlan(socket, player);

          const planResult = applyPaydayPlan(player, plan);
          const maintenanceDone =
            planResult.investments.healthBoost.executed ||
            planResult.investments.healthMaintenance.executed;

          player.paydayPlanningPending = false;
          gs.paydayPlanningConfirmed.add(player.id);

          emitToRoom(roomId, 'paydayPlanResult', {
            playerId: player.id,
            playerName: player.name,
            paydayPosition: paydayPos,
            planResult,
          });

          if (planResult.careerChangeUnlocked) {
            socket.emit('careerChangeUnlocked', {
              message: '恭喜！你的第二專長已達到頂峰，可以轉職了！',
              availableProfessions: buildAvailableProfessions(player),
            });
          }

          await waitForAllPlanningDone(gs, PAYDAY_PLANNING_TIMEOUT_MS);

          resumeGameClock(gs);
          emitToRoom(roomId, 'gameResumed', {
            resumedAt: new Date(),
            currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
          });

          const _pdCashBefore = player.cash;
          const _pdFlowBefore = player.monthlyCashflow;
          const _pdNWBefore = calcNetWorth(player);

          // 進修代價：跳過第一個發薪日
          if (player.skipFirstPayday) {
            player.skipFirstPayday = false;
            socket.emit('paydaySkipped', { reason: '你正在進修，跳過這個回合' });
            emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
            return;
          }

          triggerPayday(player, gs, maintenanceDone);
          logPlayerEvent(player, gs, 'payday', `發薪日（第 ${player.paydayCount} 次）`, _pdCashBefore, _pdFlowBefore, _pdNWBefore);

          // 固定行程職業：每次發薪日重置活動次數為 1
          if (!player.profession.hasFlexibleSchedule) {
            player.actionTokensThisPayday = 1;
          }

          const justBedridden = checkBedriddenStatus(player);
          if (justBedridden) {
            emitToRoom(roomId, 'playerBedridden', {
              playerId: player.id,
              playerName: player.name,
              age: Math.round(getCurrentAge(gs)),
            });
          }

          const { triggered, taxResult } = checkAndApplyAnnualTax(player);
          if (triggered && taxResult) {
            console.log(
              `[annualTax] ${player.name}（${roomId}）年度結算，繳稅 $${taxResult.taxAmount.toLocaleString()}`
            );
            emitToRoom(roomId, 'annualTaxResult', {
              playerId: player.id,
              playerName: player.name,
              year: player.paydayCount / 4,
              annualIncome: taxResult.annualIncome,
              deductions: taxResult.deductions,
              taxableIncome: taxResult.taxableIncome,
              taxAmount: taxResult.taxAmount,
              bracketBreakdown: taxResult.bracketBreakdown,
              cashAfterTax: player.cash,
            });
          }
        }
      }

      // --- 5. 處理落點格子 ---
      await handleLandingSquare(socket, player, gs);

      // --- 5b. 老鼠賽跑脫出檢查 ---
      if (checkRatRaceEscape(player)) {
        console.log(`[ratRace] ${player.name}（${roomId}）脫出老鼠賽跑！`);
        const _rrCB = player.cash; const _rrFB = player.monthlyCashflow; const _rrNWB = calcNetWorth(player);
        player.isInFastTrack = true;
        gs.gamePhase = GamePhase.FastTrack;
        addLifeExperience(player, LIFE_EXP.FAST_TRACK_ENTER);
        logPlayerEvent(player, gs, 'rat_race_escaped', `脫出老鼠賽跑！被動收入 $${player.totalPassiveIncome.toLocaleString()} ≥ 支出 $${player.totalExpenses.toLocaleString()}`, _rrCB, _rrFB, _rrNWB, { passiveIncome: player.totalPassiveIncome, totalExpenses: player.totalExpenses });
        emitToRoom(roomId, 'ratRaceEscaped', {
          playerId: player.id,
          playerName: player.name,
          monthlyPassiveIncome: player.totalPassiveIncome,
          totalExpenses: player.totalExpenses,
          lifeExpGained: LIFE_EXP.FAST_TRACK_ENTER,
          canCongratulate: true,   // 前端可顯示祝賀按鈕
        });
      }

      // --- 5c. FastTrack 資產增值 ---
      if (gs.gamePhase === GamePhase.FastTrack && player.isAlive && player.isInFastTrack) {
        applyFastTrackAppreciation(player);
      }

      // --- 6. 廣播最終遊戲狀態 ---
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

      // --- 7. 推進回合 ---
      gs.advanceToNextTurn();
    }
  );

  // ----------------------------------------------------------
  // 非當前玩家確認發薪日規劃完成 (planningDone)
  // ----------------------------------------------------------
  socket.on('planningDone', () => {
    const gs = getRoomState(socket);
    if (!gs) return;

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) return;

    gs.paydayPlanningConfirmed.add(socket.id);
    console.log(`[planningDone] ${player.name}（${gs.gameId}）確認完成規劃（${gs.paydayPlanningConfirmed.size}/${countAlivePlayers(gs)} 人）`);

    emitToRoom(gs.gameId, 'playerPlanningConfirmed', {
      playerId: player.id,
      playerName: player.name,
      confirmedCount: gs.paydayPlanningConfirmed.size,
      totalAlive: countAlivePlayers(gs),
    });
  });

  // ----------------------------------------------------------
  // 請求轉職 (requestCareerChange)
  // ----------------------------------------------------------
  socket.on('requestCareerChange', (payload: { newProfessionId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    if (player.isBedridden) {
      socket.emit('careerChangeResult', { success: false, message: '臥床中無法轉職。' });
      return;
    }

    if (player.stats.health < HP_ACTIVITY_THRESHOLDS.careerChange) {
      socket.emit('careerChangeResult', {
        success: false,
        message: `健康值不足，需要 ${HP_ACTIVITY_THRESHOLDS.careerChange} 才能轉職（目前：${player.stats.health}）。`,
      });
      return;
    }

    const { SKILL_CAREER_CHANGE_THRESHOLD: threshold } = require('./gameConfig');
    if (player.stats.careerSkill < threshold) {
      socket.emit('careerChangeResult', {
        success: false,
        message: `第二專長值不足，需達到 ${threshold} 才能轉職（目前：${player.stats.careerSkill}）。`,
      });
      return;
    }

    const _ccCB = player.cash; const _ccFB = player.monthlyCashflow; const _ccNWB = calcNetWorth(player);
    const result = executeCareerChange(player, payload.newProfessionId);
    socket.emit('careerChangeResult', result);

    if (result.success) {
      logPlayerEvent(player, gs, 'career_change', `轉職：${result.previousProfession} → ${result.newProfession}`, _ccCB, _ccFB, _ccNWB, { previousProfession: result.previousProfession, newProfession: result.newProfession, salaryChange: result.salaryChange });
      console.log(`[careerChange] ${player.name}（${roomId}）轉職：${result.previousProfession} → ${result.newProfession}`);
      emitToRoom(roomId, 'careerChangeAnnouncement', {
        playerId: player.id,
        playerName: player.name,
        previousProfession: result.previousProfession,
        newProfession: result.newProfession,
        salaryChange: result.salaryChange,
      });
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 出售資產 (sellAsset)
  // ----------------------------------------------------------
  socket.on('sellAsset', (payload: { assetId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const _saCB = player.cash; const _saFB = player.monthlyCashflow; const _saNWB = calcNetWorth(player);
    const result = sellAsset(player, payload.assetId);
    if (!result.success) {
      socket.emit('error', { message: result.message });
      return;
    }
    logPlayerEvent(player, gs, 'asset_sell', `出售資產，淨收益 $${(result.netCashChange ?? 0).toLocaleString()}`, _saCB, _saFB, _saNWB, { assetId: result.assetId, proceeds: result.proceeds, debtSettled: result.debtSettled });

    socket.emit('assetSold', {
      assetId: result.assetId,
      proceeds: result.proceeds,
      debtSettled: result.debtSettled,
      netCashChange: result.netCashChange,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 購買保險 (buyInsurance)
  // ----------------------------------------------------------
  socket.on('buyInsurance', (payload: { insuranceType: InsuranceType }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const result = buyInsurance(player, payload.insuranceType);
    if (!result.success) {
      socket.emit('error', { message: result.message });
      return;
    }

    socket.emit('insuranceUpdated', {
      insuranceType: payload.insuranceType,
      active: true,
      activationFee: result.activationFee,
      newMonthlyExpenses: player.totalExpenses,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 取消保險 (cancelInsurance)
  // ----------------------------------------------------------
  socket.on('cancelInsurance', (payload: { insuranceType: InsuranceType }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    cancelInsurance(player, payload.insuranceType);

    socket.emit('insuranceUpdated', {
      insuranceType: payload.insuranceType,
      active: false,
      activationFee: 0,
      newMonthlyExpenses: player.totalExpenses,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 應急借款 (takeEmergencyLoan)
  // ----------------------------------------------------------
  socket.on('takeEmergencyLoan', (payload: { amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const result = takeEmergencyLoan(player, payload.amount);
    if (!result.success) {
      socket.emit('error', { message: result.message });
      return;
    }

    socket.emit('loanTaken', {
      liabilityId: result.liabilityId,
      loanType: 'emergency',
      amount: result.amount,
      monthlyPayment: result.monthlyPayment,
      newCreditScore: result.newCreditScore,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 投資槓桿借款 (takeLeverageLoan)
  // ----------------------------------------------------------
  socket.on(
    'takeLeverageLoan',
    (payload: { amount: number; targetAssetName: string }) => {
      const gs = getRoomState(socket);
      if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

      const player = gs.players.get(socket.id);
      if (!player || !player.isAlive) {
        socket.emit('error', { message: '玩家不存在或已出局。' });
        return;
      }

      const result = takeLeverageLoan(player, payload.amount, payload.targetAssetName);
      if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
      }

      socket.emit('loanTaken', {
        liabilityId: result.liabilityId,
        loanType: 'leverage',
        amount: result.amount,
        monthlyPayment: result.monthlyPayment,
        newCreditScore: result.newCreditScore,
      });

      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  );

  // ----------------------------------------------------------
  // 還款 (repayLoan)
  // ----------------------------------------------------------
  socket.on('repayLoan', (payload: { liabilityId: string; amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const result = repayLoan(player, payload.liabilityId, payload.amount);
    if (!result.success) {
      socket.emit('error', { message: result.message });
      return;
    }

    socket.emit('loanRepaid', {
      liabilityId: payload.liabilityId,
      amountPaid: result.amountPaid,
      remainingDebt: result.remainingDebt,
      fullyRepaid: result.fullyRepaid,
      newCreditScore: result.newCreditScore,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 觸發全局市場事件 (triggerGlobalEvent) — 主持人專用
  // ----------------------------------------------------------
  socket.on('triggerGlobalEvent', (payload: { eventId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '權限不足：僅管理員可觸發全局事件。' });
      return;
    }

    const event = ADMIN_GLOBAL_EVENT_MAP.get(payload.eventId);
    if (!event) {
      socket.emit('error', { message: `找不到事件 ID：${payload.eventId}` });
      return;
    }

    console.log(`[triggerGlobalEvent] 房間 ${roomId} 觸發：${event.title}`);
    applyGlobalEvent(gs, event);

    emitToRoom(roomId, 'globalEventAnnouncement', { event, timestamp: new Date() });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 百歲人生：開局流程事件
  // ----------------------------------------------------------

  socket.on('rollSocialClass', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }

    const sc = rollSocialClass();
    const config = SOCIAL_CLASS_CONFIG[sc];

    player.socialClass = sc;
    player.growthPointsRemaining = config.growthPoints;
    player.cash += config.startingCashBonus;

    console.log(`[rollSocialClass] ${player.name}（${gs.gameId}）投胎為「${config.label}」`);

    socket.emit('socialClassRolled', {
      socialClass: sc,
      label: config.label,
      growthPoints: config.growthPoints,
      startingCashBonus: config.startingCashBonus,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  socket.on('allocateGrowthStats', (payload: { academic: number; health: number; social: number; resource: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }

    const { academic, health, social, resource } = payload;
    const total = academic + health + social + resource;

    if (total > player.growthPointsRemaining) {
      socket.emit('error', { message: `分配點數 (${total}) 超過可用點數 (${player.growthPointsRemaining})。` });
      return;
    }
    if ([academic, health, social, resource].some((v) => v < 0)) {
      socket.emit('error', { message: '各維度點數不可為負數。' });
      return;
    }

    applyGrowthStats(player, { academic, health, social, resource });

    const availableProfessions = getAvailableProfessions(player).map((p) => ({
      id: p.id,
      name: p.name,
      quadrant: p.quadrant,
      startingSalary: p.startingSalary,
      salaryType: p.salaryType,
      hasFlexibleSchedule: p.hasFlexibleSchedule,
    }));

    socket.emit('growthStatsApplied', {
      stats: player.stats,
      availableProfessions,
      canContinueEducation: true,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  socket.on('continueEducation', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }
    if (player.hasContinuedEducation) {
      socket.emit('error', { message: '你已選擇繼續進修。' });
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

    socket.emit('educationLoanApplied', {
      newFQ: player.stats.financialIQ,
      lifeExpGained: LIFE_EXP.CONTINUED_EDUCATION,
      availableProfessions,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  socket.on('selectQuadrant', (payload: { quadrant: 'E' | 'S' }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }

    const { quadrant } = payload;
    const hasEdu = player.hasContinuedEducation;

    // 建立隨機職業池
    let pool: string[];
    if (quadrant === 'E') {
      pool = hasEdu
        ? [...E_PROFESSION_POOLS.advanced]
        : [...E_PROFESSION_POOLS.basic];
    } else {
      pool = hasEdu
        ? [...S_PROFESSION_POOLS.advanced]
        : [...S_PROFESSION_POOLS.basicLow, ...S_PROFESSION_POOLS.basicMid];
    }

    const randomId = pool[Math.floor(Math.random() * pool.length)];
    const chosen = PROFESSIONS.find((p) => p.id === randomId);

    if (!chosen) {
      socket.emit('error', { message: '職業分配失敗，請重試。' });
      return;
    }

    player.profession = chosen;
    player.salary = chosen.startingSalary;
    player.expenses.taxes = chosen.startingTaxes;
    player.expenses.homeMortgagePayment = chosen.startingHomeMortgage;
    player.expenses.carLoanPayment = chosen.startingCarLoan;
    player.expenses.creditCardPayment = chosen.startingCreditCard;
    player.expenses.otherExpenses = chosen.startingOtherExpenses;
    player.actionTokensThisPayday = chosen.hasFlexibleSchedule ? Infinity : 1;
    player.pre20Done = true;

    console.log(`[selectQuadrant] ${player.name}（${roomId}）選擇 ${quadrant} 象限，分配職業：${chosen.name}${hasEdu ? '（進修後）' : ''}`);

    socket.emit('professionAssigned', {
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

  // ----------------------------------------------------------
  // 申請加盟（buyFranchise）
  // ----------------------------------------------------------
  socket.on('buyFranchise', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }

    if (player.cash < FRANCHISE_CASH_THRESHOLD) {
      socket.emit('error', { message: `申請加盟需要現金 $${FRANCHISE_CASH_THRESHOLD.toLocaleString()}，你目前不足。` });
      return;
    }

    const franchise = PROFESSIONS.find((p) => p.id === 'franchise_owner');
    if (!franchise) { socket.emit('error', { message: '加盟職業設定錯誤。' }); return; }

    player.profession = franchise;
    player.salary = franchise.startingSalary;
    player.expenses.otherExpenses = franchise.startingOtherExpenses;
    player.actionTokensThisPayday = Infinity;

    // 注入加盟店資產與負債
    if (franchise.startingAssets) {
      for (const tmpl of franchise.startingAssets) {
        const asset = {
          id: `franchise-${player.id}-${Date.now()}`,
          name: tmpl.name,
          type: tmpl.type,
          cost: tmpl.cost,
          currentValue: tmpl.currentValue ?? tmpl.cost,
          monthlyCashflow: tmpl.monthlyCashflow,
        };
        player.assets.push(asset);
        if (tmpl.liabilityName && tmpl.liabilityAmount) {
          player.liabilities.push({
            id: `franchise-loan-${player.id}-${Date.now()}`,
            name: tmpl.liabilityName,
            totalDebt: tmpl.liabilityAmount,
            monthlyPayment: tmpl.liabilityMonthlyPayment ?? 0,
          });
          player.expenses.homeMortgagePayment += tmpl.liabilityMonthlyPayment ?? 0;
        }
      }
    }

    logPlayerEvent(player, gs, 'franchise', `轉職加盟主（支付 $${FRANCHISE_CASH_THRESHOLD} 加盟金）`,
      player.cash, player.monthlyCashflow, 0, {});

    console.log(`[buyFranchise] ${player.name}（${roomId}）成功申請加盟`);
    socket.emit('franchisePurchased', { professionName: franchise.name, initialCashflow: player.monthlyCashflow });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 合夥投資（partnershipOffer / partnershipResponse）
  // ----------------------------------------------------------
  socket.on('partnershipOffer', (payload: { targetPlayerId: string; dealCardId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const offeror = gs.players.get(socket.id);
    const target = gs.players.get(payload.targetPlayerId);
    if (!offeror || !target) { socket.emit('error', { message: '玩家不存在。' }); return; }
    if (!target.isAlive) { socket.emit('error', { message: '目標玩家已出局。' }); return; }

    // 儲存待定合夥 offer（用 Map 存放）
    const offerId = `po-${Date.now()}`;
    if (!gs.pendingPartnershipOffers) gs.pendingPartnershipOffers = {};
    gs.pendingPartnershipOffers[offerId] = {
      offerorId: socket.id,
      targetId: payload.targetPlayerId,
      dealCardId: payload.dealCardId,
      createdAt: Date.now(),
    };

    // 通知目標玩家
    const targetSocket = [...socketRoomMap.entries()].find(([, r]) => r === roomId && gs.players.has(socket.id));
    // 廣播給目標玩家的 socket
    emitToRoom(roomId, 'partnershipOfferReceived', {
      offerId,
      offerorId: socket.id,
      offerorName: offeror.name,
      targetId: payload.targetPlayerId,
      targetName: target.name,
      dealCardId: payload.dealCardId,
    });

    console.log(`[partnership] ${offeror.name} 邀請 ${target.name} 合夥`);
  });

  socket.on('partnershipResponse', (payload: { offerId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const offer = gs.pendingPartnershipOffers?.[payload.offerId];
    if (!offer) { socket.emit('error', { message: '合夥邀請已過期。' }); return; }

    const offeror = gs.players.get(offer.offerorId);
    const target = gs.players.get(socket.id);
    if (!offeror || !target) return;

    delete gs.pendingPartnershipOffers![payload.offerId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'partnershipDeclined', { offerorId: offer.offerorId, targetId: socket.id });
      return;
    }

    // 雙方各加生命體驗值
    offeror.lifeExperience += 15;
    target.lifeExperience += 15;

    emitToRoom(roomId, 'partnershipAccepted', {
      offerorId: offer.offerorId, offerorName: offeror.name,
      targetId: socket.id,        targetName: target.name,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[partnership] ${offeror.name} 與 ${target.name} 合夥成功`);
  });

  // ----------------------------------------------------------
  // P2P 借貸（loanOffer / loanResponse / repayP2PLoan）
  // ----------------------------------------------------------
  socket.on('loanOffer', (payload: { targetPlayerId: string; amount: number; monthlyRate: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const lender = gs.players.get(socket.id);
    const borrower = gs.players.get(payload.targetPlayerId);
    if (!lender || !borrower) { socket.emit('error', { message: '玩家不存在。' }); return; }
    if (lender.cash < payload.amount) { socket.emit('error', { message: `現金不足（$${payload.amount}）。` }); return; }
    if (payload.monthlyRate < 0 || payload.monthlyRate > 0.1) { socket.emit('error', { message: '月利率需在 0–10% 之間。' }); return; }

    const offerId = `lo-${Date.now()}`;
    if (!gs.pendingLoanOffers) gs.pendingLoanOffers = {};
    gs.pendingLoanOffers[offerId] = { lenderId: socket.id, borrowerId: payload.targetPlayerId, amount: payload.amount, monthlyRate: payload.monthlyRate, createdAt: Date.now() };

    emitToRoom(roomId, 'loanOfferReceived', {
      offerId, lenderId: socket.id, lenderName: lender.name,
      borrowerId: payload.targetPlayerId, borrowerName: borrower.name,
      amount: payload.amount, monthlyRate: payload.monthlyRate,
    });
  });

  socket.on('loanResponse', (payload: { offerId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const offer = gs.pendingLoanOffers?.[payload.offerId];
    if (!offer) { socket.emit('error', { message: '借貸邀請已過期。' }); return; }

    const lender = gs.players.get(offer.lenderId);
    const borrower = gs.players.get(socket.id);
    if (!lender || !borrower) return;

    delete gs.pendingLoanOffers![payload.offerId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'loanDeclined', { lenderId: offer.lenderId, borrowerId: socket.id });
      return;
    }

    if (lender.cash < offer.amount) { socket.emit('error', { message: '貸款方現金已不足。' }); return; }

    // 資金轉移
    lender.cash -= offer.amount;
    borrower.cash += offer.amount;

    const loanId = `p2p-${Date.now()}`;
    const monthlyInterest = Math.round(offer.amount * offer.monthlyRate);

    // 貸款方：新增「借出款項」資產
    lender.assets.push({
      id: loanId,
      name: `借出給 ${borrower.name}`,
      type: 'Business' as import('./gameConstants').AssetType,
      cost: offer.amount,
      currentValue: offer.amount,
      monthlyCashflow: monthlyInterest,
    });

    // 借款方：新增負債
    borrower.liabilities.push({
      id: loanId,
      name: `向 ${lender.name} 借款`,
      totalDebt: offer.amount,
      monthlyPayment: monthlyInterest,
    });
    borrower.expenses.otherExpenses += monthlyInterest;

    emitToRoom(roomId, 'loanAccepted', {
      loanId, lenderId: offer.lenderId, lenderName: lender.name,
      borrowerId: socket.id, borrowerName: borrower.name,
      amount: offer.amount, monthlyRate: offer.monthlyRate, monthlyInterest,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[p2ploan] ${lender.name} 借款 $${offer.amount} 給 ${borrower.name}（月息 $${monthlyInterest}）`);
  });

  // ----------------------------------------------------------
  // BigDeal 競標（bidDeal）
  // ----------------------------------------------------------
  socket.on('bidDeal', (payload: { auctionId: string; bidAmount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const bidder = gs.players.get(socket.id);
    if (!bidder || !bidder.isAlive) return;

    if (!gs.activeAuctions) gs.activeAuctions = {};
    const auction = gs.activeAuctions[payload.auctionId];
    if (!auction) { socket.emit('error', { message: '競標已結束或不存在。' }); return; }
    if (bidder.cash < payload.bidAmount) { socket.emit('error', { message: '現金不足。' }); return; }
    if (payload.bidAmount <= (auction.highestBid ?? 0)) { socket.emit('error', { message: '出價需高於目前最高標。' }); return; }

    auction.highestBid = payload.bidAmount;
    auction.highestBidderId = socket.id;
    auction.highestBidderName = bidder.name;

    emitToRoom(roomId, 'dealBidUpdated', {
      auctionId: payload.auctionId, bidderId: socket.id, bidderName: bidder.name,
      bidAmount: payload.bidAmount,
    });
  });

  // ----------------------------------------------------------
  // 人生事件祝賀（congratulate）
  // ----------------------------------------------------------
  socket.on('congratulate', (payload: { targetPlayerId: string; event: string }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const sender = gs.players.get(socket.id);
    const target = gs.players.get(payload.targetPlayerId);
    if (!sender || !target) return;
    if (sender.cash < 500) { socket.emit('error', { message: '現金不足（需 $500）。' }); return; }

    sender.cash -= 500;
    target.cash += 500;
    target.stats.network = Math.min(10, target.stats.network + 0.2);

    emitToRoom(roomId, 'congratulationSent', {
      senderId: socket.id, senderName: sender.name,
      targetId: payload.targetPlayerId, targetName: target.name,
      event: payload.event, amount: 500,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 時鐘控制事件（主持人專用）
  // ----------------------------------------------------------

  socket.on('startGame', (payload?: { durationMinutes?: number; force?: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以啟動遊戲。' });
      return;
    }

    if (!payload?.force) {
      const notReady = [...gs.players.values()].filter((p) => !p.pre20Done);
      if (notReady.length > 0) {
        const names = notReady.map((p) => p.name).join('、');
        socket.emit('error', {
          message: `以下玩家尚未完成職業選擇：${names}。若要強制啟動，請傳入 { force: true }。`,
        });
        return;
      }
    }

    const minutes = payload?.durationMinutes ?? 90;
    const durationMs = Math.min(
      MAX_GAME_DURATION_MS,
      Math.max(MIN_GAME_DURATION_MS, minutes * 60 * 1000)
    );

    gs.gameDurationMs = durationMs;
    gs.gamePhase = GamePhase.RatRace;
    startGameClock(gs);

    console.log(`[startGame] 房間 ${roomId} 遊戲啟動，時長：${minutes} 分鐘`);

    emitToRoom(roomId, 'gameStarted', {
      gameStartTime: gs.gameStartTime,
      gameDurationMs: gs.gameDurationMs,
      endTime: new Date(gs.gameStartTime!.getTime() + durationMs),
    });

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  socket.on('pauseGame', (payload?: { reason?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以暫停遊戲。' });
      return;
    }
    if (gs.pausedAt !== null) {
      socket.emit('error', { message: '遊戲已在暫停中。' });
      return;
    }

    pauseGameClock(gs);
    console.log(`[pauseGame] 房間 ${roomId} 時鐘暫停`);

    emitToRoom(roomId, 'gamePaused', {
      reason: payload?.reason ?? '主持人暫停',
      pausedAt: gs.pausedAt,
      currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    });
  });

  socket.on('resumeGame', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以恢復遊戲。' });
      return;
    }
    if (gs.pausedAt === null) {
      socket.emit('error', { message: '遊戲未在暫停中。' });
      return;
    }

    resumeGameClock(gs);
    const currentAge = getCurrentAge(gs);
    console.log(`[resumeGame] 房間 ${roomId} 時鐘恢復，目前年齡：${currentAge.toFixed(1)} 歲`);

    emitToRoom(roomId, 'gameResumed', {
      resumedAt: new Date(),
      currentAge: Math.round(currentAge * 10) / 10,
    });

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 主持人觸發邂逅 (triggerRelationship)
  // ----------------------------------------------------------
  socket.on('triggerRelationship', (payload: { targetPlayerId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以觸發邂逅事件。' });
      return;
    }

    const target = gs.players.get(payload?.targetPlayerId);
    if (!target || !target.isAlive) {
      socket.emit('error', { message: '目標玩家不存在或已出局。' });
      return;
    }

    const result = activateRelationship(target);
    socket.emit('triggerRelationshipResult', result);

    if (result.activated) {
      console.log(`[relationship] ${target.name}（${roomId}）邂逅觸發`);

      // 找到目標玩家的 socket 並直接通知
      const targetSocketEntry = [...io.sockets.sockets.entries()]
        .find(([, s]) => socketRoomMap.get(s.id) === roomId && s.id === target.id);
      if (targetSocketEntry) {
        targetSocketEntry[1].emit('relationshipActivated', {
          drsBonus: HOST_ACTIVATION_DRS_BONUS,
          currentDrs: target.relationshipPoints,
          threshold: require('./gameConfig').RELATIONSHIP_MARRIAGE_THRESHOLD,
        });
      } else {
        // fallback：直接用 target.id 找 socket
        const targetSocket = io.sockets.sockets.get(target.id);
        if (targetSocket) {
          targetSocket.emit('relationshipActivated', {
            drsBonus: HOST_ACTIVATION_DRS_BONUS,
            currentDrs: target.relationshipPoints,
            threshold: require('./gameConfig').RELATIONSHIP_MARRIAGE_THRESHOLD,
          });
        }
      }

      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 管理員：手動調整玩家能力值 (setPlayerStats)
  // ----------------------------------------------------------
  socket.on('setPlayerStats', (payload: {
    targetPlayerId: string;
    stats: { fq?: number; hp?: number; sk?: number; nt?: number };
  }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以調整玩家能力值。' });
      return;
    }

    const target = gs.players.get(payload?.targetPlayerId);
    if (!target) {
      socket.emit('error', { message: '目標玩家不存在。' });
      return;
    }

    const stats = payload?.stats ?? {};
    const MAX_STAT = 100;
    const MIN_STAT = 0;
    const clamp = (val: number) => Math.max(MIN_STAT, Math.min(MAX_STAT, Math.round(val)));

    if (stats.fq !== undefined) target.stats.financialIQ = clamp(stats.fq);
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

    socket.emit('setPlayerStatsResult', { success: true, targetPlayerId: target.id, stats: changed });
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 旅遊行動 (goTravel)
  // ----------------------------------------------------------
  socket.on('goTravel', (payload: { destinationId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const _tvCB = player.cash; const _tvFB = player.monthlyCashflow; const _tvNWB = calcNetWorth(player);
    const result = goTravel(player, payload.destinationId);
    socket.emit('travelResult', result);

    if (result.success) {
      logPlayerEvent(player, gs, 'travel', `前往「${result.destination?.name ?? payload.destinationId}」（體驗值 +${result.lifeExperienceGained}）`, _tvCB, _tvFB, _tvNWB, { lifeExpGained: result.lifeExperienceGained });
      console.log(`[travel] ${player.name}（${gs.gameId}）前往 ${result.destination?.name}！體驗值 +${result.lifeExperienceGained}`);
      emitToRoom(gs.gameId, 'playerTraveled', {
        playerId: player.id,
        playerName: player.name,
        destinationName: result.destination?.name,
        destinationRegion: result.destination?.region,
        lifeExperienceGained: result.lifeExperienceGained,
        statEffect: result.destination?.statEffect,
        travelPenaltyRemaining: player.travelPenaltyRemaining,
      });
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 聯誼活動 (attendSocialEvent)
  // ----------------------------------------------------------
  socket.on('attendSocialEvent', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const currentAge = getCurrentAge(gs);
    const result = attendSocialEvent(player, currentAge);
    socket.emit('socialEventResult', result);

    if (result.success) {
      const { RELATIONSHIP_MARRIAGE_THRESHOLD: threshold } = require('./gameConfig');
      if (
        result.newRelationshipPoints !== undefined &&
        result.newRelationshipPoints >= threshold &&
        !player.isMarried
      ) {
        socket.emit('marriageThresholdReached', {
          playerId: player.id,
          relationshipPoints: result.newRelationshipPoints,
          threshold,
        });
      }
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 求婚 (proposeMarriage)
  // ----------------------------------------------------------
  socket.on('proposeMarriage', (payload: { type?: 'love' | 'matchmaker' }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const type = payload?.type ?? 'love';
    const _mCB = player.cash; const _mFB = player.monthlyCashflow; const _mNWB = calcNetWorth(player);
    const result = confirmMarriage(player, type);
    socket.emit('marriageResult', result);

    if (result.success) {
      logPlayerEvent(player, gs, 'marriage', `結婚（${type === 'love' ? '愛情' : '媒人'}），月收入加成 +$${result.marriageBonus}`, _mCB, _mFB, _mNWB, { marriageType: type, marriageBonus: result.marriageBonus, lifeExpGained: result.lifeExpGained });
      emitToRoom(gs.gameId, 'marriageAnnouncement', {
        playerId: player.id,
        playerName: player.name,
        marriageType: type,
        marriageBonus: result.marriageBonus,
        lifeExpGained: result.lifeExpGained,
        canCongratulate: true,
      });
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 買賣婚姻 (buyArrangedMarriage)
  // ----------------------------------------------------------
  socket.on('buyArrangedMarriage', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const currentAge = getCurrentAge(gs);
    const cost = getArrangedMarriageCost(currentAge);
    const _amCB = player.cash; const _amFB = player.monthlyCashflow; const _amNWB = calcNetWorth(player);
    const result = buyArrangedMarriage(player, currentAge);

    socket.emit('arrangedMarriageResult', { ...result, cost });

    if (result.success) {
      logPlayerEvent(player, gs, 'marriage', `買賣婚姻（${Math.round(currentAge)} 歲），費用 $${cost.toLocaleString()}，月加成 +$${result.marriageBonus}`, _amCB, _amFB, _amNWB, { marriageType: 'arranged', cost, marriageBonus: result.marriageBonus });
      emitToRoom(gs.gameId, 'marriageAnnouncement', {
        playerId: player.id,
        playerName: player.name,
        marriageType: 'arranged',
        marriageBonus: result.marriageBonus,
        lifeExpGained: result.lifeExpGained,
        cost,
      });
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 玩家請求個人決策分析 (requestPlayerAnalysis)
  // ----------------------------------------------------------
  /**
   * 遊戲結束後（反思階段），玩家或主持人請求某位玩家的完整事件日誌與分析統計。
   * Client → Server: { targetPlayerId?: string }  省略則回傳自己的資料
   * Server → Caller: playerAnalysis { playerId, playerName, eventLog, stats }
   */
  socket.on('requestPlayerAnalysis', (payload?: { targetPlayerId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const targetId = payload?.targetPlayerId ?? socket.id;
    const target = gs.players.get(targetId);

    // 主持人可查詢任意玩家；玩家只能查自己
    if (targetId !== socket.id && socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只能查看自己的分析資料，或由管理員查詢。' });
      return;
    }

    if (!target) {
      socket.emit('error', { message: '玩家不存在。' });
      return;
    }

    // 彙整統計
    const eventLog = target.eventLog;
    const assetBuyCount = eventLog.filter((e) => e.type === 'asset_buy').length;
    const assetSellCount = eventLog.filter((e) => e.type === 'asset_sell').length;
    const crisisCount = eventLog.filter((e) => e.type === 'crisis').length;
    const travelCount = eventLog.filter((e) => e.type === 'travel').length;
    const paydayCount = eventLog.filter((e) => e.type === 'payday').length;

    // 現金流歷史：每次發薪日的現金流快照（用於折線圖）
    const cashflowHistory = eventLog
      .filter((e) => e.type === 'payday')
      .map((e) => ({ age: e.age, cashflow: e.cashflowAfter, netWorth: e.netWorthAfter }));

    // 關鍵決策：對現金流影響最大的前 5 個非發薪日事件
    const keyDecisions = eventLog
      .filter((e) => e.type !== 'payday' && e.type !== 'death')
      .map((e) => ({
        age: e.age,
        type: e.type,
        description: e.description,
        cashflowDelta: e.cashflowAfter - e.cashflowBefore,
        cashDelta: e.cashAfter - e.cashBefore,
        netWorthDelta: e.netWorthAfter - e.netWorthBefore,
      }))
      .sort((a, b) => Math.abs(b.cashflowDelta) - Math.abs(a.cashflowDelta))
      .slice(0, 5);

    // 最終評分
    const deathAge = target.isAlive
      ? Math.round(getCurrentAge(gs))
      : (eventLog.find((e) => e.type === 'death')?.age ?? Math.round(getCurrentAge(gs)));
    const finalScore = calculateLifeScore(target, deathAge);

    socket.emit('playerAnalysis', {
      playerId: target.id,
      playerName: target.name,
      profession: target.profession.name,
      quadrant: target.profession.quadrant,
      isMarried: target.isMarried,
      numberOfChildren: target.numberOfChildren,
      lifeExperience: target.lifeExperience,
      deathAge,
      finalScore,
      eventLog,
      summary: {
        assetBuyCount,
        assetSellCount,
        crisisCount,
        travelCount,
        paydayCount,
        isMarried: target.isMarried,
        numberOfChildren: target.numberOfChildren,
        escapedRatRace: target.isInFastTrack,
        finalNetWorth: calcNetWorth(target),
        finalCashflow: target.monthlyCashflow,
        finalPassiveIncome: target.totalPassiveIncome,
      },
      cashflowHistory,
      keyDecisions,
    });
  });

  // ----------------------------------------------------------
  // 房間所有玩家的彙整分析（大螢幕用）(requestRoomAnalysis)
  // ----------------------------------------------------------
  /**
   * 主持人或大螢幕請求整個房間所有玩家的分析摘要（用於比較雷達圖與排行榜）。
   * Client → Server: {}
   * Server → Caller: roomAnalysis { players: [...] }
   */
  socket.on('requestRoomAnalysis', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const currentAge = Math.round(getCurrentAge(gs));

    const players = Array.from(gs.players.values()).map((p) => {
      const deathAge = p.isAlive ? currentAge : (p.eventLog.find((e) => e.type === 'death')?.age ?? currentAge);
      const score = calculateLifeScore(p, deathAge);
      return {
        playerId: p.id,
        playerName: p.name,
        profession: p.profession.name,
        quadrant: p.profession.quadrant,
        isAlive: p.isAlive,
        isMarried: p.isMarried,
        numberOfChildren: p.numberOfChildren,
        lifeExperience: p.lifeExperience,
        deathAge,
        escapedRatRace: p.isInFastTrack,
        finalNetWorth: calcNetWorth(p),
        finalCashflow: p.monthlyCashflow,
        finalPassiveIncome: p.totalPassiveIncome,
        score,
        cashflowHistory: p.eventLog
          .filter((e) => e.type === 'payday')
          .map((e) => ({ age: e.age, cashflow: e.cashflowAfter, netWorth: e.netWorthAfter })),
      };
    });

    // 依總分排名
    players.sort((a, b) => b.score.total - a.score.total);

    socket.emit('roomAnalysis', { roomId: gs.gameId, players, currentAge });
  });

  // ----------------------------------------------------------
  // 客戶端斷線 (disconnect)
  // ----------------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`[斷線] 客戶端離線：${socket.id}`);

    const roomId = socketRoomMap.get(socket.id);
    socketRoomMap.delete(socket.id);

    if (!roomId) return;

    const gs = rooms.get(roomId);
    if (!gs) return;

    // 若斷線的是管理員，清除管理員狀態（玩家資料保留，等待重新登入）
    if (socket.id === gs.adminSocketId) {
      gs.adminSocketId = undefined;
      console.log(`[斷線] 房間 ${roomId} 管理員離線，等待重新登入`);
    }

    const player = gs.players.get(socket.id);
    if (player) {
      // 標記為斷線狀態，30 秒內可重連恢復資料
      player.isDisconnected = true;
      console.log(`[斷線] 玩家 ${player.name} 斷線，保留資料 30 秒等待重連`);
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

      setTimeout(() => {
        // 30 秒後若仍是斷線狀態（未重連），才真正移除
        if (player.isDisconnected) {
          const wasCurrentTurn = gs.currentPlayerTurnId === socket.id;
          gs.removePlayer(socket.id);
          if (wasCurrentTurn && gs.playerOrder.length > 0) {
            gs.advanceToNextTurn();
          }
          console.log(`[斷線] 玩家 ${player.name} 重連逾時，已移除。房間 ${roomId} 剩 ${gs.players.size} 人`);
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        }
      }, 30000);
    }

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

    // 若房間已空且遊戲結束，延遲 30 分鐘後自動清理
    if (gs.players.size === 0 && gs.gamePhase === GamePhase.GameOver) {
      setTimeout(() => {
        if (rooms.has(roomId) && rooms.get(roomId)!.players.size === 0) {
          rooms.delete(roomId);
          console.log(`[autoCleanup] 房間 ${roomId} 已自動清除（遊戲結束且無玩家）`);
        }
      }, 30 * 60 * 1000);
    }
  });

  // ----------------------------------------------------------
  // 玩家重連恢復 (playerRejoin)
  // ----------------------------------------------------------
  socket.on('playerRejoin', (payload: { playerName: string; roomCode: string }) => {
    const { playerName, roomCode } = payload;

    const gs = rooms.get(roomCode);
    if (!gs) {
      socket.emit('rejoinFailed', { message: `房間 ${roomCode} 不存在或已結束。` });
      return;
    }

    // 在房間內尋找同名且處於斷線狀態的玩家
    let foundPlayer: Player | undefined;
    let oldSocketId: string | undefined;
    for (const [sid, p] of gs.players.entries()) {
      if (p.name === playerName && p.isDisconnected) {
        foundPlayer = p;
        oldSocketId = sid;
        break;
      }
    }

    if (!foundPlayer || !oldSocketId) {
      socket.emit('rejoinFailed', { message: '找不到可重連的資料，請重新加入遊戲。' });
      return;
    }

    // 將舊 socket id 的玩家資料移轉到新 socket id
    foundPlayer.id = socket.id;
    foundPlayer.isDisconnected = false;
    gs.players.delete(oldSocketId);
    gs.players.set(socket.id, foundPlayer);

    // 更新回合順序中的 id
    const orderIdx = gs.playerOrder.indexOf(oldSocketId);
    if (orderIdx !== -1) gs.playerOrder[orderIdx] = socket.id;
    if (gs.currentPlayerTurnId === oldSocketId) gs.currentPlayerTurnId = socket.id;

    socket.join(roomCode);
    socketRoomMap.set(socket.id, roomCode);

    console.log(`[重連] 玩家 ${playerName} 重連成功，恢復至房間 ${roomCode}`);
    socket.emit('rejoinSuccess', { playerId: socket.id });
    emitToRoom(roomCode, 'gameStateUpdate', serializeGameState(gs));
  });
});

// ============================================================
// 發薪日規劃輔助函數
// ============================================================

function waitForPaydayPlan(socket: Socket, player: Player): Promise<PaydayPlanPayload> {
  return new Promise((resolve) => {
    const emptyPlan: PaydayPlanPayload = {
      investInFQUpgrade: false,
      investInHealthMaintenance: false,
      investInHealthBoost: false,
      investInSkillTraining: false,
      investInNetwork: false,
    };

    const timer = setTimeout(() => {
      socket.removeAllListeners('submitPaydayPlan');
      console.log(`[paydayPlan] ${player.name} 逾時自動略過規劃`);
      resolve(emptyPlan);
    }, PAYDAY_PLANNING_TIMEOUT_MS);

    socket.once('submitPaydayPlan', (plan: PaydayPlanPayload) => {
      clearTimeout(timer);
      resolve(plan ?? emptyPlan);
    });
  });
}

// ============================================================
// 卡牌決策等待輔助
// ============================================================

function waitForCardDecision(
  socket: Socket,
  timeoutMs = 15000
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners('submitCardDecision');
      resolve(null);
    }, timeoutMs);

    socket.once('submitCardDecision', (decision: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(decision ?? null);
    });
  });
}

function countAlivePlayers(gs: GameState): number {
  let count = 0;
  gs.players.forEach((p) => { if (p.isAlive) count++; });
  return count;
}

function waitForAllPlanningDone(gs: GameState, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const alive = countAlivePlayers(gs);
      if (gs.paydayPlanningConfirmed.size >= alive || Date.now() >= deadline) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// ============================================================
// 格子落點處理器
// ============================================================

async function handleLandingSquare(
  socket: Socket,
  player: Player,
  gs: GameState
): Promise<void> {
  const roomId = gs.gameId;

  // ── 外圈落點處理 ─────────────────────────────────────────
  if (player.isInFastTrack) {
    const ftSqType = getFastTrackSquareType(player.fastTrackPosition);
    const sqLabel = FAST_TRACK_BOARD[player.fastTrackPosition % FAST_TRACK_BOARD.length]?.label ?? '';

    emitToRoom(roomId, 'fastTrackLanding', {
      playerId: player.id,
      playerName: player.name,
      position: player.fastTrackPosition,
      squareType: ftSqType,
      label: sqLabel,
    });

    switch (ftSqType) {
      case FastTrackSquareType.PaydayBonus: {
        const bonus = applyFastTrackPaydayBonus(player);
        const cf = player.monthlyCashflow;
        player.cash += cf;
        player.paydayCount += 1;
        applyFastTrackAppreciation(player);
        emitToRoom(roomId, 'fastTrackPayday', {
          playerId: player.id, playerName: player.name,
          cashflow: cf, bonus, cashAfter: player.cash,
        });
        break;
      }
      case FastTrackSquareType.BigRealEstate:
      case FastTrackSquareType.BusinessDeal:
      case FastTrackSquareType.StockOpportunity: {
        // 大型交易：從現有大交易牌組抽牌
        const { BIG_DEALS } = require('./gameCards');
        const deal: DealCard = BIG_DEALS[Math.floor(Math.random() * BIG_DEALS.length)];
        pauseGameClock(gs);
        emitToRoom(roomId, 'gamePaused', { reason: '外圈大型交易', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });
        socket.emit('fastTrackDealCard', {
          squareType: ftSqType,
          deal,
          isFastTrack: true,
        });
        break;
      }
      case FastTrackSquareType.NetworkSummit: {
        const ntBonus = player.stats.network * 5000;
        player.cash += ntBonus;
        player.lifeExperience += 8;
        emitToRoom(roomId, 'fastTrackNetworkSummit', {
          playerId: player.id, playerName: player.name,
          ntLevel: player.stats.network, cashBonus: ntBonus,
        });
        break;
      }
      case FastTrackSquareType.Charity: {
        const charityAmount = Math.round(player.monthlyCashflow * 0.1);
        if (player.cash >= charityAmount && charityAmount > 0) {
          player.cash -= charityAmount;
          player.lifeExperience += 15;
          player.legacyBonusPoints += 5;
          emitToRoom(roomId, 'fastTrackCharity', {
            playerId: player.id, playerName: player.name,
            amount: charityAmount, legacyBonus: 5,
          });
        }
        break;
      }
      case FastTrackSquareType.TaxPlanning: {
        const taxSaving = Math.round(player.expenses.taxes * 0.2);
        player.cash += taxSaving;
        emitToRoom(roomId, 'fastTrackTaxPlanning', {
          playerId: player.id, playerName: player.name, taxSaving,
        });
        break;
      }
      case FastTrackSquareType.LegacyPlanning: {
        socket.emit('fastTrackLegacyPlanning', { playerId: player.id });
        break;
      }
      case FastTrackSquareType.GlobalWave: {
        const { MARKET_EVENTS } = require('./gameCards');
        const evt = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
        emitToRoom(roomId, 'globalWaveEvent', { triggeredBy: player.name, event: evt });
        break;
      }
      case FastTrackSquareType.Partnership: {
        const others = [...gs.players.values()].filter((p) => p.id !== player.id && p.isAlive);
        if (others.length > 0) {
          socket.emit('partnershipOpportunity', {
            availablePartners: others.map((p) => ({ id: p.id, name: p.name })),
          });
        }
        break;
      }
      case FastTrackSquareType.Crisis: {
        const { FAST_TRACK_CRISIS_EVENTS } = require('./gameCards');
        const pool = FAST_TRACK_CRISIS_EVENTS ?? [];
        if (pool.length > 0) {
          const c = pool[Math.floor(Math.random() * pool.length)];
          socket.emit('fastTrackCrisisCard', { crisis: c });
        }
        break;
      }
      case FastTrackSquareType.LifeJourney: {
        const { TRAVEL_DESTINATIONS } = require('./gameConfig');
        const outerDests = (TRAVEL_DESTINATIONS as Array<{ id: string; name: string; tier: string; cost: number; lifeExpGained: number; region: string }>)
          .filter((d) => d.tier === 'outer' || d.tier === 'both');
        socket.emit('fastTrackTravelOptions', {
          destinations: outerDests.map((d) => ({ id: d.id, name: d.name, region: d.region, cost: d.cost, lifeExpGained: d.lifeExpGained })),
        });
        break;
      }
      case FastTrackSquareType.Relationship: {
        const relEvents = require('./gameCards').RELATIONSHIP_EVENTS;
        const rel = relEvents[Math.floor(Math.random() * relEvents.length)];
        if (rel) {
          const { applyRelationshipCard } = require('./cardSystem');
          applyRelationshipCard(player, rel);
          socket.emit('relationshipCardApplied', { card: rel });
        }
        break;
      }
      case FastTrackSquareType.LegacyChoice: {
        pauseGameClock(gs);
        emitToRoom(roomId, 'gamePaused', { reason: '傳承決策', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });
        socket.emit('legacyChoiceRequired', {
          currentLegacyBonus: player.legacyBonusPoints,
          numberOfChildren: player.numberOfChildren,
          netWorth: calcNetWorth(player),
        });
        break;
      }
      default:
        break;
    }

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    return;
  }

  // ── 內圈落點處理 ─────────────────────────────────────────
  const squareType = getSquareType(player.currentPosition);

  switch (squareType) {
    case SquareType.Payday:
      break;

    case SquareType.Baby: {
      const babyAge = getCurrentAge(gs);
      const babyWindow = LIFE_EVENT_WINDOWS.children;

      if (player.stats.health < HP_ACTIVITY_THRESHOLDS.baby) {
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          effect: { type: 'babySkipped', ageAtEvent: Math.round(babyAge), reason: 'lowHP' },
        });
        break;
      }

      const inPeak = babyAge >= babyWindow.peakStart && babyAge <= babyWindow.peakEnd;
      const babyProbability = inPeak ? babyWindow.peakProbability : babyWindow.baseProbability;

      if (Math.random() < babyProbability) {
        const _byCB = player.cash; const _byFB = player.monthlyCashflow; const _byNWB = calcNetWorth(player);
        applyBabyCard(player);
        addLifeExperience(player, LIFE_EXP.HAVE_CHILD);
        logPlayerEvent(player, gs, 'child', `添丁！第 ${player.numberOfChildren} 個孩子`, _byCB, _byFB, _byNWB, { childCount: player.numberOfChildren });
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'baby', numberOfChildren: player.numberOfChildren, lifeExpGained: LIFE_EXP.HAVE_CHILD },
        });
      } else {
        if (!player.isMarried && Math.random() < LIFE_EVENT_WINDOWS.marriage.baseProbability) {
          await triggerMarriageWindow(socket, player, gs);
        } else {
          emitToRoom(roomId, 'cardApplied', {
            playerId: player.id,
            squareType,
            effect: { type: 'babySkipped', ageAtEvent: Math.round(babyAge) },
          });
        }
      }
      break;
    }

    case SquareType.Doodad: {
      const card = gs.doodadDeck.draw();
      if (!card) break;
      const result = applyDoodadCard(player, card);
      gs.doodadDeck.discard(card);
      socket.emit('cardDrawn', { squareType, card });
      emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: result });
      break;
    }

    case SquareType.Downsizing: {
      applyDownsizingCard(player, {
        id: 'ds-default',
        title: '裁員',
        description: '公司裁員，下一個發薪日薪資暫停發放。',
        turnsWithoutSalary: 1,
      });
      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: { type: 'downsizing', downsizingTurnsLeft: player.downsizingTurnsLeft },
      });
      break;
    }

    case SquareType.Market: {
      const card = gs.marketDeck.draw();
      if (!card) break;
      const result = applyMarketCard(gs, card);
      gs.marketDeck.discard(card);
      emitToRoom(roomId, 'marketCardApplied', { card, affectedAssets: result.affectedAssets });
      break;
    }

    case SquareType.SmallDeal:
    case SquareType.BigDeal: {
      if (squareType === SquareType.BigDeal && player.stats.health < HP_ACTIVITY_THRESHOLDS.bigDeal) {
        socket.emit('error', {
          message: `健康值不足，無法執行大型交易（需要 ${HP_ACTIVITY_THRESHOLDS.bigDeal}，目前 ${player.stats.health}）。`,
        });
        break;
      }

      const deck = squareType === SquareType.SmallDeal ? gs.smallDealDeck : gs.bigDealDeck;
      const nt = player.stats.network;
      const drawCount = nt >= 5 ? 2 : 1;
      const drawnCards: DealCard[] = [];
      for (let i = 0; i < drawCount; i++) {
        const c = deck.draw();
        if (c) drawnCards.push(c);
      }

      if (drawnCards.length === 0) break;

      // 廣播競標機會給同圈玩家（20秒）
      const auctionId = `auction-${Date.now()}`;
      const auctionEndTime = Date.now() + 20000;
      if (!gs.activeAuctions) gs.activeAuctions = {};
      gs.activeAuctions[auctionId] = {
        dealCardId: drawnCards[0].id,
        startTime: Date.now(), endTime: auctionEndTime,
        highestBid: 0,
      };
      const otherTrackPlayers = [...gs.players.values()].filter(
        (p) => p.id !== player.id && p.isAlive && p.isInFastTrack === player.isInFastTrack
      );
      if (otherTrackPlayers.length > 0) {
        emitToRoom(roomId, 'dealAuctionStarted', {
          auctionId, triggeredBy: player.id, triggeredByName: player.name,
          cards: drawnCards, endsAt: auctionEndTime,
        });
        // 20秒後結算競標
        setTimeout(() => {
          const auction = gs.activeAuctions?.[auctionId];
          if (auction) {
            delete gs.activeAuctions![auctionId];
            emitToRoom(roomId, 'dealAuctionEnded', {
              auctionId,
              winnerId: auction.highestBidderId,
              winnerName: auction.highestBidderName,
              winningBid: auction.highestBid,
            });
            if (auction.highestBidderId && auction.highestBid > 0) {
              const winner = gs.players.get(auction.highestBidderId);
              if (winner && winner.cash >= auction.highestBid) {
                winner.cash -= auction.highestBid;
                player.cash += auction.highestBid;
                emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
              }
            }
          }
        }, 20000);
      }

      socket.emit('dealCardsDrawn', { cards: drawnCards, canPickTwo: drawCount > 1 });
      const decision = await waitForCardDecision(socket);

      if (decision && decision.accept) {
        const selectedId = decision.selectedCardId as string | undefined;
        const chosen = selectedId
          ? drawnCards.find((c) => c.id === selectedId) ?? drawnCards[0]
          : drawnCards[0];

        const _dcCB = player.cash; const _dcFB = player.monthlyCashflow; const _dcNWB = calcNetWorth(player);
        acceptDealCard(player, chosen);
        logPlayerEvent(player, gs, 'asset_buy', `接受交易：${chosen.title}（月現金流 ${(chosen.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${chosen.asset.monthlyCashflow ?? 0}）`, _dcCB, _dcFB, _dcNWB, { cardId: chosen.id, cardTitle: chosen.title, monthlyCashflow: chosen.asset.monthlyCashflow, squareType });
        drawnCards.filter((c) => c.id !== chosen.id).forEach((c) => deck.discard(c));
        deck.discard(chosen);

        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'dealAccepted', card: chosen },
        });
      } else {
        drawnCards.forEach((c) => deck.discard(c));
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'dealDeclined' },
        });
      }
      break;
    }

    case SquareType.Charity: {
      const card: CharityCard = CHARITY_CARD;
      const donationAmount = Math.round(player.salary * card.donationPercentage);

      socket.emit('charityCardPending', { card, donationAmount });
      const decision = await waitForCardDecision(socket);
      const donate = decision?.donate === true;

      applyCharityDonation(player, card, donate);

      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: { type: 'charity', donated: donate, donationAmount: donate ? donationAmount : 0, bonusDice: player.bonusDice },
      });
      break;
    }

    case SquareType.Crisis: {
      const currentAge = getCurrentAge(gs);
      const stage = getLifeStage(currentAge);

      const freqMultiplier = CRISIS_FREQ_BY_STAGE[stage];
      if (Math.random() > Math.min(1, freqMultiplier / 2.2)) {
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'crisisAvoided', stage },
        });
        break;
      }

      const stagePool = CRISIS_POOL_BY_STAGE[stage];
      const stageCards = CRISIS_EVENTS.filter((c) => stagePool.includes(c.id));
      const eligibleCards = stageCards.length > 0 ? stageCards : CRISIS_EVENTS;
      const card = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];

      if (player.stats.network >= 3 && !player.stats.networkCrisisSkipUsed) {
        socket.emit('crisisNTSkipAvailable', { card, timeoutMs: 15000 });
        const decision = await waitForCardDecision(socket, 15000);

        if (decision?.useNTSkip === true) {
          player.stats.networkCrisisSkipUsed = true;
          emitToRoom(roomId, 'cardApplied', {
            playerId: player.id,
            squareType,
            effect: { type: 'crisisSkippedByNT', card },
          });
          break;
        }
      }

      const _crCB = player.cash; const _crFB = player.monthlyCashflow; const _crNWB = calcNetWorth(player);
      const result = applyCrisisCard(player, card);
      emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: result });
      logPlayerEvent(player, gs, 'crisis', `危機事件：${card.title}`, _crCB, _crFB, _crNWB, { cardId: card.id, cardTitle: card.title, deathTriggered: result.deathTriggered });

      if (result.deathTriggered) {
        const deathAge = Math.round(getCurrentAge(gs));
        const finalScore = calculateLifeScore(player, deathAge);
        handlePlayerDeath(player, gs);

        console.log(`[crisis] ${player.name}（${roomId}）死亡（${deathAge} 歲），評分：${finalScore.total}`);

        emitToRoom(roomId, 'playerFinalScore', {
          playerId: player.id,
          playerName: player.name,
          deathAge,
          cause: 'crisis',
          score: finalScore,
          profession: player.profession.name,
          quadrant: player.profession.quadrant,
          isMarried: player.isMarried,
          numberOfChildren: player.numberOfChildren,
          lifeExperience: player.lifeExperience,
        });

        emitToRoom(roomId, 'playerEliminated', {
          playerId: player.id,
          playerName: player.name,
          deathAge,
          cause: 'crisis',
        });
      }
      break;
    }

    case SquareType.Relationship: {
      const relCard = RELATIONSHIP_EVENTS[Math.floor(Math.random() * RELATIONSHIP_EVENTS.length)];

      // ── 機遇型事件：等待玩家 15 秒決策 ──
      if (relCard.eventCategory === 'opportunity') {
        pauseGameClock(gs);
        emitToRoom(roomId, 'gamePaused', { reason: '人際關係決策', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });

        socket.emit('relationshipCardDrawn', { card: relCard, timeoutMs: 15000 });
        const relDecision = await waitForCardDecision(socket, 15000);

        // rel-004 擲骰賭注型：伺服器自動擲骰
        let diceResult: number | undefined;
        if (relCard.effect.gambleSuccess) {
          if (relDecision?.accept === false) {
            // 玩家選擇放棄
            resumeGameClock(gs);
            emitToRoom(roomId, 'gameResumed', { reason: '玩家放棄人際機遇' });
            emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: { type: 'relationshipDeclined', card: relCard } });
            break;
          }
          diceResult = Math.ceil(Math.random() * 6);
        }

        const _relCB = player.cash; const _relFB = player.monthlyCashflow; const _relNWB = calcNetWorth(player);
        const relResult = applyRelationshipCard(player, relCard, diceResult);

        // 薪資倍率暫時效果
        if (relResult.salaryMultiplier !== undefined && relResult.turnsAffected) {
          if (relDecision?.accept !== false) {
            player.travelPenaltyRemaining = Math.max(
              player.travelPenaltyRemaining,
              relResult.turnsAffected,
            );
            player.salary = Math.round(player.salary * relResult.salaryMultiplier);
          }
        }

        // 婚姻視窗觸發（rel-009 相親）
        if (relResult.triggerMarriageWindow && relDecision?.accept !== false) {
          resumeGameClock(gs);
          emitToRoom(roomId, 'gameResumed', { reason: '人際關係事件結束' });
          await triggerMarriageWindow(socket, player, gs);
        } else {
          resumeGameClock(gs);
          emitToRoom(roomId, 'gameResumed', { reason: '人際關係事件結束' });
        }

        // SmallDeal 額外抽牌（rel-002 同學會重聚）
        if (relResult.triggerSmallDeal && relDecision?.accept !== false) {
          const bonusDeal = SMALL_DEALS[Math.floor(Math.random() * SMALL_DEALS.length)];
          if (bonusDeal) {
            socket.emit('bonusSmallDeal', { card: bonusDeal, timeoutMs: 20000 });
          }
        }

        emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: { ...relResult, card: relCard } });
        logPlayerEvent(player, gs, 'relationship', `人際關係：${relCard.title}`, _relCB, _relFB, _relNWB, { cardId: relCard.id, cardTitle: relCard.title, category: relCard.eventCategory });

      } else {
        // ── 自動型（positive / negative）：直接套用並廣播 ──
        const _relCB = player.cash; const _relFB = player.monthlyCashflow; const _relNWB = calcNetWorth(player);
        const relResult = applyRelationshipCard(player, relCard);

        emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: { ...relResult, card: relCard } });
        logPlayerEvent(player, gs, 'relationship', `人際關係：${relCard.title}`, _relCB, _relFB, _relNWB, { cardId: relCard.id, cardTitle: relCard.title, category: relCard.eventCategory });
      }
      break;
    }

    default:
      break;
  }
}

// ============================================================
// 婚姻視窗觸發輔助函數
// ============================================================

async function triggerMarriageWindow(
  socket: Socket,
  player: Player,
  gs: GameState
): Promise<void> {
  if (player.isMarried) return;

  const roomId = gs.gameId;
  const currentAge = getCurrentAge(gs);
  const marriageWindow = LIFE_EVENT_WINDOWS.marriage;

  const inPeak = currentAge >= marriageWindow.peakStart && currentAge <= marriageWindow.peakEnd;
  const probability = inPeak ? marriageWindow.peakProbability : marriageWindow.baseProbability;

  if (Math.random() >= probability) return;

  const card = MARRIAGE_CARDS[Math.floor(Math.random() * MARRIAGE_CARDS.length)];

  pauseGameClock(gs);
  emitToRoom(roomId, 'gamePaused', { reason: '婚姻決策視窗', currentAge: Math.round(currentAge * 10) / 10 });

  socket.emit('marriageWindowOpened', {
    card,
    currentAge: Math.round(currentAge * 10) / 10,
    inPeakWindow: inPeak,
    timeoutMs: 30000,
  });

  const decision = await waitForCardDecision(socket, 30000);
  const acceptMarriage = decision?.acceptMarriage === true;

  resumeGameClock(gs);
  emitToRoom(roomId, 'gameResumed', { resumedAt: new Date(), currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });

  if (acceptMarriage) {
    const _wmCB = player.cash; const _wmFB = player.monthlyCashflow; const _wmNWB = calcNetWorth(player);
    player.isMarried = true;
    player.marriageBonus = card.monthlyBonus;
    addLifeExperience(player, card.lifeExpGain);
    logPlayerEvent(player, gs, 'marriage', `結婚（緣分），月收入加成 +$${card.monthlyBonus}`, _wmCB, _wmFB, _wmNWB, { marriageType: 'window', card: card.title, monthlyBonus: card.monthlyBonus });

    emitToRoom(roomId, 'playerMarried', {
      playerId: player.id,
      playerName: player.name,
      card,
      newMonthlyBonus: card.monthlyBonus,
      lifeExpGained: card.lifeExpGain,
    });
  } else {
    emitToRoom(roomId, 'marriageDeclined', {
      playerId: player.id,
      playerName: player.name,
    });
  }
}

// ============================================================
// 發薪日規劃選項計算輔助
// ============================================================

function buildAffordableOptions(player: Player): object {
  const {
    HP_MAINTENANCE_COST: maintCost,
    HP_BOOST_COST: boostCost,
    SKILL_TRAINING_COST: skillCost,
    NETWORK_INVEST_COST: ntCost,
  } = require('./gameConfig');

  const fqCost = getFQUpgradeCost(player.stats.financialIQ);

  return {
    fqUpgrade: {
      available: fqCost !== null && player.cash >= fqCost,
      cost: fqCost,
      currentFQ: player.stats.financialIQ,
      nextFQ: Math.min(10, player.stats.financialIQ + 1),
    },
    healthMaintenance: { available: player.cash >= maintCost, cost: maintCost },
    healthBoost: { available: player.cash >= boostCost, cost: boostCost },
    skillTraining: { available: player.cash >= skillCost, cost: skillCost, currentSK: player.stats.careerSkill },
    networkInvest: { available: player.cash >= ntCost && player.stats.network < 10, cost: ntCost, currentNT: player.stats.network },
  };
}

function buildAvailableProfessions(player: Player): object[] {
  return PROFESSIONS
    .filter((p) => p.id !== player.profession.id)
    .map((p) => ({ id: p.id, name: p.name, salary: p.startingSalary }));
}

// ============================================================
// 時鐘廣播與遊戲終局檢查（輪詢所有房間）
// ============================================================

/**
 * 每 5 秒輪詢所有進行中的房間：
 * - 廣播時鐘更新給該房間的玩家
 * - 檢查是否達到 100 歲觸發結算
 */
setInterval(() => {
  for (const [roomId, gs] of rooms) {
    if (!gs.gameStartTime) continue;
    if ((gs.gamePhase as string) === GamePhase.GameOver) continue;
    if (gs.pausedAt !== null) continue;

    const currentAge = getCurrentAge(gs);

    emitToRoom(roomId, 'gameClock', {
      currentAge: Math.round(currentAge * 10) / 10,
      currentStage: getLifeStage(currentAge),
      isPaused: false,
    });

    if (currentAge >= 100) {
      gs.gamePhase = GamePhase.GameOver;

      const finalScores = Array.from(gs.players.values()).map((p) => ({
        playerId: p.id,
        playerName: p.name,
        deathAge: Math.round(currentAge),
        score: calculateLifeScore(p, Math.round(currentAge)),
        isAlive: p.isAlive,
        profession: p.profession.name,
        quadrant: p.profession.quadrant,
      }));

      finalScores.sort((a, b) => b.score.total - a.score.total);

      console.log(`[gameEnded] 房間 ${roomId} 遊戲結束！`);
      finalScores.forEach((s, idx) => {
        console.log(`  ${idx + 1}. ${s.playerName}（${s.profession}）: ${s.score.total} 分`);
      });

      emitToRoom(roomId, 'gameEnded', {
        reason: 'timeUp',
        finalAge: Math.round(currentAge),
        finalScores,
      });

      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    }
  }
}, 5000);

// ============================================================
// 啟動伺服器
// ============================================================

httpServer.listen(PORT, () => {
  console.log(`====================================`);
  console.log(`  百歲人生伺服器已啟動`);
  console.log(`  監聽端口：${PORT}`);
  console.log(`  支援多房間並行場次`);
  console.log(`====================================`);
});
