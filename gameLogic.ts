import { Player, GameState, MarketEventType, Asset, Liability, SocialClass, LifeStage, GrowthStats } from './gameDataModels';
import {
  RAT_RACE_TRACK_SIZE, PAYDAY_LOCATIONS, PROFESSIONS, PROFESSION_MAP,
  CREDIT_SCORE_MIN, CREDIT_SCORE_MAX,
  CREDIT_CHANGE_REPAY, CREDIT_CHANGE_FULL_REPAY,
  CREDIT_CHANGE_EMERGENCY_LOAN, CREDIT_CHANGE_NEGATIVE_CF,
  INSURANCE_ACTIVATION_FEE,
  getLoanRate, getLoanLimit,
  SOCIAL_CLASS_CONFIG, PROFESSION_THRESHOLDS,
  EDUCATION_LOAN_AMOUNT, EDUCATION_LOAN_MONTHLY, EDUCATION_FQ_BONUS,
  LIFE_EXP,
  LIFE_STAGE_AGE_RANGES, SALARY_MULT_BY_STAGE,
  FAST_TRACK_ASSET_APPRECIATION_RATE,
  FAST_TRACK_TRACK_SIZE, FAST_TRACK_PAYDAY_BONUS_RATE,
  GAME_END_AGE, GAME_START_AGE,
  BEDRIDDEN_DEATH_PROBABILITY,
  TRAVEL_COST, TRAVEL_SALARY_PENALTY,
  HP_ACTIVITY_THRESHOLDS,
  SOCIAL_EVENT_COST, SOCIAL_EVENT_DRS_MIN, SOCIAL_EVENT_DRS_MAX, SOCIAL_EVENT_DRS_PEAK_MAX,
  RELATIONSHIP_MARRIAGE_THRESHOLD, HOST_ACTIVATION_DRS_BONUS,
  ARRANGED_MARRIAGE_BASE_COST, ARRANGED_MARRIAGE_COST_STEP, ARRANGED_MARRIAGE_MAX_COST,
  MARRIAGE_BONUS_BY_TYPE,
  LIFE_EVENT_WINDOWS,
  LEGACY_FULL_SCORE_AMOUNT,
  TRAVEL_DESTINATIONS,
} from './gameConfig';
import { FAST_TRACK_BOARD, FAST_TRACK_PAYDAY_LOCATIONS } from './gameCards';
import { AdminGlobalEvent } from './adminEvents';
import { applyAnnualTax, AnnualTaxResult } from './taxSystem';
import { applyHPDecay, applyNTAutoGrowth } from './statsSystem';

// ============================================================
// 回傳型別
// ============================================================

export interface MoveResult {
  player: Player;
  /**
   * 本次移動路徑中「路過」或「停在」的所有發薪日格位置。
   * 陣列長度為 0 表示本次移動未經過任何發薪日。
   * 長度 > 1 表示一次移動路過多個發薪日（例如步數超過一圈）。
   * 呼叫方應對此陣列中每個元素呼叫一次 triggerPayday。
   */
  passedPaydays: number[];
  /**
   * 本次移動是否需要發薪日規劃階段（passedPaydays.length > 0 時為 true）。
   * socketServer 據此決定是否發送 paydayPlanningRequired 事件並等待玩家回應。
   */
  requiresPaydayPlanning: boolean;
}

/**
 * checkAndApplyAnnualTax 的回傳型別。
 * taxResult 為 null 表示尚未達到年度結算時機。
 */
export interface AnnualTaxCheckResult {
  triggered: boolean;
  taxResult: AnnualTaxResult | null;
}

// ============================================================
// 動態薪資計算（S 象限）
// ============================================================

/**
 * 計算玩家本次發薪日的實際薪資收入。
 *
 * E 象限（fixed）：直接回傳 startingSalary，永遠不變。
 * S 象限（random）：在 minSalary–maxSalary 之間均勻隨機取值，代表接案月份的不穩定性。
 * S 象限（nt_driven）：收入 = 人脈值 × salaryPerNT，體現「人脈就是客戶」。
 * S 象限（sk_driven）：收入 = startingSalary + 技能值 × salaryPerSK，技能越精費用越高。
 * B/I 象限通常 startingSalary = 0（收入來自資產現金流），salaryType 為 'fixed'。
 *
 * @param player 玩家物件（讀取 profession 與 stats，不修改）
 * @returns 本次發薪日應計入的薪資金額
 */
export function calculateCurrentSalary(player: Player): number {
  const { profession, stats } = player;
  switch (profession.salaryType) {
    case 'fixed':
      return profession.startingSalary;
    case 'random': {
      const min = profession.minSalary ?? 0;
      const max = profession.maxSalary ?? profession.startingSalary;
      return min + Math.round(Math.random() * (max - min));
    }
    case 'nt_driven':
      return Math.round(stats.network * (profession.salaryPerNT ?? 400));
    case 'sk_driven':
      return profession.startingSalary +
        Math.round(stats.careerSkill * (profession.salaryPerSK ?? 50));
  }
}

// ============================================================
// 核心動作函數
// ============================================================

/**
 * 擲骰子。
 * @param diceCount 骰子數量（1 或 2）
 * @returns 各骰子點數之總和
 */
export function rollDice(diceCount: number): number {
  let total = 0;
  for (let i = 0; i < diceCount; i++) {
    total += Math.floor(Math.random() * 6) + 1;
  }
  return total;
}

/**
 * 移動玩家並偵測路徑上的發薪日。
 *
 * 採用取餘數(%)處理地圖循環，同時檢查移動路徑中所有經過的格子，
 * 而不只是終點，確保「路過發薪日」也能正確觸發。
 *
 * @param player 當前玩家（直接修改並回傳同一物件）
 * @param steps  移動步數（來自 rollDice 的結果）
 * @returns MoveResult，含更新位置的玩家與路過的發薪日格位置陣列
 */
