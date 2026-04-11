import { Player, PaydayPlanPayload, Profession, LifeStage } from './gameDataModels';
import {
  FQ_UPGRADE_COSTS,
  FQ_MULTIPLIERS,
  HP_DECAY_BY_STAGE,
  HP_MAINTENANCE_COST,
  HP_BOOST_COST,
  HP_BOOST_AMOUNT,
  SKILL_TRAINING_COST,
  SKILL_TRAINING_GAIN,
  SKILL_CAREER_CHANGE_THRESHOLD,
  NETWORK_AUTO_GAIN_INTERVAL,
  NETWORK_INVEST_COST,
  NETWORK_INVEST_GAIN,
  STOCK_DCA_MONTHLY_RETURN_RATE,
} from './gameConfig';
import { PROFESSION_MAP } from './gameConfig';

// ============================================================
// 輔助函數
// ============================================================

/**
 * 取得 FQ 等級對應的被動收入乘數。
 * @param fq 財商值（1–10）
 */
export function getFQMultiplier(fq: number): number {
  return FQ_MULTIPLIERS[fq] ?? 1.0;
}

/**
 * 取得升級 FQ 所需費用。
 * @param currentFQ 當前財商值（1–10）
 * @returns 升級費用；若已滿級（FQ=10）則回傳 null
 */
export function getFQUpgradeCost(currentFQ: number): number | null {
  if (currentFQ >= 10) return null;
  return FQ_UPGRADE_COSTS[currentFQ - 1] ?? null;
}

// ============================================================
// 回傳型別
// ============================================================

/** 單項投資的執行結果 */
interface InvestmentOutcome {
  attempted: boolean;
  executed: boolean;    // false = 現金不足，已略過
  cost: number;
  description: string;
}

/** applyPaydayPlan 的完整回傳結果，供廣播 paydayPlanResult 使用 */
export interface PaydayPlanResult {
  totalCostDeducted: number;
  investments: {
    fqUpgrade: InvestmentOutcome;
    healthMaintenance: InvestmentOutcome;
    healthBoost: InvestmentOutcome;
    skillTraining: InvestmentOutcome;
    networkInvest: InvestmentOutcome;
  };
  stockDCA: { executed: boolean; amount: number; newPortfolioValue: number };
  insurancePurchases: Array<{ type: string; success: boolean; message?: string }>;
  statsAfter: {
    financialIQ: number;
    health: number;
    careerSkill: number;
    network: number;
  };
  careerChangeUnlocked: boolean;
  ntMilestonesUnlocked: number[];
}

/** executeCareerChange 的回傳結果 */
export interface CareerChangeResult {
  success: boolean;
  message: string;
  previousProfession?: string;
  newProfession?: string;
  salaryChange?: number;   // 正值=加薪，負值=降薪
}

// ============================================================
// 核心函數
// ============================================================

/**
 * 套用發薪日規劃：依玩家選擇扣款並更新成長數值。
 *
 * 執行順序：
 *  1. healthBoost（包含維護效果）優先於 healthMaintenance
 *  2. 若現金不足，自動略過無法負擔的項目（不強制拒絕整筆規劃）
 *
 * @param player 玩家物件（直接修改）
 * @param plan   玩家提交的投資選擇
 * @returns PaydayPlanResult 含每項投資的執行情況與最終數值
 */
