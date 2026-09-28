import * as http from 'http';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Server, Socket } from 'socket.io';
import { validateSocketPayload } from './socketValidation';
import { repayRoomLoan, validatePlayerLoan } from './playerLoans';
import { GameState, Player, PaydayPlanPayload, GamePhase, PlayerEvent, PlayerEventType, DecisionPhaseState, FacilitatorSceneState, AssetType } from './gameDataModels';
import { previewCareerChange } from './careerStage';
import { BASIC_INVESTMENTS, buyBasicInvestment } from './basicInvestments';
import { writeSnapshot, readSnapshots, deleteSnapshot, resolveStateDir, isPersistentVolume, SNAPSHOT_VERSION } from './roomPersistence';
import { getHomeOffers, buyHome } from './householdLoans';
import { investBondFund, BOND_FUND_ID } from './bondFund';
import { syncPlayerAges, getLayoffMonths, createSpouse, checkNaturalDeath, naturalDeathProbability } from './gameLogic';
import { LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS, MONTHS_PER_ROUND_OPTIONS, CHILD_EXPENSE_BY_AGE, SOCIAL_INSURANCE_RATE, PREMIUM_MULT_BY_STAGE } from './gameConfig';
import {
  createPlayer,
  applyGlobalEvent,
  rollDice,
  computePension,
  computeConsultantIncome,
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
  consumeEducationTurn,
  addLifeExperience,
  getCurrentAge,
  getRemainingActivityTimeMs,
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
  SOCIAL_CLASS_CONFIG, DEFAULT_GAME_DURATION_MS,
  MIN_GAME_DURATION_MS, MAX_GAME_DURATION_MS,
  LIFE_EXP, LIFE_EVENT_WINDOWS,
  MARRIAGE_GIFT, MARRIAGE_GIFT_RANDOM_BONUS,
  CHILD_GIFT_BASE, CHILD_GIFT_RANDOM_BONUS,
  MAX_CHILDREN, MIN_CHILD_SPACING_YEARS, MIN_CHILD_AGE, MAX_CHILD_AGE,
  MARRIAGE_BONUS_BY_TYPE, RELATIONSHIP_MARRIAGE_THRESHOLD,
  HP_ACTIVITY_THRESHOLDS,
  HOST_ACTIVATION_DRS_BONUS,
  CRISIS_FREQ_BY_STAGE,
  E_PROFESSION_POOLS, S_PROFESSION_POOLS, B_PROFESSION_POOLS, I_PROFESSION_POOLS,
  QUADRANT_SELECT_THRESHOLDS, FRANCHISE_CASH_THRESHOLD, PROFESSIONS,
  SECOND_LIFE_CELL,
  SECOND_LIFE_MIN_PAYDAYS, SECOND_LIFE_FINANCIAL_COVERAGE_RATIO, SECOND_LIFE_BALANCED_COVERAGE_RATIO,
  SECOND_LIFE_FINANCIAL_INDICATORS_REQUIRED, SECOND_LIFE_BALANCED_INDICATORS_REQUIRED,
  MONTHS_PER_GLOBAL_PAYDAY, PAYDAY_MAX_ROUNDS,
  MONTHS_PER_ROUND,
  RETIREMENT_ROUND, RETIREMENT_STARTUP_AMOUNTS, RETIREMENT_STARTUP_SUCCESS_ROLL, RETIREMENT_STARTUP_RETURN_RATE,
  RETIREMENT_STARTUP_FAILURE_LOSS, RETIREMENT_DEFER_HP_COST, RETIREMENT_MAX_DEFERRALS, CONSULTANT_HP_COST_PER_CYCLE,
  CONSULTANT_MIN_HP, CONSULTANT_SK_RATE, CONSULTANT_NT_RATE, PENSION_RATE_BY_QUADRANT,
  PAYDAY_TIMER_DEFAULT_MS,
  GROWTH_CYCLES_PER_GLOBAL_PAYDAY,
  YEARS_PER_COMPLETED_ROUND,
  TOTAL_LIFE_ROUNDS,
  FINAL_ROUND_START_COMPLETED_ROUNDS,
  STOCK_DCA_MONTHLY_RETURN_RATE,
  STOCK_DCA_MONTHLY_DIVIDEND_RATE,
  SKILL_CAREER_CHANGE_THRESHOLD,
  getLoanLimit,
  getLoanRate,
  FAST_TRACK_LETHAL_CRISIS_NET_WORTH_SHARE, FAST_TRACK_LETHAL_CRISIS_MIN_COST,
} from './gameConfig';
import {
  MEDICAL_INSURANCE_PREMIUM,
  LIFE_INSURANCE_PREMIUM,
  PROPERTY_INSURANCE_PREMIUM,
  PER_CHILD_EXPENSE,
  FQ_MULTIPLIERS, FAST_TRACK_INCOME_MULTIPLIER,
} from './gameConstants';
import { syncHouseholdLoans } from './householdLoans';
import { ADMIN_GLOBAL_EVENTS, ADMIN_GLOBAL_EVENT_MAP, type AdminGlobalEvent } from './adminEvents';
import { worldEventRestriction, hasFragilePlayers, describeWorldEvent, expireWorldEffects } from './worldEvents';
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
  CrisisCard,
  CharityCard,
  CHARITY_CARD,
  getFastTrackSquareType,
  FastTrackSquareType,
  FAST_TRACK_BOARD,
  MARRIAGE_CARDS,
  MarriageCard,
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
  previewCrisisCost,
  handlePlayerDeath,
  evaluateSecondLifeEligibility,
  applyRelationshipCard,
  applyLuckyCard,
  getCharityDonationAmount,
} from './cardSystem';
import {
  assignBucketList,
  evaluateBucketList,
  getBucketGoal,
} from './bucketList';
// 各功能模組（handlers/*、landingSquare、paydayFlow…）從這支檔案匯入共用函式；
// 這裡再把它們匯出的函式重新匯出，讓所有模組都只需要從 socketServer 取用。
// 模組之間互相引用只在執行期發生（連線事件、回合推進），所以循環引用是安全的。
import { registerRoomHandlers } from './handlers/roomHandlers';
import { registerTurnHandlers } from './handlers/turnHandlers';
import { registerCareerHandlers } from './handlers/careerHandlers';
import { registerFinanceHandlers } from './handlers/financeHandlers';
import { registerWorldEventHandlers } from './handlers/worldEventHandlers';
import { registerSetupHandlers } from './handlers/setupHandlers';
import { registerSocialHandlers } from './handlers/socialHandlers';
import { registerHostHandlers } from './handlers/hostHandlers';
import { registerSceneHandlers } from './handlers/sceneHandlers';
import { registerReviewHandlers } from './handlers/reviewHandlers';
import { handleLandingSquare } from './landingSquare';
import { serializeGameState, serializePlayer, buildSecondLifeProgress, buildActionInfo, buildSalaryItems, buildNetWorthBreakdown, buildAffordableOptions, buildAvailableProfessions, careerBlockReason } from './playerView';
import { clampFacilitatorStat, adjustFacilitatorHealth, spendAvailableCash, beginFacilitatorScene, revealFacilitatorResult, pickMarriageCard, buildMarriageScene, startMarriageScene, transitionFamilySceneToMarriage, startFamilyScene, applyMarriageScene, resolveFamilyScene, closeFacilitatorScene, applyCommunityChoice, applyCooperationContract, findDecisionEcho, applyDecisionEcho, applyLegacyAction } from './facilitatorScenes';
import { emitQuarterMilestones, settleQuarterMonths, getActiveElapsedMs, roundsSinceLastPayday, paydaySettlementMonths, getPaydayElapsedMs, pausePaydayClock, resumePaydayClock, paydayRemainingMs, isPaydayDue, schedulePaydayIfDue, runGlobalPayday } from './paydayFlow';
import { beginHostDecisionPhase, waitForHostControlledDecision, waitForHostRelease, describePrompt, waitForCardDecision, applyCrisisWithRescue, scaleFastTrackCrisis } from './decisionPhases';
import { checkBucketGoals, checkLifeMilestones, buildSecondLifeReview, deathAgeLabel, eliminatePlayer, finishGame, startFinalRound, retirementSceneDescription, queueRetirementCandidates, tryOpenRetirementScene, queueSecondLifeCandidates, tryOpenSecondLife, revealSecondLife, promoteSecondLife, announceCareerUnlock } from './lifeProgress';
import { emitAdaptiveDirectorStatus, assessAdaptiveDifficulty, getAdaptiveEventPool, evaluateAndMaybeTriggerAdaptiveEvent, tryOpenWorldEvent } from './adaptiveDirector';
export { emitAdaptiveDirectorStatus, assessAdaptiveDifficulty, getAdaptiveEventPool, evaluateAndMaybeTriggerAdaptiveEvent, tryOpenWorldEvent };
export { checkBucketGoals, checkLifeMilestones, buildSecondLifeReview, deathAgeLabel, eliminatePlayer, finishGame, startFinalRound, retirementSceneDescription, queueRetirementCandidates, tryOpenRetirementScene, queueSecondLifeCandidates, tryOpenSecondLife, revealSecondLife, promoteSecondLife, announceCareerUnlock };
export { beginHostDecisionPhase, waitForHostControlledDecision, waitForHostRelease, describePrompt, waitForCardDecision, applyCrisisWithRescue, scaleFastTrackCrisis };
export { emitQuarterMilestones, settleQuarterMonths, getActiveElapsedMs, roundsSinceLastPayday, paydaySettlementMonths, getPaydayElapsedMs, pausePaydayClock, resumePaydayClock, paydayRemainingMs, isPaydayDue, schedulePaydayIfDue, runGlobalPayday };
export { clampFacilitatorStat, adjustFacilitatorHealth, spendAvailableCash, beginFacilitatorScene, revealFacilitatorResult, pickMarriageCard, buildMarriageScene, startMarriageScene, transitionFamilySceneToMarriage, startFamilyScene, applyMarriageScene, resolveFamilyScene, closeFacilitatorScene, applyCommunityChoice, applyCooperationContract, findDecisionEcho, applyDecisionEcho, applyLegacyAction };
export { serializeGameState, serializePlayer, buildSecondLifeProgress, buildActionInfo, buildSalaryItems, buildNetWorthBreakdown, buildAffordableOptions, buildAvailableProfessions, careerBlockReason };
export { handleLandingSquare };

