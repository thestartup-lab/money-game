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
  getAvailableLoan,
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
  MARRIAGE_GIFT, MARRIAGE_GIFT_RANDOM_BONUS,
  CHILD_GIFT_BASE, CHILD_GIFT_RANDOM_BONUS,
  HP_ACTIVITY_THRESHOLDS,
  HOST_ACTIVATION_DRS_BONUS,
  CRISIS_FREQ_BY_STAGE,
  E_PROFESSION_POOLS, S_PROFESSION_POOLS, B_PROFESSION_POOLS, I_PROFESSION_POOLS,
  QUADRANT_SELECT_THRESHOLDS, FRANCHISE_CASH_THRESHOLD, PROFESSIONS,
  SECOND_LIFE_CELL,
  STOCK_DCA_MONTHLY_RETURN_RATE,
  STOCK_DCA_MONTHLY_DIVIDEND_RATE,
  SKILL_CAREER_CHANGE_THRESHOLD,
  getLoanLimit,
  getLoanRate,
} from './gameConfig';
import {
  MEDICAL_INSURANCE_PREMIUM,
  LIFE_INSURANCE_PREMIUM,
  PROPERTY_INSURANCE_PREMIUM,
  PER_CHILD_EXPENSE,
} from './gameConstants';
import { ADMIN_GLOBAL_EVENT_MAP } from './adminEvents';
import {
  applyPaydayPlan,
  executeCareerChange,
  getFQUpgradeCost,
  checkBedriddenStatus,
  applyHPChange,
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
  Deck,
  BIG_DEALS,
  DOODADS,
  MARKET_CARDS,
  LUCKY_CARDS,
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
  applyLuckyCard,
} from './cardSystem';
import {
  assignBucketList,
  evaluateBucketList,
  getBucketGoal,
} from './bucketList';

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

/**
 * 向當前玩家發送落地通知，並同時廣播給全房（供大螢幕顯示）。
 */