export function applyPaydayPlan(player: Player, plan: PaydayPlanPayload): PaydayPlanResult {
  let remainingCash = player.cash;
  let totalCostDeducted = 0;

  function tryInvest(cost: number): boolean {
    if (remainingCash >= cost) {
      remainingCash -= cost;
      totalCostDeducted += cost;
      return true;
    }
    return false;
  }

  // --- FQ 升級 ---
  const fqCost = getFQUpgradeCost(player.stats.financialIQ) ?? 0;
  const fqOutcome: InvestmentOutcome = {
    attempted: plan.investInFQUpgrade,
    executed: false,
    cost: fqCost,
    description: `財商值升級（${player.stats.financialIQ} → ${player.stats.financialIQ + 1}）`,
  };
  if (plan.investInFQUpgrade && getFQUpgradeCost(player.stats.financialIQ) !== null) {
    fqOutcome.executed = tryInvest(fqCost);
    if (fqOutcome.executed) {
      player.stats.financialIQ = Math.min(10, player.stats.financialIQ + 1);
    }
  }

  // --- 健康投資（boost 優先，已包含 maintenance 效果）---
  const boostOutcome: InvestmentOutcome = {
    attempted: plan.investInHealthBoost,
    executed: false,
    cost: HP_BOOST_COST,
    description: `積極投資健康（+${HP_BOOST_AMOUNT} HP）`,
  };
  const maintOutcome: InvestmentOutcome = {
    attempted: plan.investInHealthMaintenance,
    executed: false,
    cost: HP_MAINTENANCE_COST,
    description: '維護健康（阻止 HP 衰退）',
  };

  if (plan.investInHealthBoost) {
    boostOutcome.executed = tryInvest(HP_BOOST_COST);
    if (boostOutcome.executed) {
      // boost 已含 maintenance，同時標記 maintenance 為已執行（供 applyHPDecay 判斷）
      player.stats.health = Math.min(100, player.stats.health + HP_BOOST_AMOUNT);
      maintOutcome.executed = true; // 視為已做維護
    }
  } else if (plan.investInHealthMaintenance) {
    maintOutcome.executed = tryInvest(HP_MAINTENANCE_COST);
    // HP 不增加，只是之後 applyHPDecay 會跳過衰退
  }

  // --- 技能培訓 ---
  const prevSkill = player.stats.careerSkill;
  const skillOutcome: InvestmentOutcome = {
    attempted: plan.investInSkillTraining,
    executed: false,
    cost: SKILL_TRAINING_COST,
    description: `進修培訓（+${SKILL_TRAINING_GAIN} SK）`,
  };
  if (plan.investInSkillTraining) {
    skillOutcome.executed = tryInvest(SKILL_TRAINING_COST);
    if (skillOutcome.executed) {
      player.stats.careerSkill = Math.min(100, player.stats.careerSkill + SKILL_TRAINING_GAIN);
    }
  }

  // --- 人脈投資 ---
  const prevNetwork = player.stats.network;
  const networkOutcome: InvestmentOutcome = {
    attempted: plan.investInNetwork,
    executed: false,
    cost: NETWORK_INVEST_COST,
    description: `主動拓展人脈（+${NETWORK_INVEST_GAIN} NT）`,
  };
  // nt_driven 職業（無底薪業務員等）：NT 無上限，薪資 = NT × salaryPerNT，可無限成長
  const ntCap = player.profession.salaryType === 'nt_driven' ? Infinity : 10;
  if (plan.investInNetwork && player.stats.network < ntCap) {
    networkOutcome.executed = tryInvest(NETWORK_INVEST_COST);
    if (networkOutcome.executed) {
      player.stats.network = Math.min(ntCap, player.stats.network + NETWORK_INVEST_GAIN);
    }
  }
  const ntMilestonesUnlocked = [3, 5, 8].filter(
    (t) => prevNetwork < t && player.stats.network >= t
  );

  // 一次性扣款
  player.cash -= totalCostDeducted;

  // --- 股票定期定額 ---
  const dcaAmount = plan.stockDCAAmount ?? 0;
  let stockDCAResult = { executed: false, amount: dcaAmount, newPortfolioValue: 0 };
  if (dcaAmount > 0 && player.cash >= dcaAmount) {
    player.cash -= dcaAmount;
    const existing = player.assets.find((a) => a.id === 'stock-dca');
    if (existing) {
      existing.cost += dcaAmount;
      existing.currentValue = (existing.currentValue ?? existing.cost) + dcaAmount;
    } else {
      player.assets.push({
        id: 'stock-dca',
        name: '指數股票基金（定期定額）',
        type: 'Stock' as import('./gameConstants').AssetType,
        cost: dcaAmount,
        currentValue: dcaAmount,
        monthlyCashflow: 0,
      });
    }
    const updated = player.assets.find((a) => a.id === 'stock-dca');
    stockDCAResult = { executed: true, amount: dcaAmount, newPortfolioValue: updated?.currentValue ?? dcaAmount };
  }

  // --- 保險購買 ---
  const insurancePurchases: Array<{ type: string; success: boolean; message?: string }> = [];
  for (const insType of plan.buyInsuranceTypes ?? []) {
    const { buyInsurance } = require('./gameLogic') as typeof import('./gameLogic');
    const result = buyInsurance(player, insType as import('./gameLogic').InsuranceType);
    insurancePurchases.push({ type: insType, success: result.success, message: result.success ? undefined : result.message });
  }

  const careerChangeUnlocked =
    prevSkill < SKILL_CAREER_CHANGE_THRESHOLD &&
    player.stats.careerSkill >= SKILL_CAREER_CHANGE_THRESHOLD;

  return {
    totalCostDeducted,
    investments: {
      fqUpgrade: fqOutcome,
      healthMaintenance: maintOutcome,
      healthBoost: boostOutcome,
      skillTraining: skillOutcome,
      networkInvest: networkOutcome,
    },
    stockDCA: stockDCAResult,
    insurancePurchases,
    statsAfter: {
      financialIQ: player.stats.financialIQ,
      health: player.stats.health,
      careerSkill: player.stats.careerSkill,
      network: player.stats.network,
    },
    careerChangeUnlocked,
    ntMilestonesUnlocked,
  };
}