/** 每條連線的事件註冊器：包錯誤處理、錯誤時暫停遊戲、財務操作後檢查第二人生 */
export type OnSafe = <T extends unknown[]>(event: string, handler: (...args: T) => unknown) => void;

// ============================================================
// 伺服器初始化
// ============================================================

export const PORT = parseInt(process.env.PORT ?? '3001', 10);

export const httpServer = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({
      ok: true,
      service: 'money-game-server',
      revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'local',
      rooms: rooms.size,
      uptimeSeconds: Math.floor(process.uptime()),
      persistence: PERSIST_ENABLED ? (isPersistentVolume() ? 'volume' : 'container-disk') : 'off',
      restoredRooms: restoredRoomCount,
    }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: false, message: 'Not Found' }));
});

export const configuredOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'https://game.cjlead.com.tw')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    return url.protocol === 'https:'
      && url.hostname.endsWith('.vercel.app')
      && url.hostname.startsWith('money-game');
  } catch {
    return false;
  }
}

export const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error('此來源不允許連線。'));
    },
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
export const rooms = new Map<string, GameState>();

export interface RoomAdminCredential {
  salt: Buffer;
  hash: Buffer;
}

export const roomAdminCredentials = new Map<string, RoomAdminCredential>();
export const MAX_ACTIVE_ROOMS = 100;
export const EMPTY_ROOM_CLEANUP_MS = 30 * 60 * 1000;
export const roomCreationRate = new Map<string, { count: number; resetAt: number }>();
export const adminLoginRate = new Map<string, { count: number; resetAt: number }>();
export const emptyRoomCleanupTimers = new Map<string, NodeJS.Timeout>();
export const roomAdminSocketIds = new Map<string, Set<string>>();