function emitCellEvent(
  socket: import('socket.io').Socket,
  roomId: string,
  playerName: string,
  cellName: string,
  message: string
): void {
  socket.emit('squareLandingNotice', { cellName, message });
  io.to(roomId).emit('cellEventBroadcast', {
    playerId: socket.id, playerName, cellName, message, ts: Date.now(),
  });
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
 * 「強制開始」時為未完成 Pre-20 的玩家自動補齊全部流程：
 *   1. 若沒投胎：隨機抽社會階層、套用 cash bonus 與 growth points
 *   2. 若沒分配成長點：依預設比例（學業 40% / 體能 30% / 社交 20% / 資源 10%）自動配
 *   3. 若沒選職業：隨機分配 E 象限職業，注入薪資與起始現金
 *
 * 此函數會直接修改 player 並 emit 通知，呼叫方僅需在最後一次 emit gameStateUpdate。
 */
function autoCompletePre20(player: Player, gs: GameState, roomId: string): void {
  // ---- 步驟 1：投胎（若還沒做）----
  // 判斷依據：growthPointsRemaining 為 0 表示還沒呼叫 rollSocialClass
  const hasRolled = player.growthPointsRemaining > 0
    || player.growthStats.academic + player.growthStats.health + player.growthStats.social + player.growthStats.resource > 0;
  if (!hasRolled) {
    const sc = rollSocialClass();
    const config = SOCIAL_CLASS_CONFIG[sc];
    player.socialClass = sc;
    player.growthPointsRemaining = config.growthPoints;
    player.cash += config.startingCashBonus;
    console.log(`[autoComplete] ${player.name} 自動投胎為「${config.label}」`);
  }

  // ---- 步驟 2：分配成長點（若還有剩）----
  if (player.growthPointsRemaining > 0) {
    const total = player.growthPointsRemaining;
    const academic = Math.floor(total * 0.40);
    const health = Math.floor(total * 0.30);
    const social = Math.floor(total * 0.20);
    const resource = total - academic - health - social;
    const cashBefore = player.cash;
    applyGrowthStats(player, { academic, health, social, resource });
    const resourceCashGain = player.cash - cashBefore;
    console.log(`[autoComplete] ${player.name} 自動配點：學業${academic}/體能${health}/社交${social}/資源${resource}`);
    if (resourceCashGain > 0) {
      console.log(`[autoComplete] ${player.name} 資源點轉現金 +$${resourceCashGain.toLocaleString()}`);
    }
  }

  // ---- 步驟 3：分配職業（若還沒選）----
  if (!player.pre20Done || player.profession.id === '__placeholder__') {
    const pool = [...E_PROFESSION_POOLS.basic];
    const randomId = pool[Math.floor(Math.random() * pool.length)];
    const chosen = PROFESSIONS.find((p) => p.id === randomId);
    if (chosen) {
      const previous = player.profession;
      if (previous && previous.id !== '__placeholder__') {
        player.cash -= previous.startingCash;
      }
      player.cash += chosen.startingCash;
      player.profession = chosen;
      player.salary = chosen.startingSalary;
      player.expenses.taxes = chosen.startingTaxes;
      player.expenses.homeMortgagePayment = chosen.startingHomeMortgage;
      player.expenses.carLoanPayment = chosen.startingCarLoan;
      player.expenses.creditCardPayment = chosen.startingCreditCard;
      player.expenses.otherExpenses = chosen.startingOtherExpenses;
      player.actionTokensThisPayday = chosen.hasFlexibleSchedule ? Infinity : 1;
      player.startAge = 22;
      player.pre20Done = true;
      console.log(`[autoComplete] ${player.name} 自動分配職業：${chosen.name}（E 象限）`);
    }
  }

  // 通知該玩家「已自動補齊」（前端會收到後跳轉到遊戲畫面）
  io.to(player.id).emit('autoCompleteApplied', {
    playerName: player.name,
    socialClass: player.socialClass,
    profession: { id: player.profession.id, name: player.profession.name, quadrant: player.profession.quadrant },
    growthStats: player.growthStats,
    cash: player.cash,
  });
  emitToRoom(roomId, 'playerReady', {
    playerId: player.id,
    playerName: player.name,
    professionName: player.profession.name,
    quadrant: player.profession.quadrant,
    allPlayersReady: [...gs.players.values()].every((p) => p.pre20Done),
  });
}

/**
 * 檢查玩家夢想清單，達成則 emit `bucketGoalAchieved`，全部達成額外發送 `bucketListAllDone`。
 * 在外圈玩家發生重要事件後呼叫（payday、charity、結婚、生子、買資產、FQ 升級…）。
 *
 * 注意：未進入外圈的玩家（bucketList 為空）不會觸發任何事件。
 */
function checkBucketGoals(
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
 * 在 payday 結算後呼叫（年齡會隨遊戲時鐘前進）。
 */
function checkLifeMilestones(
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
    age: Math.round(Math.max(player.startAge ?? 20, getCurrentAge(gs)) * 10) / 10,
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
 *
 * 第二個參數 gs 用來算 personalAge（顯示用個人年齡 = max(startAge, 全域時鐘)），
 * 讓所有前端讀同一個欄位即可，避免「進修玩家從 25 起算」與「全域時鐘 20」對不上。
 */
function serializePlayer(p: Player, gs: GameState): object {
  const personalAge = Math.round(Math.max(p.startAge ?? 20, getCurrentAge(gs)) * 10) / 10;

  // 計算保費與孩子支出（後端 Player.totalExpenses getter 內的細項，補給前端報表使用）
  const insurancePremiums =
    (p.insurance.hasMedicalInsurance ? MEDICAL_INSURANCE_PREMIUM : 0) +
    (p.insurance.hasLifeInsurance ? LIFE_INSURANCE_PREMIUM : 0) +
    (p.insurance.hasPropertyInsurance ? PROPERTY_INSURANCE_PREMIUM : 0);
  const childExpenses = p.numberOfChildren * PER_CHILD_EXPENSE;

  // 無擔保負債月付加總（與 Player.totalExpenses getter 同邏輯）
  const _securedIds = new Set(
    p.assets.map((a) => a.linkedLiabilityId).filter((id): id is string => Boolean(id))
  );
  const unsecuredLoanPayments = p.liabilities
    .filter((l) => !_securedIds.has(l.id))
    .reduce((sum, l) => sum + (l.monthlyPayment ?? 0), 0);

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
    expenses: { ...p.expenses, insurancePremiums, childExpenses, unsecuredLoanPayments },
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
    startAge: p.startAge ?? 20,
    personalAge,
    isMarried: p.isMarried,
    marriageBonus: p.marriageBonus,
    relationshipPoints: p.relationshipPoints,
    relationshipActive: p.relationshipActive,
    marriageType: p.marriageType,
    isBedridden: p.isBedridden,
    travelPenaltyRemaining: p.travelPenaltyRemaining,
    isInFastTrack: p.isInFastTrack,
    hasPassedSecondLife: p.hasPassedSecondLife,
    fastTrackPosition: p.fastTrackPosition,
    visitedDestinations: p.visitedDestinations ?? [],
    legacyBonusPoints: p.legacyBonusPoints ?? 0,
    skipFirstPayday: p.skipFirstPayday ?? false,
    isDisconnected: p.isDisconnected ?? false,
    pre20Done: p.pre20Done,
    actionTokensThisPayday: p.actionTokensThisPayday,
    hasFlexibleSchedule: p.profession.hasFlexibleSchedule,
    totalPassiveIncome: p.totalPassiveIncome,
    totalIncome: p.totalIncome,
    totalExpenses: p.totalExpenses,
    monthlyCashflow: p.monthlyCashflow,
    nextFQUpgradeCost: getFQUpgradeCost(p.stats.financialIQ),
    eventLog: p.eventLog,
    charityTotal: p.charityTotal ?? 0,
    bucketList: p.bucketList ?? [],
    milestonesPassed: p.milestonesPassed ?? { age40: false, age60: false, age80: false },
  };
}

function serializeGameState(gs: GameState): object {
  const currentAge = getCurrentAge(gs);
  const currentStage = getLifeStage(currentAge);
  return {
    gameId: gs.gameId,
    roomId: gs.gameId,
    players: Array.from(gs.players.values()).map((p) => serializePlayer(p, gs)),
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
  socket.on('createRoom', (payload: { password: string; roomId?: string }) => {
    if (payload?.password !== ADMIN_PASSWORD) {
      socket.emit('error', { message: '密碼錯誤，無法建立房間。' });
      return;
    }

    const customCode = payload.roomId?.trim().toUpperCase();
    if (customCode) {
      if (rooms.has(customCode)) {
        socket.emit('error', { message: `房間代碼「${customCode}」已存在，請換一個。` });
        return;
      }
      if (!/^[A-Z0-9]{4,6}$/.test(customCode)) {
        socket.emit('error', { message: '房間代碼只能包含英文字母與數字，長度 4–6 碼。' });
        return;
      }
    }
    const roomCode = customCode || generateRoomCode();
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
    // 立即推送初始遊戲狀態（WaitingForPlayers），讓後台能正確顯示開始按鈕
    socket.emit('gameStateUpdate', serializeGameState(gs));
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
    // 登入後立即推送當前遊戲狀態，讓後台能正確顯示開始按鈕
    socket.emit('gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 展示頁加入觀看 (joinDisplay) — 不需密碼，只讀取遊戲狀態
  // ----------------------------------------------------------
  socket.on('joinDisplay', (payload: { roomId: string }) => {
    const targetRoomId = payload?.roomId?.trim().toUpperCase();
    if (!targetRoomId) {
      socket.emit('joinDisplayFail', { message: '請輸入房間代碼。' });
      return;
    }
    const gs = rooms.get(targetRoomId);
    if (!gs) {
      socket.emit('joinDisplayFail', { message: `房間「${targetRoomId}」不存在，請確認代碼。` });
      return;
    }
    socket.join(targetRoomId);
    socketRoomMap.set(socket.id, targetRoomId);
    socket.emit('joinDisplaySuccess', { roomId: targetRoomId });
    socket.emit('gameStateUpdate', serializeGameState(gs));
    console.log(`[joinDisplay] 展示頁加入房間 ${targetRoomId}：${socket.id}`);
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
   * 若房間內已有同名玩家且處於斷線等待狀態，自動恢復該玩家資料。
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

      // ── 同名玩家重連恢復 ──────────────────────────────────────
      // 找房間內同名且斷線等待中的玩家
      let existingPlayer: Player | undefined;
      let existingSocketId: string | undefined;
      for (const [sid, p] of gs.players.entries()) {
        if (p.name === playerName) {
          if (p.isDisconnected) {
            // 斷線等待中 → 恢復資料
            existingPlayer = p;
            existingSocketId = sid;
          } else {
            // 同名玩家仍在線 → 拒絕加入
            socket.emit('error', { message: `「${playerName}」已在此房間中，請換個名字。` });
            return;
          }
          break;
        }
      }

      if (existingPlayer && existingSocketId) {
        // 將舊 socket id 的玩家資料移轉到新 socket id
        existingPlayer.id = socket.id;
        existingPlayer.isDisconnected = false;
        gs.players.delete(existingSocketId);
        gs.players.set(socket.id, existingPlayer);

        const orderIdx = gs.playerOrder.indexOf(existingSocketId);
        if (orderIdx !== -1) gs.playerOrder[orderIdx] = socket.id;
        if (gs.currentPlayerTurnId === existingSocketId) gs.currentPlayerTurnId = socket.id;

        socket.join(roomCode);
        socketRoomMap.set(socket.id, roomCode);

        console.log(`[playerJoin] ${playerName} 同名重連，恢復至房間 ${roomCode}`);
        socket.emit('rejoinSuccess', { playerId: socket.id });
        emitToRoom(roomCode, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // ── 全新玩家加入 ──────────────────────────────────────────
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

      try {
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
        }
        gs.advanceToNextTurn();
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
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
        gs.advanceToNextTurn();
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 2. 擲骰 & 移動（含 bonusDice 加成）---
      const baseDice = payload?.diceCount ?? 1;
      const diceCount = Math.min(3, baseDice + player.bonusDice) as 1 | 2 | 3;
      player.bonusDice = 0;

      // ⚠ 修正：以前 actualDiceCount = diceCount > 2 ? 2 : diceCount，
      //   慈善獎勵骰會把 base 2 + bonus 1 = 3 capped 回 2，導致第三顆骰直接消失。
      //   現在最多支援到 3 顆骰子（前端 DiceRollOverlay 也已支援）。
      const actualDiceCount = diceCount;
      const diceFaces: number[] = [];
      for (let i = 0; i < actualDiceCount; i++) {
        diceFaces.push(Math.floor(Math.random() * 6) + 1);
      }
      const rolled = diceFaces.reduce((a, b) => a + b, 0);
      // 內外圈使用不同位置欄位；先把移動前的位置記下，再呼叫 movePlayer
      const wasInFastTrack = player.isInFastTrack;
      const oldPos = wasInFastTrack ? player.fastTrackPosition : player.currentPosition;
      const { passedPaydays, requiresPaydayPlanning } = movePlayer(player, rolled);
      const newPos = wasInFastTrack ? player.fastTrackPosition : player.currentPosition;

      console.log(
        `[playerRoll] ${player.name}（${roomId}）擲出 ${rolled}（${diceFaces.join('+')}），` +
          `移動至${wasInFastTrack ? '外圈' : '內圈'}位置 ${newPos}，` +
          `路過發薪日：${passedPaydays.length > 0 ? passedPaydays.join(', ') : '無'}`
      );

      socket.emit('rollResult', {
        diceCount,
        rolled,
        newPosition: newPos,
        passedPaydays,
        isInFastTrack: wasInFastTrack,
      });

      // 廣播給整個房間（含 DisplayScreen），讓大螢幕播放骰子動畫
      const playerColorIndex = gs.playerOrder.indexOf(player.id);
      emitToRoom(roomId, 'playerRolled', {
        playerId: player.id,
        playerName: player.name,
        colorIndex: (playerColorIndex >= 0 ? playerColorIndex : 0) % 6,
        dice: diceFaces,
        total: rolled,
        oldPosition: oldPos,
        newPosition: newPos,
        isInFastTrack: wasInFastTrack,
      });

      // --- 3–4. 每個發薪日：暫停時鐘 → 全員規劃 → 發薪 → 繳稅 ---
      if (requiresPaydayPlanning) {
        for (const [paydayIdx, paydayPos] of passedPaydays.entries()) {
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

          // 取出符合玩家當前圈別與 HP 門檻的旅遊目的地，提供給發薪日表單顯示
          const { TRAVEL_DESTINATIONS } = require('./gameConfig');
          const eligibleDestinations = (TRAVEL_DESTINATIONS as Array<{
            id: string; name: string; region: string; tier: 'inner' | 'outer' | 'both';
            cost: number; lifeExpGained: number; salaryPenalty: number;
          }>)
            .filter((d) => {
              if (d.tier === 'both') return true;
              if (d.tier === 'inner') return !player.isInFastTrack;
              if (d.tier === 'outer') return player.isInFastTrack;
              return false;
            })
            .filter((d) => player.stats.health >= HP_ACTIVITY_THRESHOLDS.travel)
            .map((d) => ({
              id: d.id, name: d.name, region: d.region,
              cost: d.cost, lifeExpGained: d.lifeExpGained, salaryPenalty: d.salaryPenalty,
            }));

          // 股市內幕：FQ 達門檻者可預知下一張 MarketCard，提前布局
          const { FQ_INSIDER_THRESHOLD } = require('./gameConstants') as typeof import('./gameConstants');
          const marketTip =
            player.stats.financialIQ >= FQ_INSIDER_THRESHOLD
              ? (() => {
                  const next = gs.marketDeck.peek();
                  return next
                    ? {
                        title: next.title,
                        description: next.description,
                        targetAssetType: next.targetAssetType,
                        effect: next.effect,
                        priceMultiplier: next.priceMultiplier,
                        dividendRate: next.dividendRate,
                        fixedPriceOffer: next.fixedPriceOffer,
                      }
                    : null;
                })()
              : null;

          socket.emit('paydayPlanningRequired', {
            paydayPosition: paydayPos,
            paydayIndex: paydayIdx + 1,
            totalPaydays: passedPaydays.length,
            currentStats: player.stats,
            currentCash: player.cash,
            affordableOptions,
            currentInsurance: player.insurance,
            stockDCAPortfolioValue: player.assets.find((a) => a.id === 'stock-dca')?.currentValue ?? 0,
            travelDestinations: eligibleDestinations,
            timeoutMs: PAYDAY_PLANNING_TIMEOUT_MS,
            marketTip,
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

          if (player.stats.careerSkill >= SKILL_CAREER_CHANGE_THRESHOLD) {
            socket.emit('careerChangeUnlocked', {
              message: '恭喜！你的第二專長已達到頂峰，可以轉職了！',
              availableProfessions: buildAvailableProfessions(player),
            });
            if (planResult.careerChangeUnlocked) {
              emitToRoom(roomId, 'milestoneAnnounced', {
                playerId: player.id,
                playerName: player.name,
                milestone: '轉職解鎖',
                description: `${player.name} 的技能值達到頂峰，可以轉職了！`,
              });
            }
          }

          // NT 里程碑廣播
          const NT_LABELS: Record<number, string> = {
            3: '人脈護盾解鎖 — 危機時可豁免一次！',
            5: '交易加持解鎖 — 落地交易格可抽 2 張牌！',
            8: '人脈大師 — 達成成就！',
          };
          for (const nt of planResult.ntMilestonesUnlocked ?? []) {
            const desc = `${player.name} 人脈值達到 ${nt}！${NT_LABELS[nt] ?? ''}`;
            emitCellEvent(socket, roomId, player.name, `NT ${nt} 達成`, `🌐 ${NT_LABELS[nt] ?? ''}`);
            emitToRoom(roomId, 'milestoneAnnounced', {
              playerId: player.id,
              playerName: player.name,
              milestone: `NT ${nt}`,
              description: desc,
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
            continue;  // 跳過本次發薪日其餘處理，但繼續執行後續流程（advanceToNextTurn 等）
          }

          // 股票定期定額：發薪日「先算股息（進入 totalIncome）」→ payday 結算 → 後算增值
          // 設計：dcaAsset.monthlyCashflow = currentValue × dividendRate，
          //       triggerPayday 會把它與其他被動收入一起套 FQ 乘數加進現金。
          //       增值部分仍只反映在 currentValue 上（賣出才兌現）。
          // 修正歷史 bug：之前 monthlyCashflow=0 導致股票對 totalPassiveIncome 沒貢獻。
          const dcaAsset = player.assets.find((a) => a.id === 'stock-dca');
          let dcaDividend = 0;
          if (dcaAsset) {
            const valueBeforeGrowth = dcaAsset.currentValue ?? dcaAsset.cost;
            dcaDividend = Math.round(valueBeforeGrowth * STOCK_DCA_MONTHLY_DIVIDEND_RATE);
            dcaAsset.monthlyCashflow = dcaDividend;
          }

          triggerPayday(player, gs, maintenanceDone);
          logPlayerEvent(player, gs, 'payday', `發薪日（第 ${player.paydayCount} 次）`, _pdCashBefore, _pdFlowBefore, _pdNWBefore);

          // 增值部分（不影響現金，只動 currentValue）
          if (dcaAsset) {
            const prevVal = dcaAsset.currentValue ?? dcaAsset.cost;
            dcaAsset.currentValue = Math.round(prevVal * (1 + STOCK_DCA_MONTHLY_RETURN_RATE));
            const growth = dcaAsset.currentValue - prevVal;
            if (growth > 0 || dcaDividend > 0) {
              emitCellEvent(socket, roomId, player.name, '股票收益',
                `📈 指數基金股息 +$${dcaDividend.toLocaleString()}／增值 +$${growth.toLocaleString()}（市值 $${dcaAsset.currentValue.toLocaleString()}）`);
            }
          }

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

      // ⚠ 玩家可能在 handleLandingSquare 中因危機/疾病死亡，
      //   後續 FastTrack 解鎖、增值、advanceToNextTurn 邏輯需要 isAlive 守衛
      if (!player.isAlive) {
        gs.advanceToNextTurn();
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 5b. 老鼠賽跑脫出檢查 ---
      // 偵測本次移動是否路過「第二人生」格（cell 24）
      if (!player.isInFastTrack && !player.hasPassedSecondLife) {
        const newPos = player.currentPosition;
        const c = SECOND_LIFE_CELL;
        const crossedCell24 = newPos < oldPos
          ? c > oldPos || c <= newPos   // 繞圈
          : c > oldPos && c <= newPos;  // 直線
        if (crossedCell24) {
          player.hasPassedSecondLife = true;
          emitToRoom(roomId, 'secondLifeReached', { playerId: player.id, playerName: player.name });
          console.log(`[secondLife] ${player.name}（${roomId}）首次路過第二人生格，解鎖 FastTrack 進入資格`);
        }
      }

      if (!player.isInFastTrack && player.hasPassedSecondLife && checkRatRaceEscape(player)) {
        console.log(`[ratRace] ${player.name}（${roomId}）脫出老鼠賽跑！`);
        const _rrCB = player.cash; const _rrFB = player.monthlyCashflow; const _rrNWB = calcNetWorth(player);
        player.isInFastTrack = true;
        gs.gamePhase = GamePhase.FastTrack;
        addLifeExperience(player, LIFE_EXP.FAST_TRACK_ENTER);

        // B1：進入外圈時隨機抽 3 個人生夢想目標
        assignBucketList(player, 3);
        const goalDetails = player.bucketList
          .map((e) => getBucketGoal(e.id))
          .filter((g): g is NonNullable<typeof g> => !!g)
          .map((g) => ({
            id: g.id,
            emoji: g.emoji,
            title: g.title,
            description: g.description,
            legacyReward: g.legacyReward,
            lifeExpReward: g.lifeExpReward,
            cashReward: g.cashReward ?? 0,
          }));

        logPlayerEvent(player, gs, 'rat_race_escaped', `脫出老鼠賽跑！被動收入 $${player.totalPassiveIncome.toLocaleString()} ≥ 支出 $${player.totalExpenses.toLocaleString()}`, _rrCB, _rrFB, _rrNWB, { passiveIncome: player.totalPassiveIncome, totalExpenses: player.totalExpenses });
        emitToRoom(roomId, 'ratRaceEscaped', {
          playerId: player.id,
          playerName: player.name,
          monthlyPassiveIncome: player.totalPassiveIncome,
          totalExpenses: player.totalExpenses,
          lifeExpGained: LIFE_EXP.FAST_TRACK_ENTER,
          canCongratulate: true,   // 前端可顯示祝賀按鈕
          bucketList: goalDetails,
        });
        socket.emit('bucketListAssigned', { goals: goalDetails });

        // 立刻檢查一次：高被動收入、長壽等可能在進外圈當下就達成
        checkBucketGoals(player, gs, roomId, socket);
      }

      // --- 5c. FastTrack 資產增值 ---
      // 注意：FT 資產增值由「踩到外圈發薪格」時於 handleLandingSquare 觸發
      // （applyFastTrackAppreciation 註解：每個 triggerPayday 後呼叫）。
      // 過去這裡也呼叫一次，造成同一回合重複增值；已移除。

      // --- 5d. B2 人生里程碑 + B1 夢想清單檢查 ---
      // 每次擲骰結束後（含 payday、落格、FastTrack 進入），檢查當前玩家：
      //   1. 跨越 40/60/80 歲是否觸發里程碑事件
      //   2. 任何夢想目標是否達成（外圈玩家才有 bucketList）
      if (player.isAlive) {
        checkLifeMilestones(player, gs, roomId, socket);
        checkBucketGoals(player, gs, roomId, socket);
      }

      // --- 6. 廣播最終遊戲狀態 & 推進回合 ---
      gs.advanceToNextTurn();
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    } catch (err) {
      console.error(`[playerRoll] 未預期錯誤：`, err);
      socket.emit('error', { message: '擲骰處理時發生錯誤，請重新整理頁面。' });
      // 發送一個空的 rollResult 讓前端解除 rollingLocked
      socket.emit('rollResult', { diceCount: 1, rolled: 0, newPosition: -1, passedPaydays: [] });
      // 不強制 advanceToNextTurn —— 此時玩家可能已移動但發薪流程未完成，
      // 強制換回合會讓狀態與下家流程錯亂；交給管理員手動干預（或玩家重新整理）。
      try {
        const gs2 = getRoomState(socket);
        if (gs2) emitToRoom(gs2.gameId, 'gameStateUpdate', serializeGameState(gs2));
      } catch (_) { /* ignore */ }
    }
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

    const INSURANCE_LABEL: Record<string, string> = { medical: '醫療險', life: '壽險', property: '財產險' };
    emitCellEvent(socket, gs.gameId, player.name, '購買保險',
      `${player.name} 購買了 ${INSURANCE_LABEL[payload.insuranceType] ?? payload.insuranceType}`);

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
  // 股票定期定額投資 (investStockDCA)
  // ----------------------------------------------------------
  socket.on('investStockDCA', (payload: { amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(socket.id);
    if (!player || !player.isAlive) {
      socket.emit('error', { message: '玩家不存在或已出局。' });
      return;
    }

    const amount = payload.amount ?? 0;
    if (amount <= 0) { socket.emit('error', { message: '投資金額必須大於 0。' }); return; }
    if (player.cash < amount) { socket.emit('error', { message: '現金不足，無法投資。' }); return; }

    player.cash -= amount;
    const existing = player.assets.find((a) => a.id === 'stock-dca');
    if (existing) {
      existing.cost += amount;
      existing.currentValue = (existing.currentValue ?? existing.cost) + amount;
    } else {
      player.assets.push({
        id: 'stock-dca',
        name: '指數股票基金（定期定額）',
        type: 'Stock' as import('./gameConstants').AssetType,
        cost: amount,
        currentValue: amount,
        monthlyCashflow: 0,
      });
    }
    const updated = player.assets.find((a) => a.id === 'stock-dca');
    socket.emit('stockDCAResult', {
      amount,
      newPortfolioValue: updated?.currentValue ?? amount,
      remainingCash: player.cash,
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
  socket.on('triggerGlobalEvent', (payload: { eventId: string; roomId?: string }) => {
    const gs = (payload.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      // 允許同一密碼管理員（已用 roomId 查到房間）重新綁定
      if (payload.roomId && gs.adminSocketId) {
        // 以 roomId 方式觸發時，更新 adminSocketId 並繼續
        gs.adminSocketId = socket.id;
        socketRoomMap.set(socket.id, roomId);
        socket.join(roomId);
      } else {
        socket.emit('error', { message: '權限不足：僅管理員可觸發全局事件。' });
        return;
      }
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
  // 觸發特殊拍賣 (triggerSpecialAuction) — 主持人專用
  // 從 SPECIAL_AUCTION_DEALS 牌組隨機抽 1 張，廣播給所有玩家進入 30 秒競標。
  // 起標金額 = downPayment ?? cost；得標者扣現金後該資產直接寫入持有，
  // 起標金額會以「無主來源」（沒有原持有者）銷毀，等同新發行的特殊資產。
  // ----------------------------------------------------------
  socket.on('triggerSpecialAuction', (payload: { roomId?: string; cardId?: string }) => {
    const gs = (payload?.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      if (payload?.roomId && gs.adminSocketId) {
        gs.adminSocketId = socket.id;
        socketRoomMap.set(socket.id, roomId);
        socket.join(roomId);
      } else {
        socket.emit('error', { message: '權限不足：僅管理員可觸發特殊拍賣。' });
        return;
      }
    }

    const { SPECIAL_AUCTION_DEALS } = require('./gameCards') as typeof import('./gameCards');
    const pool: DealCard[] = SPECIAL_AUCTION_DEALS;
    const auctionCard = payload?.cardId
      ? (pool.find((c) => c.id === payload.cardId) ?? pool[Math.floor(Math.random() * pool.length)])
      : pool[Math.floor(Math.random() * pool.length)];

    if (!auctionCard) {
      socket.emit('error', { message: '特殊拍賣牌組已空。' });
      return;
    }

    if (!gs.activeAuctions) gs.activeAuctions = {};
    const minBid = auctionCard.asset.downPayment ?? auctionCard.asset.cost ?? 0;
    const auctionId = `special-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const durationMs = 30_000;
    const auctionEndTime = Date.now() + durationMs;

    gs.activeAuctions[auctionId] = {
      dealCardId: auctionCard.id,
      startTime: Date.now(),
      endTime: auctionEndTime,
      highestBid: 0,
      minBid,
      // 特殊拍賣沒有「原持有者」（資產由銀行/市場新發行），triggeredBy 設為主持人
      triggeredBy: '__admin__',
      triggeredByName: '主持人',
      cardInfo: {
        name: auctionCard.title,
        monthlyCashflow: auctionCard.asset.monthlyCashflow ?? 0,
        downPayment: minBid,
      },
    };

    emitToRoom(roomId, 'dealAuctionStarted', {
      auctionId,
      triggeredBy: '__admin__',
      triggeredByName: '主持人',
      isSpecialAuction: true,
      card: {
        id: auctionCard.id,
        name: auctionCard.title,
        description: auctionCard.description,
        minBid,
        monthlyCashflow: auctionCard.asset.monthlyCashflow,
      },
      endsAt: auctionEndTime,
    });

    setTimeout(() => {
      const auction = gs.activeAuctions?.[auctionId];
      if (!auction) return;
      delete gs.activeAuctions![auctionId];

      if (auction.highestBidderId && auction.highestBid >= minBid) {
        const winner = gs.players.get(auction.highestBidderId);
        if (winner && winner.cash >= auction.highestBid) {
          const _wCB = winner.cash; const _wFB = winner.monthlyCashflow; const _wNWB = calcNetWorth(winner);
          winner.cash -= auction.highestBid;
          // 特殊拍賣：得標金額蒸發（市場新發行），不轉給任何玩家
          acceptDealCard(winner, auctionCard);
          logPlayerEvent(
            winner, gs, 'asset_buy',
            `特殊拍賣得標：${auctionCard.title}（月現金流 ${(auctionCard.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${auctionCard.asset.monthlyCashflow ?? 0}）`,
            _wCB, _wFB, _wNWB,
            { cardId: auctionCard.id, cardTitle: auctionCard.title, isSpecialAuction: true }
          );
          emitToRoom(roomId, 'dealAuctionEnded', {
            auctionId,
            winnerId: auction.highestBidderId,
            winnerName: auction.highestBidderName,
            winningBid: auction.highestBid,
            cardName: auctionCard.title,
            hadBids: true,
            isSpecialAuction: true,
          });
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        }
      } else {
        emitToRoom(roomId, 'dealAuctionEnded', {
          auctionId, winnerId: null, winnerName: null,
          winningBid: 0, cardName: auctionCard.title, hadBids: false,
          isSpecialAuction: true,
        });
      }
    }, durationMs);
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

    const _gsCashBefore = player.cash;
    applyGrowthStats(player, { academic, health, social, resource });
    const resourceCashGain = player.cash - _gsCashBefore;

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
      resourceCashGain,
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

  socket.on('selectQuadrant', (payload: { quadrant: 'E' | 'S' | 'B' | 'I' }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(socket.id);
    if (!player) { socket.emit('error', { message: '玩家不存在。' }); return; }

    const { quadrant } = payload;
    const hasEdu = player.hasContinuedEducation;

    // B / I 象限門檻檢查
    if (quadrant === 'B' || quadrant === 'I') {
      const t = QUADRANT_SELECT_THRESHOLDS[quadrant];
      if (
        player.growthStats.academic < t.academicMin ||
        player.growthStats.resource < t.resourceMin
      ) {
        socket.emit('error', {
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
      socket.emit('error', { message: '職業分配失敗，請重試。' });
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
    player.expenses.homeMortgagePayment = chosen.startingHomeMortgage;
    player.expenses.carLoanPayment = chosen.startingCarLoan;
    player.expenses.creditCardPayment = chosen.startingCreditCard;
    player.expenses.otherExpenses = chosen.startingOtherExpenses;
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

    // ⚠ 實際扣除加盟金（先前的 bug：只檢查門檻不扣錢）
    const _bfCB = player.cash;
    const _bfFB = player.monthlyCashflow;
    player.cash -= FRANCHISE_CASH_THRESHOLD;

    player.profession = franchise;
    player.salary = franchise.startingSalary;
    player.expenses.otherExpenses = franchise.startingOtherExpenses;
    player.actionTokensThisPayday = Infinity;

    // 注入加盟店資產與負債（含 linkedLiabilityId 連結，與 createPlayer 一致）
    if (franchise.startingAssets) {
      franchise.startingAssets.forEach((tmpl, idx) => {
        const ts = Date.now();
        const assetId = `franchise-${player.id}-${ts}-${idx}`;
        const liabilityId = tmpl.liabilityAmount
          ? `franchise-loan-${player.id}-${ts}-${idx}`
          : undefined;

        player.assets.push({
          id: assetId,
          name: tmpl.name,
          type: tmpl.type,
          cost: tmpl.cost,
          currentValue: tmpl.currentValue ?? tmpl.cost,
          monthlyCashflow: tmpl.monthlyCashflow,
          linkedLiabilityId: liabilityId,
        });

        if (tmpl.liabilityAmount && liabilityId) {
          player.liabilities.push({
            id: liabilityId,
            name: tmpl.liabilityName ?? `${tmpl.name}貸款`,
            totalDebt: tmpl.liabilityAmount,
            monthlyPayment: tmpl.liabilityMonthlyPayment ?? Math.round(tmpl.liabilityAmount * 0.005),
          });
          // ⚠ 不要再把 liabilityMonthlyPayment 加進 homeMortgagePayment：
          //   負債月付會由 totalExpenses getter 自動加總（見 fix-5），且資產的
          //   monthlyCashflow 在資料設計上「已扣除貸款月付的淨額」，
          //   再加入支出會造成雙重扣除。
        }
      });
    }

    logPlayerEvent(player, gs, 'franchise', `轉職加盟主（支付 $${FRANCHISE_CASH_THRESHOLD.toLocaleString()} 加盟金）`,
      _bfCB, _bfFB, 0, {});

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

    // A1：合作分紅 — 雙方被動收入總和 × 3% 一次性現金（最低 $3,000、最高 $50,000）
    const passiveSum = offeror.totalPassiveIncome + target.totalPassiveIncome;
    const dividend = Math.max(3_000, Math.min(50_000, Math.round(passiveSum * 0.03)));
    offeror.cash += dividend;
    target.cash += dividend;
    logPlayerEvent(
      offeror, gs, 'asset_buy',
      `🤝 與 ${target.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
      offeror.cash - dividend, offeror.monthlyCashflow, calcNetWorth(offeror) - dividend,
      { partnerId: target.id, partnerName: target.name, dividend }
    );
    logPlayerEvent(
      target, gs, 'asset_buy',
      `🤝 與 ${offeror.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
      target.cash - dividend, target.monthlyCashflow, calcNetWorth(target) - dividend,
      { partnerId: offeror.id, partnerName: offeror.name, dividend }
    );

    emitToRoom(roomId, 'partnershipAccepted', {
      offerorId: offer.offerorId, offerorName: offeror.name,
      targetId: socket.id,        targetName: target.name,
      dividend,
      passiveSum,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[partnership] ${offeror.name} 與 ${target.name} 合夥成功，分紅 $${dividend}`);
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

    // ⚠ 安全性：只有「指定的借款人」可以接受／拒絕這筆 offer
    if (socket.id !== offer.borrowerId) {
      socket.emit('error', { message: '此借貸邀請不是給你的，無權回應。' });
      return;
    }

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
    // ⚠ 不再寫入 otherExpenses（會被無擔保負債月付自動加進 totalExpenses）。
    // 過去這樣寫會導致還清後 otherExpenses 殘留幽靈月息。

    emitToRoom(roomId, 'loanAccepted', {
      loanId, lenderId: offer.lenderId, lenderName: lender.name,
      borrowerId: socket.id, borrowerName: borrower.name,
      amount: offer.amount, monthlyRate: offer.monthlyRate, monthlyInterest,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[p2ploan] ${lender.name} 借款 $${offer.amount} 給 ${borrower.name}（月息 $${monthlyInterest}）`);
  });

  // ----------------------------------------------------------
  // P2P 借貸：「主動請求借款」（loanRequest / loanRequestResponse）
  // 借款人發起 → 指定的貸款方可以接受/拒絕
  // ----------------------------------------------------------
  socket.on('loanRequest', (payload: { targetPlayerId: string; amount: number; monthlyRate: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const borrower = gs.players.get(socket.id);
    const lender = gs.players.get(payload.targetPlayerId);
    if (!borrower || !lender) { socket.emit('error', { message: '玩家不存在。' }); return; }
    if (!lender.isAlive) { socket.emit('error', { message: '對方已出局。' }); return; }
    if (borrower.id === lender.id) { socket.emit('error', { message: '不能向自己借款。' }); return; }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      socket.emit('error', { message: '借款金額必須為正數。' }); return;
    }
    if (payload.monthlyRate < 0 || payload.monthlyRate > 0.1) {
      socket.emit('error', { message: '月利率需在 0–10% 之間。' }); return;
    }
    // 借款人現有無擔保負債 + 此次借款不可超過信用上限
    const _existingUnsecured = (() => {
      const securedIds = new Set(
        borrower.assets.map((a) => a.linkedLiabilityId).filter((id): id is string => Boolean(id))
      );
      return borrower.liabilities.filter((l) => !securedIds.has(l.id))
        .reduce((s, l) => s + l.totalDebt, 0);
    })();
    const { getLoanLimit } = require('./gameConfig');
    const maxLoan = getLoanLimit(borrower.creditScore);
    if (_existingUnsecured + payload.amount > maxLoan) {
      socket.emit('error', {
        message: `超過你的借款上限 $${maxLoan.toLocaleString()}（已用 $${_existingUnsecured.toLocaleString()}）。`,
      });
      return;
    }

    const requestId = `lr-${Date.now()}`;
    if (!gs.pendingLoanRequests) gs.pendingLoanRequests = {};
    gs.pendingLoanRequests[requestId] = {
      borrowerId: socket.id, lenderId: payload.targetPlayerId,
      amount: payload.amount, monthlyRate: payload.monthlyRate, createdAt: Date.now(),
    };

    emitToRoom(roomId, 'loanRequestReceived', {
      requestId,
      borrowerId: socket.id, borrowerName: borrower.name,
      lenderId: payload.targetPlayerId, lenderName: lender.name,
      amount: payload.amount, monthlyRate: payload.monthlyRate,
    });
    console.log(`[loanRequest] ${borrower.name} 請求 ${lender.name} 借款 $${payload.amount}（月利率 ${(payload.monthlyRate * 100).toFixed(2)}%）`);
  });

  socket.on('loanRequestResponse', (payload: { requestId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const req = gs.pendingLoanRequests?.[payload.requestId];
    if (!req) { socket.emit('error', { message: '借款請求已過期。' }); return; }

    // 安全性：只有「指定的貸款方」可以接受／拒絕
    if (socket.id !== req.lenderId) {
      socket.emit('error', { message: '此借款請求不是給你的，無權回應。' });
      return;
    }

    const lender = gs.players.get(socket.id);
    const borrower = gs.players.get(req.borrowerId);
    if (!lender || !borrower) return;

    delete gs.pendingLoanRequests![payload.requestId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'loanRequestDeclined', {
        requestId: payload.requestId,
        borrowerId: req.borrowerId,
        lenderId: socket.id,
      });
      return;
    }

    if (lender.cash < req.amount) {
      socket.emit('error', { message: '你的現金已不足以提供此筆借款。' });
      return;
    }

    // 資金轉移
    lender.cash -= req.amount;
    borrower.cash += req.amount;

    const loanId = `p2p-${Date.now()}`;
    const monthlyInterest = Math.round(req.amount * req.monthlyRate);

    lender.assets.push({
      id: loanId,
      name: `借出給 ${borrower.name}`,
      type: 'Business' as import('./gameConstants').AssetType,
      cost: req.amount,
      currentValue: req.amount,
      monthlyCashflow: monthlyInterest,
    });

    borrower.liabilities.push({
      id: loanId,
      name: `向 ${lender.name} 借款`,
      totalDebt: req.amount,
      monthlyPayment: monthlyInterest,
    });

    emitToRoom(roomId, 'loanAccepted', {
      loanId,
      lenderId: socket.id, lenderName: lender.name,
      borrowerId: req.borrowerId, borrowerName: borrower.name,
      amount: req.amount, monthlyRate: req.monthlyRate, monthlyInterest,
      initiatedBy: 'borrower',
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[loanRequestAccepted] ${lender.name} 同意借款 $${req.amount} 給 ${borrower.name}（月息 $${monthlyInterest}）`);
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
    if (payload.bidAmount < (auction.minBid ?? 0)) { socket.emit('error', { message: `出價不得低於起標金額 $${(auction.minBid ?? 0).toLocaleString()}。` }); return; }
    if (payload.bidAmount <= (auction.highestBid ?? 0)) { socket.emit('error', { message: '出價需高於目前最高標。' }); return; }

    auction.highestBid = payload.bidAmount;
    auction.highestBidderId = socket.id;
    auction.highestBidderName = bidder.name;

    emitToRoom(roomId, 'dealBidUpdated', {
      auctionId: payload.auctionId, bidderId: socket.id, bidderName: bidder.name,
      bidAmount: payload.bidAmount, newHighest: payload.bidAmount,
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
    if (!sender.isAlive) { socket.emit('error', { message: '已出局玩家無法送祝賀。' }); return; }
    if (!target.isAlive) { socket.emit('error', { message: '對方已離世，無法送上祝賀。' }); return; }
    const CONGRATS_AMOUNT = 7_500;
    if (sender.cash < CONGRATS_AMOUNT) { socket.emit('error', { message: `現金不足（需 $${CONGRATS_AMOUNT.toLocaleString()}）。` }); return; }

    sender.cash -= CONGRATS_AMOUNT;
    target.cash += CONGRATS_AMOUNT;
    target.stats.network = Math.min(target.profession.salaryType === 'nt_driven' ? Infinity : 10, target.stats.network + 0.2);

    emitToRoom(roomId, 'congratulationSent', {
      senderId: socket.id, senderName: sender.name,
      targetId: payload.targetPlayerId, targetName: target.name,
      event: payload.event, amount: CONGRATS_AMOUNT,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 時鐘控制事件（主持人專用）
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // 主持人踢出玩家 (kickPlayer) — 主要用於清除卡在設定階段或長期斷線的玩家
  // ----------------------------------------------------------
  socket.on('kickPlayer', (payload: { playerId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以踢出玩家。' });
      return;
    }

    const target = gs.players.get(payload.playerId);
    if (!target) {
      socket.emit('error', { message: '找不到該玩家。' });
      return;
    }

    const wasCurrentTurn = gs.currentPlayerTurnId === payload.playerId;
    gs.removePlayer(payload.playerId);
    if (wasCurrentTurn && gs.playerOrder.length > 0) {
      gs.advanceToNextTurn();
    }

    console.log(`[kickPlayer] 主持人移除玩家 ${target.name}（${roomId}）`);
    emitToRoom(roomId, 'playerKicked', { playerId: payload.playerId, playerName: target.name });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  socket.on('startGame', (payload?: { durationMinutes?: number; force?: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以啟動遊戲。' });
      return;
    }

    // pre20Done 為硬性條件：任何在線玩家未完成職業選擇都不允許開始
    // （斷線中的玩家不擋，他們重連會自動恢復）
    // force=true 時主持人選擇「強制開始」：為未完成 Pre-20 的玩家自動補齊
    //   1. 隨機投胎社會階層（套用 cash bonus 與 growth points）
    //   2. 自動分配成長點（學業/體能/社交/資源 平均分配）
    //   3. 隨機 E 象限職業
    // 注意：與舊版 force 不同，這裡會把玩家正常推進到「真正的職業」而非 placeholder。
    const notReady = [...gs.players.values()].filter((p) => !p.pre20Done && !p.isDisconnected);
    if (notReady.length > 0) {
      if (!payload?.force) {
        const names = notReady.map((p) => p.name).join('、');
        socket.emit('error', {
          message: `以下玩家尚未完成職業選擇：${names}。可請他們完成或按「強制開始」由系統自動分配。`,
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
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
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
  // 重啟遊戲 (restartGame) — 主持人專用
  // ----------------------------------------------------------
  /**
   * 將遊戲重置到 Pre20 階段，所有玩家回到重新投胎狀態。
   * 保留同一房間內的玩家名單（socket ID 與姓名），讓大家重新分配成長點數、選職業。
   */
  socket.on('restartGame', () => {
    const gs = getRoomState(socket);
    if (!gs) { socket.emit('error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (socket.id !== gs.adminSocketId) {
      socket.emit('error', { message: '只有管理員可以重啟遊戲。' });
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
      const freshPlayer = createPlayer(id, name);
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
    gs.activeAuctions = {};

    // 重置牌組
    gs.smallDealDeck = new Deck(SMALL_DEALS);
    gs.bigDealDeck   = new Deck(BIG_DEALS);
    gs.doodadDeck    = new Deck(DOODADS);
    gs.crisisDeck    = new Deck(CRISIS_EVENTS);
    gs.marketDeck    = new Deck(MARKET_CARDS);

    console.log(`[restartGame] 房間 ${roomId} 重啟，${playerInfos.length} 位玩家回到投胎`);

    emitToRoom(roomId, 'gameRestarted', { roomId, playerCount: playerInfos.length });
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
      // 結婚禮金（一次性現金入帳）
      const giftBase = MARRIAGE_GIFT[type] ?? 0;
      const giftRandom = giftBase > 0 ? Math.round(Math.random() * MARRIAGE_GIFT_RANDOM_BONUS) : 0;
      const marriageGift = giftBase + giftRandom;
      if (marriageGift > 0) player.cash += marriageGift;
      logPlayerEvent(player, gs, 'marriage', `結婚（${type === 'love' ? '愛情' : '媒人'}），月收入加成 +$${result.marriageBonus}，禮金 +$${marriageGift.toLocaleString()}`, _mCB, _mFB, _mNWB, { marriageType: type, marriageBonus: result.marriageBonus, lifeExpGained: result.lifeExpGained, marriageGift });
      emitToRoom(gs.gameId, 'marriageAnnouncement', {
        playerId: player.id,
        playerName: player.name,
        marriageType: type,
        marriageBonus: result.marriageBonus,
        lifeExpGained: result.lifeExpGained,
        marriageGift,
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
        eventLog: p.eventLog
          .filter((e) => ['asset_buy','asset_sell','travel','marriage','child','crisis','career_change','education','rat_race_escaped','loan_taken','franchise','relationship'].includes(e.type))
          .map((e) => ({
            age: e.age,
            type: e.type,
            description: e.description,
            cashBefore: e.cashBefore,
            cashAfter: e.cashAfter,
            cashflowBefore: e.cashflowBefore,
            cashflowAfter: e.cashflowAfter,
            netWorthBefore: e.netWorthBefore,
            netWorthAfter: e.netWorthAfter,
          })),
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
      // 標記為斷線狀態，10 分鐘內可重連恢復資料
      player.isDisconnected = true;
      console.log(`[斷線] 玩家 ${player.name} 斷線，保留資料 10 分鐘等待重連`);
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

      setTimeout(() => {
        // 10 分鐘後若仍是斷線狀態（未重連），才真正移除
        if (player.isDisconnected) {
          const wasCurrentTurn = gs.currentPlayerTurnId === socket.id;
          gs.removePlayer(socket.id);
          if (wasCurrentTurn && gs.playerOrder.length > 0) {
            gs.advanceToNextTurn();
          }
          console.log(`[斷線] 玩家 ${player.name} 重連逾時，已移除。房間 ${roomId} 剩 ${gs.players.size} 人`);
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        }
      }, 10 * 60 * 1000);
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
      stockDCAAmount: 0,
      buyInsuranceTypes: [],
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('submitPaydayPlan', onPlan);
      socket.off('disconnect', onDisconnect);
    };
    const onPlan = (plan: PaydayPlanPayload) => { cleanup(); resolve(plan ?? emptyPlan); };
    const onDisconnect = () => {
      cleanup();
      console.log(`[paydayPlan] ${player.name} 斷線，自動略過規劃`);
      resolve(emptyPlan);
    };
    const timer = setTimeout(() => {
      cleanup();
      console.log(`[paydayPlan] ${player.name} 逾時自動略過規劃`);
      resolve(emptyPlan);
    }, PAYDAY_PLANNING_TIMEOUT_MS);

    socket.once('submitPaydayPlan', onPlan);
    socket.once('disconnect', onDisconnect);
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
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('submitCardDecision', onDecision);
      socket.off('disconnect', onDisconnect);
    };
    const onDecision = (decision: Record<string, unknown>) => { cleanup(); resolve(decision ?? null); };
    const onDisconnect = () => { cleanup(); resolve(null); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    socket.once('submitCardDecision', onDecision);
    socket.once('disconnect', onDisconnect);
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
        // ⚠ 修正：playerRoll 的 passedPaydays 已經呼叫 triggerPayday + paydayCount++ 了，
        // 此處不再重複加 monthlyCashflow / paydayCount，只做「外圈發薪日專屬獎勵」：
        //   1. 資產總值 × 1% 紅利現金（applyFastTrackPaydayBonus）
        //   2. 所有資產 currentValue × 1.15 增值（applyFastTrackAppreciation）
        const bonus = applyFastTrackPaydayBonus(player);
        applyFastTrackAppreciation(player);
        emitCellEvent(socket, roomId, player.name, 'FT 發薪日獎勵', `💰 外圈發薪日獎勵！紅利現金 +$${bonus.toLocaleString()} + 全資產 +15% 增值。`);
        emitToRoom(roomId, 'fastTrackPayday', {
          playerId: player.id, playerName: player.name,
          cashflow: 0, bonus, cashAfter: player.cash,
        });
        break;
      }
      case FastTrackSquareType.BigRealEstate:
      case FastTrackSquareType.BusinessDeal:
      case FastTrackSquareType.StockOpportunity: {
        // 大型交易：從現有大交易牌組抽牌
        const { BIG_DEALS } = require('./gameCards');
        const deal: DealCard = BIG_DEALS[Math.floor(Math.random() * BIG_DEALS.length)];
        emitCellEvent(socket, roomId, player.name, 'FT 大交易', `💼 外圈大型投資機會：${deal.title}！`);
        pauseGameClock(gs);
        emitToRoom(roomId, 'gamePaused', { reason: '外圈大型交易', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });
        const _ftLoanAvailable = getAvailableLoan(player);
        socket.emit('fastTrackDealCard', {
          squareType: ftSqType,
          deal,
          isFastTrack: true,
          creditScore: player.creditScore,
          loanAvailable: _ftLoanAvailable,
        });
        // 等待玩家決策（30 秒逾時自動略過）
        const ftDealDecision = await waitForCardDecision(socket, 30000);
        resumeGameClock(gs);
        emitToRoom(roomId, 'gameResumed', { resumedAt: new Date() });
        const ftCost = deal.asset.downPayment ?? deal.asset.cost;
        if (ftDealDecision?.accept === true) {
          // 先處理槓桿借款（現金不足→借差額；現金已足且選 leverage→主動槓桿借款留現金）
          if (ftDealDecision.useLeverage === true && ftCost > 0) {
            const _ftAvailableLoan = getAvailableLoan(player);
            const ftBorrow =
              player.cash < ftCost
                ? ftCost - player.cash
                : Math.min(ftCost, _ftAvailableLoan);
            if (ftBorrow > 0) {
              const lvResult = takeLeverageLoan(player, ftBorrow, deal.title);
              if (!lvResult.success) {
                socket.emit('error', { message: `投資槓桿借款失敗：${lvResult.message}` });
                break;
              }
              socket.emit('loanTaken', {
                liabilityId: lvResult.liabilityId,
                loanType: 'leverage',
                amount: lvResult.amount,
                monthlyPayment: lvResult.monthlyPayment,
                newCreditScore: lvResult.newCreditScore,
              });
            }
          }

          if (player.cash >= ftCost) {
            acceptDealCard(player, deal);
            emitCellEvent(socket, roomId, player.name, 'FT 大交易', `✅ 成交！${deal.title} 月現金流 +$${deal.asset.monthlyCashflow.toLocaleString()}`);
            emitToRoom(roomId, 'cardApplied', {
              playerId: player.id,
              squareType: ftSqType,
              effect: { type: 'dealAccepted', card: deal },
            });
          } else {
            socket.emit('error', { message: `現金不足，無法購買 ${deal.title}（需 $${ftCost.toLocaleString()}）。` });
          }
        }
        break;
      }
      case FastTrackSquareType.NetworkSummit: {
        const ntPerLevel = 75_000;
        const ntBonus = player.stats.network * ntPerLevel;
        player.cash += ntBonus;
        player.lifeExperience += 8;
        emitCellEvent(socket, roomId, player.name, 'FT 人際關係', `🤝 人脈高峰！人脈值 ${player.stats.network} × $${ntPerLevel.toLocaleString()} = +$${ntBonus.toLocaleString()}。`);
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
          player.charityTotal = (player.charityTotal ?? 0) + charityAmount;
          player.lifeExperience += 15;
          player.legacyBonusPoints += 5;
          emitCellEvent(socket, roomId, player.name, 'FT 慈善', `❤️ 外圈慈善！捐出 $${charityAmount.toLocaleString()}，累積慈善 $${player.charityTotal.toLocaleString()}，生命體驗 +15、傳承 +5。`);
          emitToRoom(roomId, 'fastTrackCharity', {
            playerId: player.id, playerName: player.name,
            amount: charityAmount, legacyBonus: 5, charityTotal: player.charityTotal,
          });
          checkBucketGoals(player, gs, roomId, socket);
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 慈善', '❤️ 外圈慈善格，現金不足或現金流為零，跳過捐款。');
        }
        break;
      }
      case FastTrackSquareType.TaxPlanning: {
        const taxSaving = Math.round(player.expenses.taxes * 0.2);
        player.cash += taxSaving;
        emitCellEvent(socket, roomId, player.name, 'FT 稅務規劃', `📊 稅務優化！節省稅款 +$${taxSaving.toLocaleString()}。`);
        emitToRoom(roomId, 'fastTrackTaxPlanning', {
          playerId: player.id, playerName: player.name, taxSaving,
        });
        break;
      }
      case FastTrackSquareType.TechStartup: {
        // 科技新創：隨機投資金額，擲骰決定成敗
        const amounts = [300_000, 750_000, 1_500_000];
        const investmentAmount = amounts[Math.floor(Math.random() * amounts.length)];
        emitCellEvent(socket, roomId, player.name, 'FT 科技新創', `💡 科技新創機會！投入 $${investmentAmount.toLocaleString()} 擲骰決定成敗（≥4 成功）。`);
        pauseGameClock(gs);
        emitToRoom(roomId, 'gamePaused', { reason: '科技新創投資機會', currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });
        socket.emit('techStartupOffer', {
          playerId: player.id,
          playerName: player.name,
          investmentAmount,
          playerCash: player.cash,
        });
        const startupDecision = await waitForCardDecision(socket, 20000);
        if (startupDecision?.invest === true && player.cash >= investmentAmount) {
          player.cash -= investmentAmount;
          const diceRoll = rollDice(1);
          const networkBonus = player.stats.network >= 5 ? 1 : 0;
          const success = (diceRoll + networkBonus) >= 4;
          if (success) {
            const monthlyCashflow = Math.round(investmentAmount * 0.1);
            player.assets.push({
              id: `startup-${player.id}-${Date.now()}`,
              name: '科技新創股份',
              type: 'Business' as import('./gameConstants').AssetType,
              cost: investmentAmount,
              currentValue: investmentAmount,
              monthlyCashflow,
            });
            socket.emit('techStartupResult', {
              playerId: player.id,
              invested: true,
              success: true,
              diceRoll,
              investmentAmount,
              monthlyCashflow,
              cashAfter: player.cash,
            });
          } else {
            socket.emit('techStartupResult', {
              playerId: player.id,
              invested: true,
              success: false,
              diceRoll,
              investmentAmount,
              cashAfter: player.cash,
            });
          }
        } else {
          socket.emit('techStartupResult', { playerId: player.id, invested: false, investmentAmount });
        }
        resumeGameClock(gs);
        emitToRoom(roomId, 'gameResumed', { currentAge: Math.round(getCurrentAge(gs) * 10) / 10 });
        break;
      }
      case FastTrackSquareType.GlobalWave: {
        const { MARKET_CARDS } = require('./gameCards');
        const evt = MARKET_CARDS[Math.floor(Math.random() * MARKET_CARDS.length)];
        // applyMarketCard 內部已遍歷所有玩家，呼叫一次即可（之前 for 迴圈會造成 N 倍效果）
        applyMarketCard(gs, evt);
        emitCellEvent(socket, roomId, player.name, 'FT 全球浪潮', `🌊 全球市場波動：${evt.title}，影響所有玩家資產！`);
        emitToRoom(roomId, 'globalWaveEvent', { triggeredBy: player.name, event: evt });
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        break;
      }
      case FastTrackSquareType.Partnership: {
        const others = [...gs.players.values()].filter((p) => p.id !== player.id && p.isAlive);
        if (others.length > 0) {
          emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 合夥機會！可邀請其他玩家共同投資，雙方各得 +15 生命體驗。');
          socket.emit('partnershipOpportunity', {
            availablePartners: others.map((p) => ({ id: p.id, name: p.name })),
          });
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 合夥機會格，但目前沒有其他存活玩家，跳過。');
        }
        break;
      }
      case FastTrackSquareType.Crisis: {
        const { DISEASE_CRISIS_EVENTS } = require('./gameCards');
        const pool = DISEASE_CRISIS_EVENTS ?? [];
        if (pool.length > 0) {
          const c = pool[Math.floor(Math.random() * pool.length)];
          // ⚠ 修正：之前只 emit 卡片給前端，沒套用實際效果（cash/turnsToSkip 都不扣）
          const _ftcCB = player.cash; const _ftcFB = player.monthlyCashflow; const _ftcNWB = calcNetWorth(player);
          const crisisResult = applyCrisisCard(player, c);
          emitCellEvent(socket, roomId, player.name, 'FT 危機事件',
            `⚠️ 外圈危機：${c.title}！${crisisResult.wasInsured ? '保險豁免' : `現金 -$${crisisResult.effectiveCost.toLocaleString()}`}，跳過 ${crisisResult.turnsLost} 回合`);
          logPlayerEvent(player, gs, 'crisis', `外圈危機：${c.title}`, _ftcCB, _ftcFB, _ftcNWB, { cardId: c.id, cardTitle: c.title, deathTriggered: crisisResult.deathTriggered });
          if (crisisResult.deathTriggered) {
            handlePlayerDeath(player, gs);
            emitToRoom(roomId, 'playerDied', {
              playerId: player.id,
              playerName: player.name,
              cause: '外圈危機',
              crisis: c,
            });
          } else {
            socket.emit('fastTrackCrisisCard', { crisis: c, result: crisisResult });
          }
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 危機事件', '✅ 危機牌庫已空，平安通過。');
        }
        break;
      }
      case FastTrackSquareType.LifeJourney: {
        const { TRAVEL_DESTINATIONS } = require('./gameConfig');
        const outerDests = (TRAVEL_DESTINATIONS as Array<{ id: string; name: string; tier: string; cost: number; lifeExpGained: number; region: string }>)
          .filter((d) => d.tier === 'outer' || d.tier === 'both');
        emitCellEvent(socket, roomId, player.name, 'FT 人生旅程', '✈️ 外圈人生旅程！可選擇更遠的旅遊目的地，獲得豐富的生命體驗。');
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
          emitCellEvent(socket, roomId, player.name, 'FT 人際關係', `🤝 外圈人際事件：${rel.title}`);
          socket.emit('relationshipCardApplied', { card: rel });
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 人際關係', '🤝 外圈人際關係格，無特殊事件。');
        }
        break;
      }
      case FastTrackSquareType.AssetLeverage: {
        // 資產槓桿：自動給予被動收入 × 3 的現金獎勵
        const bonus = Math.max(player.totalPassiveIncome * 3, 150_000);
        player.cash += bonus;
        emitCellEvent(socket, roomId, player.name, 'FT 資產槓桿', `🚀 資產槓桿！獲得 +$${bonus.toLocaleString()} 現金獎勵。`);
        socket.emit('assetLeverageBonus', {
          playerId: player.id,
          playerName: player.name,
          bonus,
          passiveIncome: player.totalPassiveIncome,
          cashAfter: player.cash,
        });
        break;
      }
      case FastTrackSquareType.DiseaseCrisis: {
        // 疾病危機：強制 HP -20，抽疾病危機牌，套用 applyCrisisCard
        const { DISEASE_CRISIS_EVENTS: diseasePool } = require('./gameCards');
        const diseaseCard = diseasePool[Math.floor(Math.random() * diseasePool.length)];
        const hpBefore = player.stats.health;
        const justBedFT = applyHPChange(player, -20);
        if (justBedFT) {
          emitToRoom(roomId, 'playerBedridden', {
            playerId: player.id,
            playerName: player.name,
            age: Math.round(getCurrentAge(gs)),
          });
        }
        const crisisResult = applyCrisisCard(player, diseaseCard);
        emitCellEvent(socket, roomId, player.name, 'FT 疾病危機', `🏥 疾病危機：${diseaseCard.title}！HP -20，請確認保險狀態。`);
        if (crisisResult.deathTriggered) {
          handlePlayerDeath(player, gs);
          emitToRoom(roomId, 'playerDied', {
            playerId: player.id,
            playerName: player.name,
            cause: '疾病危機',
            crisis: diseaseCard,
          });
        } else {
          socket.emit('diseaseCrisisCard', {
            crisis: diseaseCard,
            result: crisisResult,
            hpBefore,
            hpAfter: player.stats.health,
          });
        }
        break;
      }
      default:
        emitCellEvent(socket, roomId, player.name, '快速通道格子', '✅ 本格無特殊事件，平安通過。');
        break;
    }

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    return;
  }

  // ── 內圈落點處理 ─────────────────────────────────────────
  const squareType = getSquareType(player.currentPosition);

  switch (squareType) {
    case SquareType.Payday:
      emitCellEvent(socket, roomId, player.name, '發薪日', '💰 發薪日到了！領取薪水，並規劃投資與生活安排。');
      break;

    case SquareType.SecondLife:
      // 解鎖邏輯由 playerRoll 內 crossedCell24 偵測處理；停在此格只發提示訊息
      emitCellEvent(socket, roomId, player.name, '第二人生',
        player.hasPassedSecondLife
          ? '🌟 第二人生格！被動收入 ≥ 支出即可脫出老鼠賽跑。'
          : '🌟 你抵達了第二人生格！從此符合脫出老鼠賽跑的條件。');
      break;

    case SquareType.Baby: {
      const babyAge = getCurrentAge(gs);
      const babyWindow = LIFE_EVENT_WINDOWS.children;

      if (player.stats.health < HP_ACTIVITY_THRESHOLDS.baby) {
        emitCellEvent(socket, roomId, player.name, '添丁', '👶 健康值不足，這次無法迎接新成員。');
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
        // 添丁紅包（長輩賀禮，一次性現金入帳）
        const childGift = CHILD_GIFT_BASE + Math.round(Math.random() * CHILD_GIFT_RANDOM_BONUS);
        player.cash += childGift;
        logPlayerEvent(player, gs, 'child', `添丁！第 ${player.numberOfChildren} 個孩子，長輩紅包 +$${childGift.toLocaleString()}`, _byCB, _byFB, _byNWB, { childCount: player.numberOfChildren, childGift });
        emitCellEvent(socket, roomId, player.name, '添丁', `👶 恭喜！迎來第 ${player.numberOfChildren} 個孩子，長輩紅包 +$${childGift.toLocaleString()}！`);
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'baby', numberOfChildren: player.numberOfChildren, lifeExpGained: LIFE_EXP.HAVE_CHILD, childGift },
        });
      } else {
        if (!player.isMarried && Math.random() < LIFE_EVENT_WINDOWS.marriage.baseProbability) {
          emitCellEvent(socket, roomId, player.name, '添丁', '💍 緣分到了！婚姻機會出現。');
          await triggerMarriageWindow(socket, player, gs);
        } else {
          emitCellEvent(socket, roomId, player.name, '添丁', '👼 這次沒有新成員，繼續努力！');
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
      if (!card) {
        emitCellEvent(socket, roomId, player.name, '意外支出', '✅ 本次意外支出牌庫已空，平安通過。');
        break;
      }
      const result = applyDoodadCard(player, card);
      gs.doodadDeck.discard(card);
      emitCellEvent(socket, roomId, player.name, '意外支出', `💸 ${card.title}：意外支出到來！`);
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
      emitCellEvent(socket, roomId, player.name, '裁員', '⚠️ 公司裁員！下一個發薪日薪資暫停發放。');
      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: { type: 'downsizing', downsizingTurnsLeft: player.downsizingTurnsLeft },
      });
      break;
    }

    case SquareType.Market: {
      const card = gs.marketDeck.draw();
      if (!card) {
        emitCellEvent(socket, roomId, player.name, '市場行情', '📈 市場目前平靜，無特殊波動。');
        break;
      }
      const result = applyMarketCard(gs, card);
      gs.marketDeck.discard(card);
      emitToRoom(roomId, 'marketCardApplied', {
        card,
        affectedAssets: result.affectedAssets,
        dividendsPaid: result.dividendsPaid,
      });
      // Dividend：給每位收益者一次現金事件記錄，方便事後檢視
      if (result.dividendsPaid && result.dividendsPaid.length > 0) {
        for (const div of result.dividendsPaid) {
          const recipient = gs.players.get(div.playerId);
          if (!recipient) continue;
          logPlayerEvent(
            recipient, gs, 'payday',
            `市場配息：${card.title}（+$${div.cashGain.toLocaleString()}）`,
            recipient.cash - div.cashGain,
            recipient.monthlyCashflow,
            calcNetWorth(recipient) - div.cashGain,
            { cardId: card.id, dividendAmount: div.cashGain }
          );
        }
        const summary = result.dividendsPaid
          .map((d) => `${d.playerName} +$${d.cashGain.toLocaleString()}`)
          .join('、');
        emitCellEvent(socket, roomId, player.name, '市場行情',
          `💰 ${card.title}：${summary}`);
      } else {
        emitCellEvent(socket, roomId, player.name, '市場行情', `📈 市場行情：${card.title}`);
      }
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
      break;
    }

    case SquareType.SmallDeal:
    case SquareType.BigDeal: {
      const dealTypeName = squareType === SquareType.BigDeal ? '大交易' : '小交易';

      // 機運卡分支：小交易格 30% 機率改抽機運卡（一次性現金入帳，無需玩家決策）
      // 用來補足早期玩家「只有薪水」的進現金管道
      if (squareType === SquareType.SmallDeal && Math.random() < 0.3) {
        const lucky = LUCKY_CARDS[Math.floor(Math.random() * LUCKY_CARDS.length)];
        const _lkCB = player.cash;
        const _lkFB = player.monthlyCashflow;
        const _lkNWB = calcNetWorth(player);
        const lkResult = applyLuckyCard(player, lucky);
        logPlayerEvent(
          player, gs, 'lucky_card',
          `🍀 機運卡：${lucky.title}（+$${lkResult.cashGain.toLocaleString()}）`,
          _lkCB, _lkFB, _lkNWB,
          { cardId: lucky.id, cashGain: lkResult.cashGain }
        );
        socket.emit('luckyCardDrawn', {
          card: lucky,
          cashGain: lkResult.cashGain,
          newCash: player.cash,
        });
        emitCellEvent(socket, roomId, player.name, '機運卡', `🍀 ${lucky.title}：+$${lkResult.cashGain.toLocaleString()}！`);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        break;
      }

      socket.emit('squareLandingNotice', { cellName: dealTypeName, message: `📋 ${dealTypeName}機會出現！查看可用的投資選項。` });
      io.to(roomId).emit('cellEventBroadcast', { playerId: socket.id, playerName: player.name, cellName: dealTypeName, message: `📋 ${dealTypeName}機會出現！`, ts: Date.now() });

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

      if (drawnCards.length === 0) {
        emitCellEvent(socket, roomId, player.name, dealTypeName, `📋 ${dealTypeName}牌庫已空，本次無交易機會。`);
        break;
      }

      // 步驟1：先讓玩家A決定（再決定是否開拍）
      const cardsForClient = drawnCards.map((c) => ({
        id: c.id,
        name: c.title,
        description: c.description,
        downPayment: c.asset.downPayment ?? c.asset.cost,
        monthlyCashflow: c.asset.monthlyCashflow,
      }));
      // 計算玩家當前可用「投資槓桿借款」額度（只計算無擔保負債，房貸/事業貸款不計入）
      const _loanAvailable = getAvailableLoan(player);
      socket.emit('dealCardsDrawn', {
        cards: cardsForClient,
        canPickTwo: drawCount > 1,
        playerCash: player.cash,
        creditScore: player.creditScore,
        loanAvailable: _loanAvailable,
      });
      const decision = await waitForCardDecision(socket);

      if (decision && decision.accepted) {
        // 玩家A接受 → 正常交易流程
        const selectedId = decision.selectedCardId as string | undefined;
        const chosen = selectedId
          ? drawnCards.find((c) => c.id === selectedId) ?? drawnCards[0]
          : drawnCards[0];

        const downPayment = chosen.asset.downPayment ?? chosen.asset.cost ?? 0;

        // 若玩家選擇「用槓桿借款購買」：
        // - 現金不足：借差額補上
        // - 現金已足：主動槓桿，借款金額 = min(downPayment, 借款上限)，把現金留著做別的事
        if (decision.useLeverage === true && downPayment > 0) {
          const availableLoan = getAvailableLoan(player);
          const borrowAmount =
            player.cash < downPayment
              ? downPayment - player.cash
              : Math.min(downPayment, availableLoan);
          if (borrowAmount > 0) {
            const lvResult = takeLeverageLoan(player, borrowAmount, chosen.title);
            if (!lvResult.success) {
              socket.emit('error', { message: `投資槓桿借款失敗：${lvResult.message}` });
              drawnCards.forEach((c) => deck.discard(c));
              emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: { type: 'dealDeclined' } });
              break;
            }
            socket.emit('loanTaken', {
              liabilityId: lvResult.liabilityId,
              loanType: 'leverage',
              amount: lvResult.amount,
              monthlyPayment: lvResult.monthlyPayment,
              newCreditScore: lvResult.newCreditScore,
            });
          }
        }

        if (player.cash < downPayment) {
          socket.emit('error', { message: `現金不足，無法完成此交易（需 $${downPayment.toLocaleString()}，目前 $${player.cash.toLocaleString()}）。` });
          drawnCards.forEach((c) => deck.discard(c));
          emitToRoom(roomId, 'cardApplied', {
            playerId: player.id,
            squareType,
            effect: { type: 'dealDeclined' },
          });
          break;
        }

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
        // 玩家A放棄 → 廣播競標給所有玩家（每張抽到的牌各開一場 20 秒拍賣）
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'dealDeclined' },
        });

        // ⚠ 修正：以前 NT≥5 抽 2 張時只拍賣 drawnCards[0]，drawnCards[1] 直接消失
        if (!gs.activeAuctions) gs.activeAuctions = {};

        drawnCards.forEach((auctionCard, idx) => {
          const minBid = auctionCard.asset.downPayment ?? auctionCard.asset.cost ?? 0;
          const auctionId = `auction-${Date.now()}-${idx}`;
          const auctionEndTime = Date.now() + 20000;
          gs.activeAuctions![auctionId] = {
            dealCardId: auctionCard.id,
            startTime: Date.now(), endTime: auctionEndTime,
            highestBid: 0, minBid,
            triggeredBy: player.id, triggeredByName: player.name,
            cardInfo: { name: auctionCard.title, monthlyCashflow: auctionCard.asset.monthlyCashflow ?? 0, downPayment: minBid },
          };

          socket.to(roomId).emit('dealAuctionStarted', {
            auctionId, triggeredBy: player.id, triggeredByName: player.name,
            card: {
              id: auctionCard.id,
              name: auctionCard.title,
              description: auctionCard.description,
              minBid,
              monthlyCashflow: auctionCard.asset.monthlyCashflow,
            },
            endsAt: auctionEndTime,
          });

          // 20 秒後結算
          setTimeout(() => {
            const auction = gs.activeAuctions?.[auctionId];
            if (!auction) return;
            delete gs.activeAuctions![auctionId];

            if (auction.highestBidderId && auction.highestBid >= minBid) {
              const winner = gs.players.get(auction.highestBidderId);
              if (winner && winner.cash >= auction.highestBid) {
                const _wCB = winner.cash; const _wFB = winner.monthlyCashflow; const _wNWB = calcNetWorth(winner);
                winner.cash -= auction.highestBid;
                player.cash += auction.highestBid;
                acceptDealCard(winner, auctionCard);
                logPlayerEvent(winner, gs, 'asset_buy', `競標得標：${auctionCard.title}（月現金流 ${(auctionCard.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${auctionCard.asset.monthlyCashflow ?? 0}）`, _wCB, _wFB, _wNWB, { cardId: auctionCard.id, cardTitle: auctionCard.title });
                emitToRoom(roomId, 'dealAuctionEnded', {
                  auctionId,
                  winnerId: auction.highestBidderId,
                  winnerName: auction.highestBidderName,
                  winningBid: auction.highestBid,
                  cardName: auctionCard.title,
                  hadBids: true,
                });
                emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
                deck.discard(auctionCard);
              } else {
                deck.discard(auctionCard);
              }
            } else {
              emitToRoom(roomId, 'dealAuctionEnded', {
                auctionId, winnerId: null, winnerName: null,
                winningBid: 0, cardName: auctionCard.title, hadBids: false,
              });
              deck.discard(auctionCard);
            }
          }, 20000);
        });
      }
      break;
    }

    case SquareType.Charity: {
      const card: CharityCard = CHARITY_CARD;
      const donationAmount = Math.round(player.salary * card.donationPercentage);

      emitCellEvent(socket, roomId, player.name, '慈善捐款', `❤️ 慈善格子！捐出 $${donationAmount.toLocaleString()} 可獲得生命體驗與傳承加成，是否參與？`);
      socket.emit('charityCardPending', { amount: donationAmount });
      const decision = await waitForCardDecision(socket);
      const donate = decision?.donate === true;

      applyCharityDonation(player, card, donate);

      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: {
          type: 'charity',
          donated: donate,
          donationAmount: donate ? donationAmount : 0,
          bonusDice: player.bonusDice,
          charityTotal: player.charityTotal,
        },
      });
      if (donate) checkBucketGoals(player, gs, roomId, socket);
      break;
    }

    case SquareType.Crisis: {
      const currentAge = getCurrentAge(gs);
      const stage = getLifeStage(currentAge);

      // 危機觸發機率公式（修正前 1.0/2.2≈45% 過低，年輕期幾乎都閃過）：
      //   trigger = clamp(freqMultiplier × 0.65, 0.6, 1.0)
      // Youth: 65%, Family: 78%, Transition: 97%, Retirement+: 100%
      const freqMultiplier = CRISIS_FREQ_BY_STAGE[stage];
      const triggerProb = Math.max(0.6, Math.min(1, freqMultiplier * 0.65));
      if (Math.random() > triggerProb) {
        emitCellEvent(socket, roomId, player.name, '危機事件', '🍀 恭喜！這次危機擦身而過，平安無事。');
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

      emitCellEvent(socket, roomId, player.name, '危機事件', `⚠️ 危機來臨：${card.title}！`);

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
      emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 人際關係格子：${relCard.title}`);

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
      emitCellEvent(socket, roomId, player.name, '普通格子', '✅ 本格無特殊事件，平安通過。');
      break;
  }
}
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
    // 緣分窗口結婚的禮金（最盛大）
    const wmGift = MARRIAGE_GIFT.window + Math.round(Math.random() * MARRIAGE_GIFT_RANDOM_BONUS);
    player.cash += wmGift;
    logPlayerEvent(player, gs, 'marriage', `結婚（緣分），月收入加成 +$${card.monthlyBonus}，禮金 +$${wmGift.toLocaleString()}`, _wmCB, _wmFB, _wmNWB, { marriageType: 'window', card: card.title, monthlyBonus: card.monthlyBonus, marriageGift: wmGift });

    emitToRoom(roomId, 'playerMarried', {
      playerId: player.id,
      playerName: player.name,
      card,
      newMonthlyBonus: card.monthlyBonus,
      lifeExpGained: card.lifeExpGain,
      marriageGift: wmGift,
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
    SKILL_CAREER_CHANGE_THRESHOLD,
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
    skillTraining: { available: player.cash >= skillCost && player.stats.careerSkill < SKILL_CAREER_CHANGE_THRESHOLD, cost: skillCost, currentSK: player.stats.careerSkill },
    networkInvest: { available: player.cash >= ntCost && player.stats.network < (player.profession.salaryType === 'nt_driven' ? Infinity : 10), cost: ntCost, currentNT: player.stats.network },
  };
}

function buildAvailableProfessions(player: Player): object[] {
  const { getCareerChangeAssetCost } = require('./statsSystem');
  return PROFESSIONS
    .filter((p) => p.id !== player.profession.id)
    .map((p) => {
      const assetCost = getCareerChangeAssetCost(p.id);
      return {
        id: p.id,
        name: p.name,
        quadrant: p.quadrant,
        salary: p.startingSalary,
        startingFQ: p.startingFQ,
        assetCost, // 轉職到 B/I 需從現金扣除的「自有資產成本」
        canAfford: assetCost === 0 || player.cash >= assetCost,
      };
    });
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