export function movePlayer(player: Player, steps: number): MoveResult {
  if (player.isInFastTrack) {
    // ── 外圈移動 ──────────────────────────────────────────────
    const oldPos = player.fastTrackPosition;
    const newPos = (oldPos + steps) % FAST_TRACK_TRACK_SIZE;
    player.fastTrackPosition = newPos;

    const passedPaydays = (FAST_TRACK_PAYDAY_LOCATIONS as number[]).filter((pos) =>
      newPos < oldPos
        ? pos > oldPos || pos <= newPos
        : pos > oldPos && pos <= newPos
    );
    return { player, passedPaydays, requiresPaydayPlanning: passedPaydays.length > 0 };
  }

  // ── 內圈移動（老鼠賽跑）────────────────────────────────────
  const oldPos = player.currentPosition;
  const newPos = (oldPos + steps) % RAT_RACE_TRACK_SIZE;

  player.currentPosition = newPos;

  // 偵測路徑中所有經過（含停在）的發薪日格
  // 有繞圈（newPos < oldPos）：pos > oldPos（出發後到圈尾） 或 pos <= newPos（新圈起點到落點）
  // 無繞圈（newPos >= oldPos）：pos > oldPos 且 pos <= newPos（直線段內）
  const passedPaydays = (PAYDAY_LOCATIONS as number[]).filter((pos) =>
    newPos < oldPos
      ? pos > oldPos || pos <= newPos
      : pos > oldPos && pos <= newPos
  );

  return { player, passedPaydays, requiresPaydayPlanning: passedPaydays.length > 0 };
}

/**
 * 發薪日結算：將玩家當月淨現金流加入手中現金，並累計發薪次數。
 *
 * 同時觸發：
 * - NT 自然成長（每 NETWORK_AUTO_GAIN_INTERVAL 次發薪日 +1）
 * - HP 自然衰退（-HP_DECAY_PER_PAYDAY），可由 maintenanceDone 旗標阻止
 *
 * 呼叫順序（每個發薪日）：
 *  1. applyPaydayPlan(player, plan) — 扣款並更新數值（含健康維護決策）
 *  2. triggerPayday(player, maintenanceDone) — 發薪 + HP 衰退 + NT 成長
 *  3. checkAndApplyAnnualTax(player) — 每 4 次觸發繳稅
 *
 * @param player          當前玩家（直接修改並回傳同一物件）
 * @param maintenanceDone 本次發薪日是否已執行健康維護（true = 阻止 HP 衰退）
 * @returns 更新後的玩家
 */
export function triggerPayday(player: Player, gameState: GameState, maintenanceDone = false): Player {
  // 計算當前人生階段，套用薪資倍率
  const currentAge = getCurrentAge(gameState);
  const stage = getLifeStage(currentAge);
  const salaryMult = SALARY_MULT_BY_STAGE[stage];

  // 裁員期間薪資計為 0，每次發薪遞減剩餘裁員發薪日
  if (player.downsizingTurnsLeft > 0) {
    player.salary = 0;
    player.downsizingTurnsLeft -= 1;
  } else if (player.profession.salaryType !== 'fixed') {
    player.salary = Math.round(calculateCurrentSalary(player) * salaryMult);
  } else {
    // fixed 薪資也套用倍率（退休/傳承期減半或歸零）
    player.salary = Math.round(player.profession.startingSalary * salaryMult);
  }

  // 旅遊請假：下次薪水打七折
  if (player.travelPenaltyRemaining > 0) {
    player.salary = Math.round(player.salary * TRAVEL_SALARY_PENALTY);
    player.travelPenaltyRemaining -= 1;
  }

  player.cash += player.monthlyCashflow;
  player.paydayCount += 1;

  if (player.monthlyCashflow < 0) {
    adjustCreditScore(player, CREDIT_CHANGE_NEGATIVE_CF);
  }

  applyHPDecay(player, maintenanceDone, stage);
  applyNTAutoGrowth(player);

  return player;
}

/**
 * 每次 triggerPayday 後呼叫，自動偵測是否達到年度繳稅時機（每 4 個發薪日一次）。
 * 若觸發，則計算並扣除年度累進稅（含撫養與保險扣除額）。
 *
 * @param player 當前玩家（若觸發繳稅則直接修改 cash）
 * @returns AnnualTaxCheckResult — triggered 是否觸發; taxResult 稅務明細（未觸發時為 null）
 */
export function checkAndApplyAnnualTax(player: Player): AnnualTaxCheckResult {
  if (player.paydayCount === 0 || player.paydayCount % 4 !== 0) {
    return { triggered: false, taxResult: null };
  }
  const taxResult = applyAnnualTax(player);
  return { triggered: true, taxResult };
}

// ============================================================
// 玩家建立
// ============================================================

/** 從職業陣列隨機抽取一個職業 */
function randomProfession() {
  return PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
}

/**
 * 建立新玩家。
 *
 * @param socketId    玩家的 Socket.io 連線 ID，作為玩家唯一識別符
 * @param playerName  玩家暱稱
 * @param professionId 選填。指定職業 ID（如 'engineer'）；未提供或 ID 不存在時隨機分配
 * @returns 初始化完成的 Player 物件
 */
export function createPlayer(
  socketId: string,
  playerName: string,
  professionId?: string
): Player {
  const profession =
    professionId !== undefined
      ? (PROFESSION_MAP.get(professionId) ?? randomProfession())
      : randomProfession();

  const player = new Player(socketId, playerName, profession);

  // B/I 象限：注入起始資產與對應負債
  if (profession.startingAssets && profession.startingAssets.length > 0) {
    profession.startingAssets.forEach((template, idx) => {
      const assetId = `start-${player.id}-${idx}`;
      const liabilityId = template.liabilityAmount
        ? `start-liability-${player.id}-${idx}`
        : undefined;

      const asset: Asset = {
        id: assetId,
        name: template.name,
        type: template.type,
        cost: template.cost,
        monthlyCashflow: template.monthlyCashflow,
        currentValue: template.currentValue,
        linkedLiabilityId: liabilityId,
      };
      player.assets.push(asset);

      if (template.liabilityAmount && liabilityId) {
        const liability: Liability = {
          id: liabilityId,
          name: template.liabilityName ?? `${template.name}貸款`,
          totalDebt: template.liabilityAmount,
          monthlyPayment:
            template.liabilityMonthlyPayment ??
            Math.round(template.liabilityAmount * 0.005),
        };
        player.liabilities.push(liability);
      }
    });
  }

  // I 象限：覆蓋 FQ 初始值
  if (profession.startingFQ !== undefined) {
    player.stats.financialIQ = profession.startingFQ;
  }

  // S 象限：初始化第一次的動態薪資
  if (profession.salaryType !== 'fixed') {
    player.salary = calculateCurrentSalary(player);
  }

  return player;
}