export function hasRoomAdmin(gs: GameState): boolean {
  return (roomAdminSocketIds.get(gs.gameId)?.size ?? 0) > 0 || Boolean(gs.adminSocketId);
}

export function isRoomAdmin(socket: Socket, gs: GameState): boolean {
  return roomAdminSocketIds.get(gs.gameId)?.has(playerIdentity(socket)) === true || gs.adminSocketId === playerIdentity(socket);
}

export function addRoomAdmin(roomId: string, socketId: string): void {
  const admins = roomAdminSocketIds.get(roomId) ?? new Set<string>();
  admins.add(socketId);
  roomAdminSocketIds.set(roomId, admins);
  const gs = rooms.get(roomId);
  if (gs && !gs.adminSocketId) gs.adminSocketId = socketId;
}

export function removeRoomAdmin(roomId: string, socketId: string): void {
  const admins = roomAdminSocketIds.get(roomId);
  admins?.delete(socketId);
  const gs = rooms.get(roomId);
  if (!admins || admins.size === 0) {
    roomAdminSocketIds.delete(roomId);
    if (gs) gs.adminSocketId = undefined;
    return;
  }
  if (gs?.adminSocketId === socketId) gs.adminSocketId = admins.values().next().value;
}

export function cancelEmptyRoomCleanup(roomId: string): void {
  const timer = emptyRoomCleanupTimers.get(roomId);
  if (!timer) return;
  clearTimeout(timer);
  emptyRoomCleanupTimers.delete(roomId);
}

export function scheduleEmptyRoomCleanup(roomId: string): void {
  if (emptyRoomCleanupTimers.has(roomId)) return;
  const gs = rooms.get(roomId);
  if (!gs || hasRoomAdmin(gs) || [...gs.players.values()].some(p => !p.isDisconnected)) return;

  const timer = setTimeout(() => {
    emptyRoomCleanupTimers.delete(roomId);
    const current = rooms.get(roomId);
    if (!current || hasRoomAdmin(current) || [...current.players.values()].some(p => !p.isDisconnected)) return;
    for (const id of current.players.keys()) {
      playerSessions.delete(id);
      privateReplay.delete(id);
      pendingSubmissions.delete(id);
      socketRoomMap.delete(id);
    }
    decisionReleaseWaiters.delete(roomId);
    rooms.delete(roomId);
    roomAdminCredentials.delete(roomId);
    roomAdminSocketIds.delete(roomId);
    forgetPersistedRoom(roomId);
    console.log(`[autoCleanup] 空房間 ${roomId} 已在 30 分鐘後自動清除`);
  }, EMPTY_ROOM_CLEANUP_MS);
  timer.unref?.();
  emptyRoomCleanupTimers.set(roomId, timer);
}

export function consumeRateLimit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  maxAttempts: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= maxAttempts) return false;
  current.count += 1;
  return true;
}

export function createRoomAdminCredential(password: string): RoomAdminCredential {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(password, salt, 32) };
}

export function verifyRoomAdminPassword(roomId: string, password: string): boolean {
  const credential = roomAdminCredentials.get(roomId);
  if (!credential || !password) return false;
  const candidate = scryptSync(password, credential.salt, credential.hash.length);
  return candidate.length === credential.hash.length && timingSafeEqual(candidate, credential.hash);
}

/** 記錄每個 socket 目前所在的房間 ID（斷線清理用） */
export const socketRoomMap = new Map<string, string>();

/** 每個房間同一時間只會有一個等待主持人收束的決策階段。 */
export const decisionReleaseWaiters = new Map<string, { phaseId: string; release: () => void }>();
/** 玩家送出選擇後到自動揭曉的停留時間 */
export const AUTO_REVEAL_DELAY_MS = 1_500;

export interface CommunityChoiceCard {
  id: string;
  title: string;
  description: string;
  options: { id: string; label: string; description: string }[];
}

export const COMMUNITY_CHOICE_CARDS: CommunityChoiceCard[] = [
  {
    id: 'healthcare',
    title: '城市醫療改革',
    description: '公共醫療資源不足。全場必須討論：要共同承擔，還是保留個人選擇？',
    options: [
      { id: 'safety_net', label: '共築安全網', description: '每人投入部分現金，換取健康與人脈保障。' },
      { id: 'self_reliance', label: '各自承擔', description: '保留現金與自由，但全體承受較高健康風險。' },
    ],
  },
  {
    id: 'technology',
    title: '科技轉型浪潮',
    description: '新科技正在改變所有職業。大家要一起進修、搶先投資，還是暫時觀望？',
    options: [
      { id: 'learn_together', label: '全民進修', description: '投入學習成本，全體提升技能與財商。' },
      { id: 'invest_early', label: '搶先投資', description: '承擔較高成本，建立長期科技現金流。' },
      { id: 'wait', label: '保守觀望', description: '不花錢，獲得喘息，但錯過本輪成長。' },
    ],
  },
  {
    id: 'climate',
    title: '氣候災害重建',
    description: '城市遭遇極端氣候。資源有限，大家要共同重建，還是優先守住自己的家庭？',
    options: [
      { id: 'rebuild', label: '共同重建', description: '共同出資，換取人脈、健康與生命體驗。' },
      { id: 'protect_self', label: '各自防守', description: '減少支出，但每個人承受一部分資產損失。' },
    ],
  },
];