/**
 * 套用 HP 自然衰退（依人生階段加速）。
 *
 * 若本次發薪日已執行健康維護（investInHealthMaintenance 或 investInHealthBoost），
 * 呼叫方應傳入 maintenanceDone = true 以跳過衰退。
 *
 * @param player          玩家物件（直接修改 stats.health）
 * @param maintenanceDone 是否已執行任何健康維護投資
 * @param currentStage    玩家目前的人生階段（由呼叫方從即時年齡計算後傳入）
 */
export function applyHPDecay(
  player: Player,
  maintenanceDone: boolean,
  currentStage: LifeStage
): void {
  if (maintenanceDone) return;
  const decay = HP_DECAY_BY_STAGE[currentStage];
  player.stats.health = Math.max(0, player.stats.health - decay);
}

/**
 * 檢查玩家是否應進入臥床狀態。
 *
 * HP 降至 0 時將 isBedridden 設為 true。
 * 應在 applyHPDecay 或任何 HP 扣減後呼叫。
 *
 * @param player 玩家物件（直接修改）
 * @returns true 代表本次呼叫剛剛觸發臥床（從非臥床 → 臥床）
 */
export function checkBedriddenStatus(player: Player): boolean {
  if (!player.isBedridden && player.stats.health <= 0) {
    player.isBedridden = true;
    return true;
  }
  return false;
}

/**
 * 套用 NT 自然成長。
 *
 * 每當 paydayCount 為 NETWORK_AUTO_GAIN_INTERVAL 的倍數時，NT +1。
 * nt_driven 職業（無底薪業務員等）無上限；其他職業上限為 10。
 * 應在 triggerPayday 遞增 paydayCount 之後呼叫。
 *
 * @param player 玩家物件（直接修改 stats.network）
 */
export function applyNTAutoGrowth(player: Player): void {
  const ntCap = player.profession.salaryType === 'nt_driven' ? Infinity : 10;
  if (
    player.paydayCount > 0 &&
    player.paydayCount % NETWORK_AUTO_GAIN_INTERVAL === 0 &&
    player.stats.network < ntCap
  ) {
    player.stats.network = Math.min(ntCap, player.stats.network + 1);
  }
}

/**
 * 執行玩家轉職。
 *
 * 前提：player.stats.careerSkill >= SKILL_CAREER_CHANGE_THRESHOLD（由呼叫方驗證）。
 *
 * 轉職效果：
 * - 薪資更新為新職業的 startingSalary
 * - 基本支出更新為新職業的起始支出（房貸、車貸、信用卡、其他支出）
 * - 資產、負債、保險、現金、成長數值、paydayCount 全部保留
 * - 第二專長值 SK 歸零
 *
 * @param player          玩家物件（直接修改）
 * @param newProfessionId 目標職業 ID（必須存在於 PROFESSION_MAP）
 * @returns CareerChangeResult 含執行結果與薪資變化
 */
export function executeCareerChange(
  player: Player,
  newProfessionId: string
): CareerChangeResult {
  const newProfession: Profession | undefined = PROFESSION_MAP.get(newProfessionId);

  if (!newProfession) {
    return {
      success: false,
      message: `找不到職業 ID：${newProfessionId}`,
    };
  }

  if (newProfession.id === player.profession.id) {
    return {
      success: false,
      message: '目標職業與當前職業相同，無法轉職。',
    };
  }

  const previousProfession = player.profession.name;
  const oldSalary = player.salary;

  // 更新職業與財務
  player.profession = newProfession;
  player.salary = newProfession.startingSalary;
  player.expenses.homeMortgagePayment = newProfession.startingHomeMortgage;
  player.expenses.carLoanPayment = newProfession.startingCarLoan;
  player.expenses.creditCardPayment = newProfession.startingCreditCard;
  player.expenses.otherExpenses = newProfession.startingOtherExpenses;
  // taxes 在新系統由年度累進稅處理，不在此更新

  // SK 歸零
  player.stats.careerSkill = 0;

  return {
    success: true,
    message: `${previousProfession} → ${newProfession.name} 轉職成功！`,
    previousProfession,
    newProfession: newProfession.name,
    salaryChange: newProfession.startingSalary - oldSalary,
  };
}