// ============================================================
// 全局市場事件套用
// ============================================================

/**
 * 將管理員觸發的全局市場事件套用至所有存活玩家。
 *
 * 三種效果：
 * - AssetValueChange: 指定資產類型的 currentValue 乘以 multiplier
 * - CashflowChange:   指定資產類型的 monthlyCashflow 乘以 multiplier
 * - ExpenseChange:    所有玩家的 expenses.otherExpenses 增加 flatAmount
 *
 * 同時將事件標題記錄至 gameState.marketEvents 供客戶端查看歷史。
 *
 * @param gameState 全局遊戲狀態（直接修改）
 * @param event     要套用的全局事件
 */
export function applyGlobalEvent(
  gameState: GameState,
  event: AdminGlobalEvent
): void {
  gameState.players.forEach((player) => {
    if (!player.isAlive) return;

    event.effects.forEach((effect) => {
      if (effect.type === 'AssetValueChange' && effect.targetAssetType !== undefined) {
        player.assets
          .filter((a) => a.type === effect.targetAssetType)
          .forEach((a) => {
            a.currentValue = Math.round(a.currentValue * effect.multiplier!);
          });
      }

      if (effect.type === 'CashflowChange' && effect.targetAssetType !== undefined) {
        player.assets
          .filter((a) => a.type === effect.targetAssetType)
          .forEach((a) => {
            a.monthlyCashflow = Math.round(a.monthlyCashflow * effect.multiplier!);
          });
      }

      if (effect.type === 'ExpenseChange' && effect.flatAmount !== undefined) {
        player.expenses.otherExpenses += effect.flatAmount;
      }
    });
  });

  // 將事件記錄至 gameState.marketEvents（turnsRemaining = 0 表示永久效果，不自動移除）
  gameState.marketEvents.push({
    id: event.id,
    title: event.title,
    description: event.description,
    type: inferMarketEventType(event),
    turnsRemaining: 0,
  });
}

/**
 * 根據全局事件效果推斷對應的 MarketEventType（用於 marketEvents 歷史記錄）。
 */
function inferMarketEventType(event: AdminGlobalEvent): MarketEventType {
  const hasNegativeMultiplier = event.effects.some(
    (e) => e.multiplier !== undefined && e.multiplier < 1
  );
  const hasPositiveMultiplier = event.effects.some(
    (e) => e.multiplier !== undefined && e.multiplier > 1
  );
  if (hasNegativeMultiplier) return MarketEventType.NegativeMarket;
  if (hasPositiveMultiplier) return MarketEventType.PositiveMarket;
  return MarketEventType.NegativeMarket;
}

// ============================================================
// 信用值 / 資產出售 / 保險 / 借貸
// ============================================================

export type InsuranceType = 'medical' | 'life' | 'property';

/** 調整玩家信用值，自動夾在 CREDIT_SCORE_MIN–CREDIT_SCORE_MAX 範圍內 */
export function adjustCreditScore(player: Player, delta: number): void {
  player.creditScore = Math.max(
    CREDIT_SCORE_MIN,
    Math.min(CREDIT_SCORE_MAX, player.creditScore + delta)
  );
}

// ── 出售資產 ──────────────────────────────────────────────

export interface SellAssetResult {
  success: boolean;
  message?: string;
  assetId?: string;
  proceeds?: number;
  debtSettled?: number;
  netCashChange?: number;
}

/**
 * 玩家主動出售資產。
 * - 出售收益 = asset.currentValue
 * - 若有 linkedLiabilityId：從收益中扣除對應 liability.totalDebt 並移除負債
 * - netCashChange 可為負（資產市值低於未還負債時倒貼）
 * - 信用值不受影響
 */
export function sellAsset(player: Player, assetId: string): SellAssetResult {
  const assetIndex = player.assets.findIndex((a) => a.id === assetId);
  if (assetIndex === -1) {
    return { success: false, message: `找不到資產 ID：${assetId}` };
  }

  const asset = player.assets[assetIndex];
  const proceeds = asset.currentValue;
  let debtSettled = 0;

  if (asset.linkedLiabilityId) {
    const liabIndex = player.liabilities.findIndex((l) => l.id === asset.linkedLiabilityId);
    if (liabIndex !== -1) {
      debtSettled = player.liabilities[liabIndex].totalDebt;
      player.liabilities.splice(liabIndex, 1);
    }
  }

  const netCashChange = proceeds - debtSettled;
  player.cash += netCashChange;
  player.assets.splice(assetIndex, 1);

  return { success: true, assetId, proceeds, debtSettled, netCashChange };
}

// ── 保險購買 / 取消 ──────────────────────────────────────

export interface BuyInsuranceResult {
  success: boolean;
  message?: string;
  activationFee?: number;
}

/** 購買保險：扣除啟動費並設定對應 insurance boolean 為 true */
export function buyInsurance(player: Player, type: InsuranceType): BuyInsuranceResult {
  const insuranceKey = insuranceTypeToKey(type);
  if (player.insurance[insuranceKey]) {
    return { success: false, message: `已持有${type}保險，無需重複購買。` };
  }

  const fee = INSURANCE_ACTIVATION_FEE[type] ?? 0;
  if (player.cash < fee) {
    return { success: false, message: `現金不足，啟動費為 $${fee}（現有 $${player.cash}）。` };
  }

  player.cash -= fee;
  player.insurance[insuranceKey] = true;
  return { success: true, activationFee: fee };
}