export const COOPERATION_CONTRACTS = {
  joint_venture: {
    title: '共同創業契約',
    description: '兩人各投入 $10,000，共同建立每月 $1,500 的事業現金流。',
  },
  mutual_aid: {
    title: '人生互助契約',
    description: '夥伴 A 支援夥伴 B $15,000；雙方建立更深的人脈與生命體驗。',
  },
  learning_alliance: {
    title: '共學成長契約',
    description: '兩人各投入 $8,000，共同提升第二專長、財商與人脈。',
  },
} as const;

export const LEGACY_CHOICES = {
  wisdom: { title: '智慧傳承', description: '將人生經驗交給一位仍在旅途中的玩家。' },
  network: { title: '人脈傳承', description: '把累積的人際連結交給下一位行動者。' },
  public_good: { title: '公益傳承', description: '把最後的資源化為所有人都能記住的公共影響。' },
} as const;

/**
 * 產生 6 字元隨機英數房間代碼，確保不重複。
 */
export function generateRoomCode(): string {
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
export function getRoomState(socket: Socket): GameState | null {
  const roomId = socketRoomMap.get(playerIdentity(socket));
  return roomId ? (rooms.get(roomId) ?? null) : null;
}

/**
 * 對特定房間的所有連線廣播事件。
 * 等同於 io.to(roomId).emit(...)，方便統一呼叫。
 */
export function emitToRoom(roomId: string, event: string, ...args: unknown[]): void {
  io.to(roomId).emit(event, ...args);
  if (event === 'gameStateUpdate') schedulePersist(roomId);
}

// ============================================================
// 房間存檔與還原（伺服器重啟不丟遊戲）
// ============================================================

/** 正式環境（Railway）或指定 STATE_DIR／PERSIST_ROOMS=1 才存檔；測試與本機開發預設不寫檔。 */
export const PERSIST_ENABLED = process.env.PERSIST_ROOMS !== '0'
  && Boolean(process.env.STATE_DIR || process.env.RAILWAY_ENVIRONMENT || process.env.PERSIST_ROOMS === '1');
export const PERSIST_DEBOUNCE_MS = 400;
export const persistTimers = new Map<string, NodeJS.Timeout>();
export let restoredRoomCount = 0;

/** 靜止點：沒有人在行動、沒有決策、舞台或發薪進行中；只在這時存檔，還原後一定一致。 */
export function isQuiescent(gs: GameState): boolean {
  return !gs.turnInProgress && !gs.decisionPhase && !gs.facilitatorScene && !gs.globalPaydayInProgress;
}

export function schedulePersist(roomId: string): void {
  if (!PERSIST_ENABLED || persistTimers.has(roomId)) return;
  const timer = setTimeout(() => { persistTimers.delete(roomId); persistRoomNow(roomId); }, PERSIST_DEBOUNCE_MS);
  timer.unref?.();
  persistTimers.set(roomId, timer);
}

export function persistRoomNow(roomId: string): boolean {
  const gs = rooms.get(roomId);
  if (!PERSIST_ENABLED || !gs || !isQuiescent(gs)) return false;
  try {
    writeSnapshot({
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      roomId,
      gameState: gs,
      credential: roomAdminCredentials.get(roomId) ?? null,
      sessions: [...playerSessions.entries()].filter(([, session]) => session.roomId === roomId),
    }, resolveStateDir());
    return true;
  } catch (error) {
    console.error(`[persist] 房間 ${roomId} 存檔失敗：`, (error as Error).message);
    return false;
  }
}

export function forgetPersistedRoom(roomId: string): void {
  const timer = persistTimers.get(roomId);
  if (timer) { clearTimeout(timer); persistTimers.delete(roomId); }
  if (!PERSIST_ENABLED) return;
  try { deleteSnapshot(roomId, resolveStateDir()); } catch (error) { console.error(`[persist] 刪除 ${roomId} 存檔失敗：`, (error as Error).message); }
}

/** 開機時還原所有存檔房間：清掉進行中的暫態、全員標為斷線、暫停遊戲等主持人按繼續。 */
export function restorePersistedRooms(): void {
  if (!PERSIST_ENABLED) return;
  const { snapshots, errors } = readSnapshots(resolveStateDir());
  for (const error of errors) console.error(`[persist] 無法還原：${error}`);
  for (const snap of snapshots) {
    const gs = snap.gameState;
    const savedAt = new Date(snap.savedAt);
    gs.turnInProgress = false;
    gs.decisionPhase = null;
    gs.facilitatorScene = null;
    gs.facilitatorSceneContext = null;
    gs.globalPaydayInProgress = false;
    gs.actionPhaseDone = new Set();
    gs.activeAuctions = {};
    gs.pendingPartnershipOffers = {};
    gs.pendingLoanOffers = {};
    gs.pendingLoanRequests = {};
    gs.adminSocketId = undefined;
    for (const player of gs.players.values()) player.isDisconnected = true;
    const running = gs.gamePhase === GamePhase.RatRace || gs.gamePhase === GamePhase.FastTrack;
    if (running) {
      // 停機期間不算遊戲時間；等主持人確認大家都回來再按繼續
      if (!gs.pausedAt) gs.pausedAt = savedAt;
      if (!gs.paydayPausedAt) gs.paydayPausedAt = savedAt;
      gs.restoredAt = snap.savedAt;
      queueSecondLifeCandidates(gs);
    }
    rooms.set(snap.roomId, gs);
    if (snap.credential) roomAdminCredentials.set(snap.roomId, snap.credential);
    for (const [playerId, session] of snap.sessions) playerSessions.set(playerId, { ...session, socketId: '' });
    scheduleEmptyRoomCleanup(snap.roomId);
    restoredRoomCount += 1;
    console.log(`[persist] 已還原房間 ${snap.roomId}（${gs.players.size} 位玩家，第 ${gs.turnNumber} 輪，存檔時間 ${snap.savedAt}）`);
  }
}

/** 部署或關機時（SIGTERM）把每個房間最後的靜止狀態寫下來再離開 */
export function flushAllRoomsAndExit(signal: string): void {
  let saved = 0;
  for (const roomId of rooms.keys()) if (persistRoomNow(roomId)) saved += 1;
  if (PERSIST_ENABLED) console.log(`[persist] 收到 ${signal}，已存檔 ${saved}/${rooms.size} 個房間`);
  process.exit(0);
}
process.once('SIGTERM', () => flushAllRoomsAndExit('SIGTERM'));
process.once('SIGINT', () => flushAllRoomsAndExit('SIGINT'));

/**
 * 向當前玩家發送落地通知，並同時廣播給全房（供大螢幕顯示）。
 */
export type BoardNotice = { playerId: string; playerName: string; title: string; description: string };
export const boardNotices = new WeakMap<GameState, BoardNotice[]>();

export function enqueueBoardNotice(gs: GameState, notice: BoardNotice): void {
  const queue = boardNotices.get(gs) ?? [];
  queue.push(notice);
  boardNotices.set(gs, queue);
}

export async function readBoardNotices(gs: GameState): Promise<void> {
  while (!gs.facilitatorScene && !gs.decisionPhase && gs.gamePhase !== GamePhase.GameOver) {
    const notice = boardNotices.get(gs)?.shift();
    if (!notice) return;
    const context = beginHostDecisionPhase(gs, { id: notice.playerId, name: notice.playerName }, 'reading', notice.title, notice.description);
    // 主持人可設定落格說明自動放行；主持人先按「繼續」時 waiter 已被移除，計時器不會重複放行
    if (gs.readingAutoContinueMs > 0) {
      setTimeout(() => {
        const waiter = decisionReleaseWaiters.get(gs.gameId);
        if (waiter?.phaseId === context.phaseId) waiter.release();
      }, gs.readingAutoContinueMs);
    }
    await waitForHostRelease(gs, context);
  }
}

export function emitCellEvent(
  socket: import('socket.io').Socket,
  roomId: string,
  playerName: string,
  cellName: string,
  message: string
): void {
  emitClient(socket, 'squareLandingNotice', { cellName, message });
  const gs = rooms.get(roomId);
  if (gs?.turnInProgress) {
    enqueueBoardNotice(gs, { playerId: playerIdentity(socket), playerName, title: cellName, description: message });
    return;
  }
  io.to(roomId).emit('cellEventBroadcast', {
    playerId: playerIdentity(socket), playerName, cellName, message, ts: Date.now(),
  });
}

// ============================================================
// 事件日誌輔助
// ============================================================

/**
 * 計算玩家當前淨資產（資產市值 - 負債餘額）。
 */
export function calcNetWorth(p: Player): number {
  const assetValue = p.assets.reduce((s, a) => s + (a.currentValue ?? a.cost), 0);
  const liabilityTotal = p.liabilities.reduce((s, l) => s + l.totalDebt, 0);
  return p.cash + assetValue - liabilityTotal;
}

// ============================================================
// 自動難度導演
// ============================================================

export const ADAPTIVE_EVENT_COOLDOWN_PAYDAYS = 2;


/**
 * 「強制開始」時為未完成 Pre-20 的玩家自動補齊全部流程：
 *   1. 若沒投胎：隨機抽社會階層、套用 cash bonus 與 growth points
 *   2. 若沒分配成長點：依預設比例（學業 40% / 體能 30% / 社交 20% / 資源 10%）自動配
 *   3. 若沒選職業：隨機分配 E 象限職業，注入薪資與起始現金
 *
 * 此函數會直接修改 player 並 emit 通知，呼叫方僅需在最後一次 emit gameStateUpdate。
 */
export function autoCompletePre20(player: Player, gs: GameState, roomId: string): void {
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
      // 開局租屋：職業的房貸數字是月租；買房後才有房貸
      player.expenses.rent = chosen.startingHomeMortgage;
      player.expenses.homeMortgagePayment = 0;
      player.housing = 'rent';
      player.expenses.carLoanPayment = chosen.startingCarLoan;
      player.expenses.creditCardPayment = chosen.startingCreditCard;
      player.expenses.otherExpenses = chosen.startingOtherExpenses;
      syncHouseholdLoans(player);
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
 * 在玩家事件日誌中記錄一筆快照。
 * 應在事件「執行後」呼叫，cashBefore/cashflowBefore 由呼叫者在執行前捕捉。
 */
export function logPlayerEvent(
  player: Player,
  gs: GameState,
  type: PlayerEventType,
  description: string,
  cashBefore: number,
  cashflowBefore: number,
  netWorthBefore: number,
  meta?: Record<string, unknown>,
  ageOverride?: number,
): void {
  const event: PlayerEvent = {
    age: ageOverride ?? Math.round(Math.max(player.startAge ?? 20, getCurrentAge(gs)) * 10) / 10,
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


export type MarriageSceneRoute = 'window' | 'love' | 'matchmaker' | 'arranged';

export function getPlayerAge(gs: GameState, player: Player): number {
  return Math.max(player.startAge ?? 20, getCurrentAge(gs));
}


// ============================================================
// 序列化工具
// ============================================================


export function executeTravelAction(socket: Socket, gs: GameState, player: Player, destinationId: string): void {
  const cashBefore = player.cash;
  const cashflowBefore = player.monthlyCashflow;
  const netWorthBefore = calcNetWorth(player);
  const result = goTravel(player, destinationId);
  emitClient(socket, 'travelResult', result);

  if (!result.success) return;

  logPlayerEvent(
    player,
    gs,
    'travel',
    `前往「${result.destination?.name ?? destinationId}」（體驗值 +${result.lifeExperienceGained}）`,
    cashBefore,
    cashflowBefore,
    netWorthBefore,
    { lifeExpGained: result.lifeExperienceGained },
  );
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

export function executeSocialAction(socket: Socket, gs: GameState, player: Player): void {
  const currentAge = getCurrentAge(gs);
  const result = attendSocialEvent(player, currentAge);
  emitClient(socket, 'socialEventResult', result);

  if (!result.success) return;

  const { RELATIONSHIP_MARRIAGE_THRESHOLD: threshold } = require('./gameConfig');
  if (
    result.newRelationshipPoints !== undefined &&
    result.newRelationshipPoints >= threshold &&
    !player.isMarried
  ) {
    emitClient(socket, 'marriageThresholdReached', {
      playerId: player.id,
      relationshipPoints: result.newRelationshipPoints,
      threshold,
    });
  }
  emitToRoom(gs.gameId, 'cellEventBroadcast', {
    playerId: player.id,
    playerName: player.name,
    cellName: '關係經營',
    message: `💑 ${player.name} 投入一場深度交流，關係經營值 +${result.drsGained ?? 0}，目前 ${result.newRelationshipPoints ?? player.relationshipPoints}/${threshold}${(result.newRelationshipPoints ?? 0) >= threshold ? '，已達婚姻門檻！' : ''}`,
    ts: Date.now(),
  });
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function applyPartnershipBenefits(gs: GameState, offeror: Player, target: Player): number {
  offeror.lifeExperience += 15;
  target.lifeExperience += 15;

  const passiveSum = offeror.totalPassiveIncome + target.totalPassiveIncome;
  const dividend = Math.max(3_000, Math.min(50_000, Math.round(passiveSum * 0.03)));
  offeror.cash += dividend;
  target.cash += dividend;

  logPlayerEvent(
    offeror, gs, 'asset_buy',
    `🤝 與 ${target.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
    offeror.cash - dividend, offeror.monthlyCashflow, calcNetWorth(offeror) - dividend,
    { partnerId: target.id, partnerName: target.name, dividend },
  );
  logPlayerEvent(
    target, gs, 'asset_buy',
    `🤝 與 ${offeror.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
    target.cash - dividend, target.monthlyCashflow, calcNetWorth(target) - dividend,
    { partnerId: offeror.id, partnerName: offeror.name, dividend },
  );

  emitToRoom(gs.gameId, 'partnershipAccepted', {
    offerorId: offeror.id,
    offerorName: offeror.name,
    targetId: target.id,
    targetName: target.name,
    dividend,
    passiveSum,
  });
  return dividend;
}

/**
 * 進修者以少一次人生行動換取較高起點。這裡直接自動交棒，避免玩家還要
 * 在手機按一次擲骰才知道本輪被跳過。回合仍視為完成，會正常計入全體年齡。
 */
export function skipCurrentEducationTurns(gs: GameState): void {
  let safety = gs.playerOrder.length;

  while (safety > 0) {
    const player = gs.players.get(gs.currentPlayerTurnId);
    if (!player?.isAlive || !consumeEducationTurn(player)) return;

    getPlayerSocket(player.id)?.emit('turnSkipped', {
      playerId: player.id,
      reason: 'education',
      turnsRemaining: player.educationTurnsToSkip,
    });
    emitToRoom(gs.gameId, 'educationTurnSkipped', {
      playerId: player.id,
      playerName: player.name,
      careerStartAge: player.startAge,
    });
    emitToRoom(gs.gameId, 'cellEventBroadcast', {
      playerId: player.id,
      playerName: player.name,
      cellName: '繼續進修',
      message: `📚 ${player.name} 正在完成進修，本人生回合暫停行動；下次將從 ${player.startAge} 歲職涯起點出發。`,
      ts: Date.now(),
    });
    console.log(`[education] ${player.name}（${gs.gameId}）完成進修延後回合，自動交棒`);

    gs.advanceToNextTurn();
    safety -= 1;
  }
}

/**
 * 推進回合的唯一入口。完成第三個完整桌次輪後，立即鎖住擲骰並啟動
 * 全體季度發薪；實際規劃仍由主持人逐位收束。
 */
/**
 * 每輪開始的「全體行動時間」：所有人同時在手機處理旅遊、聯誼、保險、投資與借還款。
 * 全員按「完成」或主持人按結束後才開始擲骰。固定班表職業的活動額度在此重置為每輪 1 次。
 */
export async function runActionPhase(gs: GameState): Promise<void> {
  const roomId = gs.gameId;
  gs.actionPhaseRound = gs.turnNumber;
  gs.actionPhaseDone = new Set();
  for (const player of gs.players.values()) {
    if (player.isAlive && !player.profession.hasFlexibleSchedule) player.actionTokensThisPayday = 1;
  }
  const roundLabel = gs.finalRoundStarted ? '最後一輪' : `第 ${gs.turnNumber + 1} 輪`;
  const context = beginHostDecisionPhase(
    gs,
    { id: '__all_players__', name: '全體玩家' },
    'actions',
    `${roundLabel}全體行動時間`,
    '所有人同時在手機處理旅遊、聯誼、保險、投資與借還款；完成後按「我這輪完成了」，全員完成就開始擲骰。',
  );
  emitToRoom(roomId, 'actionPhaseStarted', { phaseId: context.phaseId, round: gs.turnNumber + 1 });
  await waitForHostRelease(gs, context);
  gs.actionPhaseDone = new Set();
  emitToRoom(roomId, 'actionPhaseEnded', { phaseId: context.phaseId });
  emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  continueAfterTurnAdvance(gs);
}

// ============================================================
// 65 歲人生轉折舞台
// ============================================================


/** 全體在線存活玩家都按了完成 → 自動結束行動時間。 */
export function maybeCompleteActionPhase(gs: GameState): void {
  const phase = gs.decisionPhase;
  if (!phase || phase.playerId !== '__all_players__' || (phase.kind !== 'actions' && phase.kind !== 'payday')) return;
  const waiting = [...gs.players.values()].filter((p) => p.isAlive && !p.isDisconnected && !gs.actionPhaseDone.has(p.id));
  if (waiting.length > 0) return;
  phase.submitted = true;
  const waiter = decisionReleaseWaiters.get(gs.gameId);
  if (waiter?.phaseId === phase.id) waiter.release();
}

export function continueAfterTurnAdvance(gs: GameState): void {
  if (gs.gamePhase === GamePhase.GameOver || gs.facilitatorScene) return;
  if (gs.decisionPhase) return;
  if (boardNotices.get(gs)?.length) {
    void readBoardNotices(gs).then(() => continueAfterTurnAdvance(gs)).catch(error => console.error('[boardReading]', error));
    return;
  }
  if (tryOpenSecondLife(gs)) return;
  if ((secondLifeQueue.get(gs)?.length ?? 0) > 0) return;
  if (gs.finalRoundStarted && gs.finalRoundPendingPlayerIds.length === 0) {
    finishGame(gs, 'finalRoundComplete');
    return;
  }

  if (!gs.finalRoundStarted && gs.turnNumber >= FINAL_ROUND_START_COMPLETED_ROUNDS) {
    startFinalRound(gs);
    return;
  }

  if (
    gs.globalPaydayPending &&
    !gs.globalPaydayInProgress &&
    !gs.finalRoundStarted
  ) {
    gs.globalPaydayInProgress = true;
    void runGlobalPayday(gs).then(() => continueAfterTurnAdvance(gs)).catch((error) => {
      console.error(`[globalPayday] 房間 ${gs.gameId} 季度結算失敗：`, error);
      gs.globalPaydayPending = false;
      gs.globalPaydayInProgress = false;
      gs.decisionPhase = null;
      if (gs.pausedAt !== null) resumeGameClock(gs);
      emitToRoom(gs.gameId, 'globalPaydayFailed', { message: '季度發薪發生錯誤，已解除流程鎖定。' });
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    });
    return;
  }

  // 65 歲人生轉折（在發薪之後、行動時間之前，逐位開舞台）
  queueRetirementCandidates(gs);
  if (tryOpenRetirementScene(gs)) return;

  // 每輪開始：全體行動時間（發薪、舞台、第二人生都處理完之後才開）
  if (gs.actionPhaseEnabled && gs.actionPhaseRound !== gs.turnNumber && !gs.turnInProgress && !gs.globalPaydayInProgress) {
    void runActionPhase(gs).catch((error) => console.error(`[actionPhase] 房間 ${gs.gameId}：`, error));
  }
}

export function advanceTurn(gs: GameState): void {
  if (gs.gamePhase === GamePhase.GameOver) return;
  gs.advanceToNextTurn();
  syncPlayerAges(gs);
  schedulePaydayIfDue(gs);
  skipCurrentEducationTurns(gs);
  continueAfterTurnAdvance(gs);
  tryOpenWorldEvent(gs);
}

export function getQuarterTravelDestinations(player: Player): Array<{
  id: string; name: string; region: string; cost: number; lifeExpGained: number; salaryPenalty: number;
}> {
  const { TRAVEL_DESTINATIONS } = require('./gameConfig') as typeof import('./gameConfig');
  return TRAVEL_DESTINATIONS
    .filter((destination) => {
      if (destination.tier === 'both') return true;
      return destination.tier === (player.isInFastTrack ? 'outer' : 'inner');
    })
    .filter(() => player.stats.health >= HP_ACTIVITY_THRESHOLDS.travel)
    .map((destination) => ({
      id: destination.id,
      name: destination.name,
      region: destination.region,
      cost: destination.cost,
      lifeExpGained: destination.lifeExpGained,
      salaryPenalty: destination.salaryPenalty,
    }));
}

export type SecondLifeEntry = { playerId: string; eligibility: ReturnType<typeof evaluateSecondLifeEligibility> };
export const secondLifeQueue = new WeakMap<GameState, SecondLifeEntry[]>();


/** 空檔時（沒人在行動、沒有決策或舞台）到期就直接發薪；每 5 秒檢查一次。 */
setInterval(() => {
  for (const gs of rooms.values()) {
    if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) continue;
    if (gs.turnInProgress || gs.decisionPhase || gs.facilitatorScene || gs.globalPaydayInProgress) continue;
    if (gs.globalPaydayPending || schedulePaydayIfDue(gs)) {
      continueAfterTurnAdvance(gs);
    }
  }
}, 5_000).unref();


// ============================================================
// Socket.io 事件處理
// ============================================================

// A character keeps its identity when the transport reconnects. Tokens never enter public game state.
export const playerSessions = new Map<string, { roomId: string; token: string; socketId: string; setupStep?: string }>();
export const pendingSubmissions = new Map<string, { phaseId: string; event: string; submit: (value: unknown) => void }>();
export const privateReplay = new Map<string, Map<string, unknown[]>>();
export const replayEvents = new Set(['paydayPlanningRequired', 'fastTrackDealCard', 'charityCardPending',
  'techStartupOffer', 'fastTrackPartnershipOptions', 'fastTrackPartnershipInvitation', 'fastTrackTravelOptions',
  'crisisNTSkipAvailable', 'crisisRescueRequired', 'dealCardsDrawn', 'relationshipCardDrawn']);
export function playerIdentity(socket: Socket): string { return socket.data.playerId ?? socket.id; }
export function getPlayerSocket(id: string): Socket | undefined {
  return io.sockets.sockets.get(playerSessions.get(id)?.socketId ?? id);
}
export function emitClient(socket: Socket, event: string, ...args: unknown[]) {
  const id = playerIdentity(socket);
  if (socket.data.playerId) {
    if (replayEvents.has(event)) {
      if (!privateReplay.has(id)) privateReplay.set(id, new Map());
      privateReplay.get(id)!.set(event, args);
    }
    io.to(id).emit(event, ...args);
  } else socket.emit(event, ...args);
}
export const financialActions = new Set(['sellAsset', 'buyInsurance', 'cancelInsurance',
  'takeEmergencyLoan', 'investStockDCA', 'investBond', 'buyHome', 'takeLeverageLoan', 'repayLoan', 'buyFranchise',
  'partnershipOffer', 'partnershipResponse', 'loanOffer', 'loanResponse', 'loanRequest', 'loanRequestResponse',
  'goTravel', 'attendSocialEvent']);
export const setupActions = new Set(['rollSocialClass', 'allocateGrowthStats', 'continueEducation', 'selectQuadrant']);

io.on('connection', (socket: Socket) => {
  function onSafe<T extends unknown[]>(event: string, handler: (...args: T) => unknown) {
    const report = (error: unknown) => {
      console.error(`[socket:${event}] handler failed`, error instanceof Error ? error.message : 'unknown error');
      const gs = getRoomState(socket);
      if (gs && gs.pausedAt === null) pauseGameClock(gs);
      emitClient(socket, 'error', { message: '操作未能完成，遊戲已暫停。請主持人確認狀態後再繼續。' });
      if (gs) emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    };
    socket.on(event, (...args: T) => {
      try {
        Promise.resolve(handler(...args)).then(() => {
          if (!financialActions.has(event) && !['setPlayerStats', 'resolveFacilitatorScene', 'closeFacilitatorScene', 'triggerRelationship', 'triggerSpecialAuction'].includes(event)) return;
          const gs = getRoomState(socket);
          if (!gs || gs.turnInProgress || gs.globalPaydayInProgress) return;
          queueSecondLifeCandidates(gs);
          tryOpenSecondLife(gs);
        }).catch(report);
      } catch (error) { report(error); }
    });
  }
  socket.use(([event, payload], next) => {
    if (socket.data.playerId && ['adminLogin', 'createRoom', 'joinDisplay'].includes(event)) {
      emitClient(socket, 'error', { message: '玩家頁不能切換為主持人或大螢幕，請另開頁面。' }); return;
    }
    if (!validateSocketPayload(event, payload)) {
      socket.emit(event === 'playerRejoin' ? 'rejoinFailed' : 'error', { message: event === 'bidDeal' ? '出價必須為有效正整數。' : '資料格式不正確，請重新整理後再試。' });
      return;
    }
    const gs = getRoomState(socket);
    const player = gs?.players.get(playerIdentity(socket));
    // 危機自救階段：本人可賣資產、申請應急借款，其他財務操作照常封鎖
    const rescueAllowed = Boolean(gs && player?.isAlive && gs.decisionPhase?.rescue && gs.decisionPhase.playerId === player.id
      && ['sellAsset', 'takeEmergencyLoan'].includes(event));
    // 全體行動時間：所有存活玩家都可自由操作
    const actionsOpen = Boolean(gs && player?.isAlive && gs.decisionPhase?.kind === 'actions' && !gs.facilitatorScene);
    if (financialActions.has(event) && !rescueAllowed && !actionsOpen && (!gs || !player?.isAlive ||
      ![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase) || gs.pausedAt !== null ||
      gs.decisionPhase || gs.facilitatorScene || gs.turnInProgress || gs.globalPaydayPending || gs.globalPaydayInProgress)) {
      emitClient(socket, 'error', { message: '目前不是自由操作時間，請等待主持人完成決策或恢復遊戲。' });
      return;
    }
    if (setupActions.has(event) && (!gs || gs.gamePhase !== GamePhase.Pre20 || !player || player.pre20Done)) {
      emitClient(socket, 'error', { message: '目前無法修改出生設定。' }); return;
    }
    next();
  });
  for (const event of ['submitCardDecision', 'submitPaydayPlan']) {
    onSafe(event, (payload: { phaseId: string }) => {
      const pending = pendingSubmissions.get(playerIdentity(socket));
      if (!pending || pending.event !== event || pending.phaseId !== payload.phaseId) {
        emitClient(socket, 'error', { message: '此決策已結束，請依目前畫面操作。' }); return;
      }
      pending.submit(payload);
    });
  }
  console.log(`[連線] 新客戶端連線：${playerIdentity(socket)}`);

  // 各功能的事件處理（handlers/*.ts）
  registerRoomHandlers(socket, onSafe);
  registerTurnHandlers(socket, onSafe);
  registerCareerHandlers(socket, onSafe);
  registerFinanceHandlers(socket, onSafe);
  registerWorldEventHandlers(socket, onSafe);
  registerSetupHandlers(socket, onSafe);
  registerSocialHandlers(socket, onSafe);
  registerHostHandlers(socket, onSafe);
  registerSceneHandlers(socket, onSafe);
  registerReviewHandlers(socket, onSafe);
});

// ============================================================
// 發薪日規劃輔助函數
// ============================================================

export interface HostDecisionContext {
  phaseId: string;
  wasAlreadyPaused: boolean;
}


// ============================================================
// 卡牌決策等待輔助
// ============================================================


// ============================================================
// 格子落點處理器
// ============================================================

// ============================================================

// ============================================================
// 發薪日規劃選項計算輔助
// ============================================================


// ============================================================
// 啟動伺服器
// ============================================================

restorePersistedRooms();

httpServer.listen(PORT, () => {
  console.log(`====================================`);
  console.log(`  百歲人生伺服器已啟動`);
  console.log(`  監聽端口：${PORT}`);
  console.log(`  支援多房間並行場次`);
  console.log(`====================================`);
});