/** 取消保險：設定對應 boolean 為 false，無退費 */
export function cancelInsurance(player: Player, type: InsuranceType): void {
  player.insurance[insuranceTypeToKey(type)] = false;
}

function insuranceTypeToKey(type: InsuranceType): keyof typeof player_insurance_shape {
  const map: Record<InsuranceType, 'hasMedicalInsurance' | 'hasLifeInsurance' | 'hasPropertyInsurance'> = {
    medical:  'hasMedicalInsurance',
    life:     'hasLifeInsurance',
    property: 'hasPropertyInsurance',
  };
  return map[type];
}

// 型別輔助（僅供 insuranceTypeToKey 使用）
const player_insurance_shape = {
  hasMedicalInsurance: false,
  hasLifeInsurance: false,
  hasPropertyInsurance: false,
};

// ── 借款通用結果 ─────────────────────────────────────────

export interface LoanResult {
  success: boolean;
  message?: string;
  liabilityId?: string;
  loanType?: 'emergency' | 'leverage';
  amount?: number;
  monthlyPayment?: number;
  newCreditScore?: number;
}

// ── 應急借款 ──────────────────────────────────────────────

/**
 * 向銀行申請應急借款。
 * - 月利率與上限依玩家當前信用值決定
 * - 借款後信用值 -50
 */
export function takeEmergencyLoan(player: Player, amount: number): LoanResult {
  if (amount <= 0) {
    return { success: false, message: '借款金額必須大於 0。' };
  }
  const limit = getLoanLimit(player.creditScore);
  if (amount > limit) {
    return { success: false, message: `借款金額 $${amount} 超過目前信用等級的上限 $${limit}。` };
  }

  const rate = getLoanRate(player.creditScore);
  const monthlyPayment = Math.max(1, Math.round(amount * rate));
  const liabilityId = `emergency-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  player.liabilities.push({
    id: liabilityId,
    name: '應急銀行借款',
    totalDebt: amount,
    monthlyPayment,
  });
  player.cash += amount;
  adjustCreditScore(player, CREDIT_CHANGE_EMERGENCY_LOAN);

  return {
    success: true,
    liabilityId,
    loanType: 'emergency',
    amount,
    monthlyPayment,
    newCreditScore: player.creditScore,
  };
}

// ── 投資槓桿借款 ──────────────────────────────────────────

/**
 * 向銀行申請投資槓桿借款（需指定目標資產名稱）。
 * - 月利率 = 同信用等級應急利率 × 0.8（投資性借款優惠）
 * - 信用值不受影響
 */
export function takeLeverageLoan(
  player: Player,
  amount: number,
  targetAssetName: string
): LoanResult {
  if (amount <= 0) {
    return { success: false, message: '借款金額必須大於 0。' };
  }
  const limit = getLoanLimit(player.creditScore);
  if (amount > limit) {
    return { success: false, message: `借款金額 $${amount} 超過目前信用等級的上限 $${limit}。` };
  }

  const rate = getLoanRate(player.creditScore) * 0.8;
  const monthlyPayment = Math.max(1, Math.round(amount * rate));
  const liabilityId = `leverage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  player.liabilities.push({
    id: liabilityId,
    name: `投資槓桿借款：${targetAssetName}`,
    totalDebt: amount,
    monthlyPayment,
  });
  player.cash += amount;

  return {
    success: true,
    liabilityId,
    loanType: 'leverage',
    amount,
    monthlyPayment,
    newCreditScore: player.creditScore,
  };
}

// ── 還款 ──────────────────────────────────────────────────

export interface RepayLoanResult {
  success: boolean;
  message?: string;
  liabilityId?: string;
  amountPaid?: number;
  remainingDebt?: number;
  fullyRepaid?: boolean;
  newCreditScore?: number;
}

/**
 * 還款（部分或全額）。
 * - 實際還款額 = min(amount, player.cash, liability.totalDebt)
 * - 每次還款信用值 +15；完全清償額外 +25
 */
export function repayLoan(
  player: Player,
  liabilityId: string,
  amount: number
): RepayLoanResult {
  const liabIndex = player.liabilities.findIndex((l) => l.id === liabilityId);
  if (liabIndex === -1) {
    return { success: false, message: `找不到負債 ID：${liabilityId}` };
  }
  if (amount <= 0) {
    return { success: false, message: '還款金額必須大於 0。' };
  }
  if (player.cash <= 0) {
    return { success: false, message: '現金為 0，無法還款。' };
  }

  const liability = player.liabilities[liabIndex];
  const repayAmount = Math.min(amount, player.cash, liability.totalDebt);

  liability.totalDebt -= repayAmount;
  player.cash -= repayAmount;
  adjustCreditScore(player, CREDIT_CHANGE_REPAY);

  let fullyRepaid = false;
  if (liability.totalDebt <= 0) {
    player.liabilities.splice(liabIndex, 1);
    adjustCreditScore(player, CREDIT_CHANGE_FULL_REPAY);
    fullyRepaid = true;
  }

  return {
    success: true,
    liabilityId,
    amountPaid: repayAmount,
    remainingDebt: fullyRepaid ? 0 : liability.totalDebt,
    fullyRepaid,
    newCreditScore: player.creditScore,
  };
}

// ============================================================
// 百歲人生：時鐘驅動年齡系統
// ============================================================

/**
 * 計算玩家當前的遊戲年齡（20–100）。
 * 年齡完全由真實時間驅動，不儲存於玩家資料。
 * 暫停期間（pausedAt 非 null）年齡凍結。
 */
export function getCurrentAge(gameState: GameState): number {
  if (!gameState.gameStartTime) return GAME_START_AGE;

  const now = Date.now();
  const pauseOffset = gameState.pausedAt
    ? (now - gameState.pausedAt.getTime()) + gameState.totalPausedMs
    : gameState.totalPausedMs;

  const elapsed = now - gameState.gameStartTime.getTime() - pauseOffset;
  const ratio = Math.min(1, Math.max(0, elapsed / gameState.gameDurationMs));
  return GAME_START_AGE + ratio * (GAME_END_AGE - GAME_START_AGE);
}

/**
 * 依年齡推算人生階段（LifeStage）。
 * 由 LIFE_STAGE_AGE_RANGES 常量定義各階段邊界。
 */
export function getLifeStage(age: number): LifeStage {
  for (const [stage, [min, max]] of Object.entries(LIFE_STAGE_AGE_RANGES) as [LifeStage, [number, number]][]) {
    if (age >= min && age < max) return stage;
  }
  return LifeStage.Legacy;
}

// ============================================================
// 百歲人生：開局系統
// ============================================================

/** 隨機投胎，依權重抽取社會階層（各 25% 等機率） */
export function rollSocialClass(): SocialClass {
  const classes = Object.values(SocialClass);
  return classes[Math.floor(Math.random() * classes.length)];
}

/**
 * 套用 Pre20 成長點數分配結果至玩家的成人 stats 初始值。
 *
 * 映射規則：
 * - academic (0–10) → financialIQ (1–4，累進) + careerSkill (academic × 8)
 * - health   (0–10) → stats.health = 50 + health × 5（範圍 50–100）
 * - social   (0–10) → stats.network = 1 + Math.floor(social / 2.5)（範圍 1–5）
 * - resource (0–10) → cash bonus 已在 createPlayer 中套用，此處不重複處理
 *
 * @param player     已建立但尚未正式開局的玩家（直接修改）
 * @param growthStats Pre20 階段的最終分配結果
 */
export function applyGrowthStats(player: Player, growthStats: GrowthStats): void {
  player.growthStats = { ...growthStats };
  player.growthPointsRemaining = 0;

  // 學識映射
  const academic = Math.min(10, Math.max(0, growthStats.academic));
  player.stats.careerSkill = academic * 8;
  player.stats.financialIQ = academic >= 8 ? 3 : academic >= 5 ? 2 : 1;

  // 健康映射
  const health = Math.min(10, Math.max(0, growthStats.health));
  player.stats.health = 50 + health * 5;

  // 社交映射
  const social = Math.min(10, Math.max(0, growthStats.social));
  player.stats.network = 1 + Math.floor(social / 2.5);

  // resource 點數影響起始現金（由 createPlayer 搭配 SOCIAL_CLASS_CONFIG 處理）
}

/**
 * 查詢玩家在 20 歲職業選擇時可主動選擇的職業清單。
 *
 * 規則：
 * 1. salesperson（無底薪業務員）永遠可選。
 * 2. advancedOnly = true 的職業：必須 hasContinuedEducation = true 才開放。
 * 3. 其他職業：growthStats.academic >= academicMin 且 growthStats.social >= socialMin。
 *
 * 不在清單中的職業將由系統隨機指派（玩家無法主動選擇）。
 */
export function getAvailableProfessions(player: Player): typeof PROFESSIONS {
  return PROFESSIONS.filter((prof) => {
    if (prof.id === 'salesperson') return true;

    const threshold = PROFESSION_THRESHOLDS[prof.id];
    if (!threshold) return true; // 無門檻設定，預設可選

    if (threshold.advancedOnly && !player.hasContinuedEducation) return false;

    return (
      player.growthStats.academic >= threshold.academicMin &&
      player.growthStats.social   >= threshold.socialMin
    );
  });
}

/**
 * 玩家選擇「繼續進修」：產生學生貸款並額外提升 FQ。
 * 同時加入生命體驗值，並將 hasContinuedEducation 標記為 true。
 */
export function applyEducationLoan(player: Player): void {
  player.hasContinuedEducation = true;
  player.skipFirstPayday = true;   // 進修代價：少一回合
  player.stats.financialIQ = Math.min(10, player.stats.financialIQ + EDUCATION_FQ_BONUS);
  addLifeExperience(player, LIFE_EXP.CONTINUED_EDUCATION);

  const liabilityId = `edu-loan-${player.id}`;
  player.liabilities.push({
    id: liabilityId,
    name: '學生貸款',
    totalDebt: EDUCATION_LOAN_AMOUNT,
    monthlyPayment: EDUCATION_LOAN_MONTHLY,
  });
}

// ============================================================
// 百歲人生：生命體驗值
// ============================================================

/**
 * 增加玩家的生命體驗值（上不封頂，計入最終 Life Score）。
 * @param player 玩家
 * @param amount 加分量（使用 LIFE_EXP 常量中的值）
 */
export function addLifeExperience(player: Player, amount: number): void {
  player.lifeExperience += amount;
}

// ============================================================
// 百歲人生：FastTrack 資產增值
// ============================================================

/**
 * 套用 FastTrack 外圈每個發薪日的自動資產增值。
 * 所有資產的 currentValue 乘以 (1 + FAST_TRACK_ASSET_APPRECIATION_RATE)。
 * 收入倍率 FAST_TRACK_INCOME_MULTIPLIER 已內建於 Player.totalIncome getter（isInFastTrack = true 時自動套用）。
 *
 * 此函數在玩家處於 FastTrack 階段的每個 triggerPayday 後呼叫。
 */
export function applyFastTrackAppreciation(player: Player): void {
  const rate = FAST_TRACK_ASSET_APPRECIATION_RATE;
  player.assets.forEach((asset) => {
    asset.currentValue = Math.round(asset.currentValue * (1 + rate));
    asset.monthlyCashflow = Math.round(asset.monthlyCashflow * (1 + rate * 0.1));
  });
}

/**
 * 外圈發薪日紅利：總資產市值 × FAST_TRACK_PAYDAY_BONUS_RATE 現金直接入帳。
 * @returns 紅利金額
 */
export function applyFastTrackPaydayBonus(player: Player): number {
  const totalAssetValue = player.assets.reduce((sum, a) => sum + (a.currentValue ?? 0), 0);
  const bonus = Math.round(totalAssetValue * FAST_TRACK_PAYDAY_BONUS_RATE);
  player.cash += bonus;
  return bonus;
}

// ============================================================
// 百歲人生：最終人生評分
// ============================================================

export interface LifeScoreBreakdown {
  // 7 維度原始分（0–100，供雷達圖使用）
  netWorth:            number;
  passiveIncome:       number;
  lifeExperience:      number;
  hp:                  number;
  financialHealth:     number;  // 壽命（ageScore）
  family:              number;
  legacyScore:         number;
  // 3 大幸福指數（0–100）
  lifeExperienceIndex: number;  // 生命體驗指數（體驗+健康+壽命）
  achievementIndex:    number;  // 人生成就指數（資產+被動收入+傳承）
  relationshipIndex:   number;  // 人際關係指數（家庭+人脈NT）
  // 幸福總分與等級
  total:               number;
  grade:               string;
  achievements:        string[];
}

/**
 * 計算玩家最終的人生評分（0–100 分）。
 *
 * 各維度標準化後乘以對應權重加總：
 * - 淨資產（assets 市值總和 - 負債總額）
 * - 被動收入（totalPassiveIncome × 12 年化）
 * - 生命體驗值（200 體驗值 = 100 分）
 * - 最終健康值（直接 0–100）
 * - 家庭（婚姻 +25 分、每位子女 ×15 分，上限 100 分）
 * - 壽命（死亡時年齡越高越好）
 * - 傳承分（死後遺產淨值；留下負債 = 0 分，$100,000 淨遺產 = 100 分）
 *   若無子女，傳承分固定為 50（中性，無後代責任）。
 *   若持有壽險，負債視為被清償後計算遺產。
 *
 * @param player   結算玩家
 * @param deathAge 玩家死亡或遊戲結束時的年齡
 */
export function calculateLifeScore(player: Player, deathAge: number): LifeScoreBreakdown {
  const totalDebt = player.liabilities.reduce((s, l) => s + l.totalDebt, 0);
  const totalAssetValue = player.assets.reduce((s, a) => s + a.currentValue, 0);
  const netWorth = totalAssetValue - totalDebt;

  // 傳承分：死後淨遺產（壽險可抵消負債）
  let netEstate: number;
  if (player.insurance.hasLifeInsurance) {
    netEstate = totalAssetValue + player.cash;
  } else {
    netEstate = totalAssetValue + player.cash - totalDebt;
  }

  let legacyRaw: number;
  if (player.numberOfChildren === 0) {
    legacyRaw = 50;
  } else {
    legacyRaw = Math.min(100, Math.max(0, (netEstate / LEGACY_FULL_SCORE_AMOUNT) * 100));
  }

  // ── 7 維度原始分（0–100）──
  const netWorth_raw        = Math.min(100, Math.max(0, netWorth / 1000));
  const passiveIncome_raw   = Math.min(100, (player.totalPassiveIncome * 12) / 500);
  const lifeExperience_raw  = Math.min(100, player.lifeExperience / 2);
  const hp_raw              = player.stats.health;
  const ageScore_raw        = Math.min(100, ((deathAge - GAME_START_AGE) / (GAME_END_AGE - GAME_START_AGE)) * 100);
  const family_raw          = Math.min(100, (player.isMarried ? 25 : 0) + player.numberOfChildren * 15);
  const nt_raw              = Math.min(100, player.stats.network * 10);

  // ── 3 大幸福指數（0–100）──
  const lifeExperienceIndex = Math.round(
    lifeExperience_raw * 0.4 +
    hp_raw             * 0.4 +
    ageScore_raw       * 0.2
  );
  const achievementIndex = Math.round(
    netWorth_raw      * 0.35 +
    passiveIncome_raw * 0.35 +
    legacyRaw         * 0.30
  );
  const relationshipIndex = Math.round(
    family_raw * 0.5 +
    nt_raw     * 0.5
  );

  // ── 幸福總分（加權合算）──
  const total = Math.round(
    lifeExperienceIndex * 0.40 +
    achievementIndex    * 0.30 +
    relationshipIndex   * 0.30
  );

  // ── 等級評定 ──
  let grade: string;
  if (total >= 85)      grade = 'S';
  else if (total >= 70) grade = 'A';
  else if (total >= 55) grade = 'B';
  else if (total >= 40) grade = 'C';
  else                  grade = 'D';

  // ── 10 個人生成就徽章 ──
  const achievements: string[] = [];
  if (player.isInFastTrack)                          achievements.push('財務自由');
  if (deathAge >= 99)                                achievements.push('百歲人瑞');
  if ((player.visitedDestinations?.length ?? 0) >= 5) achievements.push('世界旅人');
  if (player.isMarried && player.numberOfChildren >= 2) achievements.push('家庭至上');
  if (player.stats.health >= 80)                     achievements.push('鐵打身體');
  if (netWorth >= 50000)                             achievements.push('智慧投資');
  if (player.totalPassiveIncome >= 3000)             achievements.push('被動收入王');
  if (totalDebt === 0)                               achievements.push('無債一身輕');
  if (netEstate >= 100000)                           achievements.push('傳承者');
  if (player.stats.network >= 8)                     achievements.push('人脈大師');

  return {
    netWorth:            Math.round(netWorth_raw),
    passiveIncome:       Math.round(passiveIncome_raw),
    lifeExperience:      Math.round(lifeExperience_raw),
    hp:                  Math.round(hp_raw),
    financialHealth:     Math.round(ageScore_raw),
    family:              Math.round(family_raw),
    legacyScore:         Math.round(legacyRaw),
    lifeExperienceIndex,
    achievementIndex,
    relationshipIndex,
    total,
    grade,
    achievements,
  };
}

// ============================================================
// 時鐘控制（由 socketServer 呼叫）
// ============================================================

/** 啟動遊戲時鐘（startGame 事件觸發時呼叫） */
export function startGameClock(gameState: GameState): void {
  gameState.gameStartTime = new Date();
  gameState.totalPausedMs = 0;
  gameState.pausedAt = null;
}

/** 暫停時鐘（主持人或結構性暫停節點觸發） */
export function pauseGameClock(gameState: GameState): void {
  if (gameState.pausedAt !== null) return; // 已在暫停中，忽略
  gameState.pausedAt = new Date();
}

/** 恢復時鐘（主持人或玩家全員確認後觸發） */
export function resumeGameClock(gameState: GameState): void {
  if (gameState.pausedAt === null) return; // 未暫停，忽略
  gameState.totalPausedMs += Date.now() - gameState.pausedAt.getTime();
  gameState.pausedAt = null;
}

// ============================================================
// HP 老化與旅遊系統
// ============================================================

export interface GoTravelResult {
  success: boolean;
  message: string;
  lifeExperienceGained?: number;
  destination?: { name: string; region: string; statEffect?: Record<string, number | boolean> };
}

/**
 * 玩家主動執行旅遊行動（不占回合）。
 *
 * @param player 玩家物件（直接修改）
 * @param destinationId 目的地 ID（來自 TRAVEL_DESTINATIONS）
 * @returns GoTravelResult
 */
export function goTravel(player: Player, destinationId: string): GoTravelResult {
  const dest = TRAVEL_DESTINATIONS.find((d) => d.id === destinationId);
  if (!dest) {
    return { success: false, message: `找不到目的地「${destinationId}」。` };
  }

  // 賽道權限驗證
  if (dest.tier === 'outer' && !player.isInFastTrack) {
    return { success: false, message: `「${dest.name}」是外圈專屬目的地，需先脫出老鼠賽跑才能前往。` };
  }
  if (dest.tier === 'inner' && player.isInFastTrack) {
    // 外圈玩家也可以去內圈目的地（不限制）
  }

  if (player.isBedridden) {
    return { success: false, message: '臥床中無法出遊。' };
  }
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.travel) {
    return {
      success: false,
      message: `健康值不足（需要 ${HP_ACTIVITY_THRESHOLDS.travel}，目前 ${player.stats.health}）。`,
    };
  }
  if (player.cash < dest.cost) {
    return {
      success: false,
      message: `現金不足（需要 $${dest.cost}，目前 $${player.cash}）。`,
    };
  }
  if (!player.profession.hasFlexibleSchedule && player.actionTokensThisPayday <= 0) {
    return { success: false, message: '本發薪日已無空閒時間，無法出遊（固定班表職業每發薪日只能安排 1 次活動）。' };
  }

  player.cash -= dest.cost;
  player.stats.health = Math.max(0, player.stats.health - dest.hpCost);

  // 重複造訪：只給半數體驗值
  const alreadyVisited = player.visitedDestinations.includes(dest.id);
  const expGained = alreadyVisited ? Math.floor(dest.lifeExpGained / 2) : dest.lifeExpGained;
  player.lifeExperience += expGained;
  if (!alreadyVisited) player.visitedDestinations.push(dest.id);

  // 薪水懲罰（外圈環遊世界無懲罰）
  if (dest.salaryPenalty < 1.0) {
    player.travelPenaltyRemaining = 1;
  }

  // 特殊屬性加成
  const fx = dest.statEffect;
  if (fx) {
    if (fx.nt)  player.stats.network      = Math.min(10, player.stats.network      + fx.nt);
    if (fx.fq)  player.stats.financialIQ  = Math.min(10, player.stats.financialIQ  + fx.fq);
    if (fx.sk)  player.stats.careerSkill  = Math.min(100, player.stats.careerSkill + fx.sk);
    if (fx.hp)  player.stats.health       = Math.min(100, player.stats.health      + fx.hp);
    if (fx.legacyScore) player.legacyBonusPoints = (player.legacyBonusPoints ?? 0) + fx.legacyScore;
  }

  if (!player.profession.hasFlexibleSchedule) {
    player.actionTokensThisPayday -= 1;
  }

  return {
    success: true,
    message: `前往「${dest.name}」！獲得 ${expGained} 點生命體驗值${alreadyVisited ? '（重複造訪，減半）' : ''}。`,
    lifeExperienceGained: expGained,
    destination: {
      name: dest.name,
      region: dest.region,
      statEffect: fx ? (Object.fromEntries(Object.entries(fx).filter(([, v]) => v !== false)) as Record<string, number | boolean>) : undefined,
    },
  };
}

/**
 * 臥床玩家每回合 30% 機率自然死亡。
 *
 * 應在 playerRoll 時對 isBedridden = true 的玩家呼叫（代替正常移動）。
 *
 * @param player 玩家物件（若死亡，呼叫方負責執行 handlePlayerDeath 流程）
 * @returns true = 本次觸發死亡
 */
export function checkBedriddenDeath(player: Player): boolean {
  return Math.random() < BEDRIDDEN_DEATH_PROBABILITY;
}

// ============================================================
// 婚姻系統（深度關係經營值 DRS）
// ============================================================

/**
 * 計算買賣婚姻的費用（隨年齡遞增）。
 * 費用 = BASE_COST + (currentAge - 20) × COST_STEP，上限 MAX_COST。
 */
export function getArrangedMarriageCost(currentAge: number): number {
  const cost = ARRANGED_MARRIAGE_BASE_COST + (currentAge - 20) * ARRANGED_MARRIAGE_COST_STEP;
  return Math.min(cost, ARRANGED_MARRIAGE_MAX_COST);
}

export interface AttendSocialEventResult {
  success: boolean;
  message: string;
  drsGained?: number;
  newRelationshipPoints?: number;
  justActivated?: boolean;  // 本次呼叫自動啟動了關係路徑
}

/**
 * 玩家主動參加聯誼活動，累積深度關係經營值（DRS）。
 *
 * 若 relationshipActive = false，系統自動將其啟動（首次主動聯誼即開啟路徑）。
 * DRS 在婚姻黃金期（25–40 歲）內有更高的加成上限。
 *
 * @param player     玩家物件（直接修改）
 * @param currentAge 當前遊戲年齡
 */
export function attendSocialEvent(player: Player, currentAge: number): AttendSocialEventResult {
  if (player.isMarried) {
    return { success: false, message: '已婚，無需參加聯誼活動。' };
  }
  if (player.isBedridden) {
    return { success: false, message: '臥床中無法參加聯誼活動。' };
  }
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.socialEvent) {
    return {
      success: false,
      message: `健康值不足（需要 ${HP_ACTIVITY_THRESHOLDS.socialEvent}，目前 ${player.stats.health}）。`,
    };
  }
  if (player.cash < SOCIAL_EVENT_COST) {
    return { success: false, message: `現金不足（需要 $${SOCIAL_EVENT_COST}）。` };
  }
  // 固定行程職業：每發薪日只能進行 1 次選擇性活動
  if (!player.profession.hasFlexibleSchedule && player.actionTokensThisPayday <= 0) {
    return { success: false, message: '本發薪日已無空閒時間，無法參加聯誼活動（固定班表職業每發薪日只能安排 1 次活動）。' };
  }

  player.cash -= SOCIAL_EVENT_COST;
  if (!player.profession.hasFlexibleSchedule) {
    player.actionTokensThisPayday -= 1;
  }

  // 首次主動聯誼：自動啟動關係路徑
  let justActivated = false;
  if (!player.relationshipActive) {
    player.relationshipActive = true;
    justActivated = true;
  }

  // 婚姻黃金期內 DRS 加成更高
  const marriageWindow = LIFE_EVENT_WINDOWS.marriage;
  const inPeak = currentAge >= marriageWindow.peakStart && currentAge <= marriageWindow.peakEnd;
  const maxDrs = inPeak ? SOCIAL_EVENT_DRS_PEAK_MAX : SOCIAL_EVENT_DRS_MAX;
  const drsGained = SOCIAL_EVENT_DRS_MIN + Math.floor(Math.random() * (maxDrs - SOCIAL_EVENT_DRS_MIN + 1));

  player.relationshipPoints += drsGained;

  return {
    success: true,
    message: `聯誼愉快！DRS +${drsGained}（目前：${player.relationshipPoints}）`,
    drsGained,
    newRelationshipPoints: player.relationshipPoints,
    justActivated,
  };
}

/**
 * 主持人觸發「邂逅機緣」：為目標玩家啟動關係路徑並給予初始 DRS 加成。
 * 若已婚或路徑已啟動，忽略（不重複觸發）。
 *
 * @param player 目標玩家（直接修改）
 */
export function activateRelationship(player: Player): { activated: boolean; message: string } {
  if (player.isMarried) {
    return { activated: false, message: `${player.name} 已婚，無需啟動關係路徑。` };
  }
  if (player.relationshipActive) {
    return { activated: false, message: `${player.name} 的關係路徑已啟動中。` };
  }

  player.relationshipActive = true;
  player.relationshipPoints += HOST_ACTIVATION_DRS_BONUS;

  return {
    activated: true,
    message: `主持人觸發邂逅！${player.name} 的關係路徑已啟動，初始 DRS +${HOST_ACTIVATION_DRS_BONUS}。`,
  };
}

export interface ConfirmMarriageResult {
  success: boolean;
  message: string;
  marriageBonus?: number;
  lifeExpGained?: number;
}

/**
 * 玩家透過 DRS 路徑（自然戀愛或主持人媒合）確認結婚。
 *
 * 前提：`relationshipPoints >= RELATIONSHIP_MARRIAGE_THRESHOLD`
 *
 * @param player 玩家物件（直接修改）
 * @param type   'love'（主動累積 DRS）| 'matchmaker'（主持人媒合啟動後達標）
 */
export function confirmMarriage(
  player: Player,
  type: 'love' | 'matchmaker'
): ConfirmMarriageResult {
  if (player.isMarried) {
    return { success: false, message: '已婚，無法再次結婚。' };
  }
  if (!player.relationshipActive) {
    return { success: false, message: '關係路徑尚未啟動。' };
  }
  if (player.relationshipPoints < RELATIONSHIP_MARRIAGE_THRESHOLD) {
    return {
      success: false,
      message: `DRS 不足（需要 ${RELATIONSHIP_MARRIAGE_THRESHOLD}，目前 ${player.relationshipPoints}）。`,
    };
  }

  const bonus = MARRIAGE_BONUS_BY_TYPE[type];
  const lifeExpKey = type === 'love' ? 'MARRIAGE_LOVE' : 'MARRIAGE_MATCHMAKER';
  const lifeExp = LIFE_EXP[lifeExpKey];

  player.isMarried = true;
  player.marriageType = type;
  player.marriageBonus = bonus;
  player.lifeExperience += lifeExp;
  player.relationshipActive = false;  // 路徑完成

  return {
    success: true,
    message: `恭喜結婚（${type}）！月收入加成 +$${bonus.toLocaleString()}。`,
    marriageBonus: bonus,
    lifeExpGained: lifeExp,
  };
}

/**
 * 玩家透過「買賣婚姻」直接結婚（費用隨年齡遞增）。
 *
 * 不需要 DRS，直接扣款並結婚。
 *
 * @param player     玩家物件（直接修改）
 * @param currentAge 當前遊戲年齡（用於計算費用）
 */
export function buyArrangedMarriage(player: Player, currentAge: number): ConfirmMarriageResult {
  if (player.isMarried) {
    return { success: false, message: '已婚，無法再次結婚。' };
  }
  if (player.isBedridden) {
    return { success: false, message: '臥床中無法辦理婚事。' };
  }
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.arrangedMarriage) {
    return {
      success: false,
      message: `健康值不足（需要 ${HP_ACTIVITY_THRESHOLDS.arrangedMarriage}，目前 ${player.stats.health}）。`,
    };
  }

  const cost = getArrangedMarriageCost(currentAge);
  if (player.cash < cost) {
    return {
      success: false,
      message: `現金不足（需要 $${cost.toLocaleString()}，目前 $${player.cash.toLocaleString()}）。`,
    };
  }

  const bonus = MARRIAGE_BONUS_BY_TYPE['arranged'];

  player.cash -= cost;
  player.isMarried = true;
  player.marriageType = 'arranged';
  player.marriageBonus = bonus;
  player.lifeExperience += LIFE_EXP.MARRIAGE_ARRANGED;

  return {
    success: true,
    message: `買賣婚姻完成，費用 $${cost.toLocaleString()}。月收入加成 +$${bonus.toLocaleString()}。`,
    marriageBonus: bonus,
    lifeExpGained: LIFE_EXP.MARRIAGE_ARRANGED,
  };
}
