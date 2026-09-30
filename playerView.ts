/** 送給前端的狀態：玩家與房間的序列化、手機說明用的效果與組成資料 */
import { GameState, Player, GamePhase } from './gameDataModels';
import { BASIC_INVESTMENTS } from './basicInvestments';
import { getHomeOffers } from './householdLoans';
import { BOND_FUND_ID, currentBondRate } from './bondFund';
import { describeBucketList } from './bucketList';
import { buildRetirementOutlook } from './retirementOutlook';
import { ADVICE_CARDS } from './lateLife';
import { naturalDeathProbability, travelLeaveCost, isOnPayrollSchedule } from './gameLogic';
import { LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS, CHILD_EXPENSE_BY_AGE, SOCIAL_INSURANCE_RATE, PREMIUM_MULT_BY_STAGE } from './gameConfig';
import { getAvailableLoan, getCurrentAge, getRemainingActivityTimeMs, getLifeStage } from './gameLogic';
import { RELATIONSHIP_MARRIAGE_THRESHOLD, HP_ACTIVITY_THRESHOLDS, PROFESSIONS, SECOND_LIFE_MIN_PAYDAYS, SECOND_LIFE_FINANCIAL_COVERAGE_RATIO, SECOND_LIFE_BALANCED_COVERAGE_RATIO, SECOND_LIFE_FINANCIAL_INDICATORS_REQUIRED, SECOND_LIFE_BALANCED_INDICATORS_REQUIRED, PAYDAY_MAX_ROUNDS, MONTHS_PER_ROUND, YEARS_PER_COMPLETED_ROUND, TOTAL_LIFE_ROUNDS, STOCK_DCA_MONTHLY_RETURN_RATE, STOCK_DCA_MONTHLY_DIVIDEND_RATE, SKILL_CAREER_CHANGE_THRESHOLD, getLoanLimit, getLoanRate } from './gameConfig';
import { MEDICAL_INSURANCE_PREMIUM, LIFE_INSURANCE_PREMIUM, PROPERTY_INSURANCE_PREMIUM, FQ_MULTIPLIERS, FAST_TRACK_INCOME_MULTIPLIER } from './gameConstants';
import { getFQUpgradeCost } from './statsSystem';
import { CRISIS_EVENTS } from './gameCards';
import { evaluateSecondLifeEligibility } from './cardSystem';
import {
  hasRoomAdmin, isPaydayDue, paydayRemainingMs, paydaySettlementMonths,
} from './socketServer';

/**
 * 將 Player 轉換為可安全 JSON 序列化的純物件。
 * getter 值（totalIncome 等）需手動展開，Map 無法直接序列化。
 *
 * 第二個參數 gs 用來算 personalAge（顯示用個人年齡 = max(startAge, 全體回合年齡)），
 * 讓所有前端讀同一個欄位即可，避免「進修玩家從 25 起算」與「全域時鐘 20」對不上。
 */
/**
 * 手機端「脫離內圈還差多少」解析：把第二人生資格拆成可行動的缺口。
 * 已進外圈的玩家回傳 null。
 */
export function buildSecondLifeProgress(p: Player): object | null {
  if (p.isInFastTrack) return null;
  const e = evaluateSecondLifeEligibility(p);
  const fqMultiplier = FQ_MULTIPLIERS[p.stats.financialIQ] ?? 1;
  const route = (label: string, coverageRequired: number, indicatorsRequired: number, met: boolean) => {
    const targetEffective = Math.ceil(e.totalExpenses * coverageRequired);
    const effectiveGap = Math.max(0, targetEffective - e.effectivePassiveIncome);
    // 換算回「原始被動收入」：實際要多買到多少月現金流的資產
    const rawGap = Math.ceil(effectiveGap / fqMultiplier);
    return {
      label, coverageRequired, indicatorsRequired,
      targetEffectivePassiveIncome: targetEffective,
      effectivePassiveGap: effectiveGap,
      rawPassiveGap: rawGap,
      indicatorGap: Math.max(0, indicatorsRequired - e.achievedIndicatorCount),
      financialMet: e.coverageRatio >= coverageRequired,
      indicatorsMet: e.achievedIndicatorCount >= indicatorsRequired,
      met,
    };
  };
  return {
    eligible: e.eligible,
    route: e.route,
    passedCell: p.hasPassedSecondLife,
    paydayCount: p.paydayCount,
    minPaydays: SECOND_LIFE_MIN_PAYDAYS,
    seasoned: p.paydayCount >= SECOND_LIFE_MIN_PAYDAYS,
    rawPassiveIncome: e.rawPassiveIncome,
    fqMultiplier,
    effectivePassiveIncome: e.effectivePassiveIncome,
    totalExpenses: e.totalExpenses,
    coverageRatio: Math.round(e.coverageRatio * 1000) / 1000,
    indicators: e.indicators.map((i) => ({ ...i, gap: Math.max(0, i.threshold - i.value) })),
    achievedIndicatorCount: e.achievedIndicatorCount,
    routes: {
      financialBreakthrough: route('財務突破', SECOND_LIFE_FINANCIAL_COVERAGE_RATIO, SECOND_LIFE_FINANCIAL_INDICATORS_REQUIRED, e.financialBreakthroughMet),
      balancedLife: route('平衡人生', SECOND_LIFE_BALANCED_COVERAGE_RATIO, SECOND_LIFE_BALANCED_INDICATORS_REQUIRED, e.balancedLifeMet),
    },
  };
}

/** 手機「行動」面板每個動作點選時要標注的效果與價值（全部由伺服器算，避免前端數字失真）。 */
/** 交通：目前的車或交通費、各車種報價、二手價 */
function buildTransportInfo(p: Player) {
  const cars = require('./cars') as typeof import('./cars');
  const { carAssetId, carLoanId } = require('./householdLoans') as typeof import('./householdLoans');
  return {
    car: p.car,
    monthly: p.transportExpense,
    transitFee: cars.transitFeeWithoutCar(p),
    offers: cars.getCarOffers(p),
    resaleValue: p.car ? Math.round(p.assets.find((a) => a.id === carAssetId(p.id))?.currentValue ?? 0) : 0,
    loanRemaining: p.liabilities.find((l) => l.id === carLoanId(p.id))?.totalDebt ?? 0,
  };
}

/** 家庭行動的費用、機率與「現在不能做的原因」（手機直接顯示） */
function buildFamilyInfo(p: Player, gs: GameState) {
  const cfg = require('./gameConfig') as typeof import('./gameConfig');
  const fam = require('./family') as typeof import('./family');
  const { getArrangedMarriageCost } = require('./gameLogic') as typeof import('./gameLogic');
  return {
    familyTies: p.familyTiePoints ?? 0, familyTieCap: cfg.FAMILY_TIE_CAP,
    fertility: { cost: cfg.FERTILITY_COST, chance: fam.fertilityChance(gs, p), blocked: fam.fertilityBlock(gs, p) },
    adoption: { cost: cfg.ADOPTION_COST, childAge: cfg.ADOPTED_CHILD_AGE, blocked: fam.adoptionBlock(gs, p) },
    sponsor: { monthly: cfg.SPONSOR_CHILD_MONTHLY, years: cfg.SPONSOR_CHILD_MONTHS / 12, points: cfg.FAMILY_TIE_SPONSOR_POINTS, count: p.sponsoredChildren ?? 0, max: cfg.SPONSOR_CHILD_MAX, blocked: fam.sponsorBlock(p) },
    arranged: { cost: getArrangedMarriageCost(fam.personalAge(gs, p)), blocked: fam.arrangedBlock(gs, p) },
    divorce: { legalFee: cfg.DIVORCE_LEGAL_FEE, cashShare: cfg.DIVORCE_CASH_SHARE, blocked: fam.divorceBlock(p) },
  };
}

export function buildActionInfo(p: Player, gs?: GameState): object {
  const cfg = require('./gameConfig') as typeof import('./gameConfig');
  const { CRISIS_EVENTS } = require('./gameCards') as typeof import('./gameCards');
  const premiumMult = cfg.PREMIUM_MULT_BY_STAGE[p.lifeStage] ?? 1;
  const age = p.currentAge;
  const marriageWindow = cfg.LIFE_EVENT_WINDOWS.marriage;
  const inPeak = age >= marriageWindow.peakStart && age <= marriageWindow.peakEnd;
  const coversFor = (type: 'hasMedicalInsurance' | 'hasLifeInsurance' | 'hasPropertyInsurance') =>
    CRISIS_EVENTS.filter((c) => c.requiredInsurance === type).map((c) => ({ title: c.title, baseCost: c.baseCost, insuredCost: c.insuredCost, canCauseDeath: c.canCauseDeath }));
  const insurance = {
    medical: { label: '醫療險', activationFee: cfg.INSURANCE_ACTIVATION_FEE.medical, basePremium: MEDICAL_INSURANCE_PREMIUM, monthlyPremium: Math.round(MEDICAL_INSURANCE_PREMIUM * premiumMult), deduction: cfg.MEDICAL_INSURANCE_DEDUCTION, covers: coversFor('hasMedicalInsurance'), extra: '外圈疾病危機也適用' },
    life: { label: '壽險', activationFee: cfg.INSURANCE_ACTIVATION_FEE.life, basePremium: LIFE_INSURANCE_PREMIUM, monthlyPremium: Math.round(LIFE_INSURANCE_PREMIUM * premiumMult), deduction: cfg.LIFE_INSURANCE_DEDUCTION, covers: coversFor('hasLifeInsurance'), extra: '身故時遺產不扣負債（傳承分）' },
    property: { label: '財產險', activationFee: cfg.INSURANCE_ACTIVATION_FEE.property, basePremium: PROPERTY_INSURANCE_PREMIUM, monthlyPremium: Math.round(PROPERTY_INSURANCE_PREMIUM * premiumMult), deduction: cfg.PROPERTY_INSURANCE_DEDUCTION, covers: coversFor('hasPropertyInsurance'), extra: '' },
  };
  const rate = getLoanRate(p.creditScore);
  return {
    travel: cfg.TRAVEL_DESTINATIONS
      .filter((d) => d.tier === 'both' || d.tier === (p.isInFastTrack ? 'outer' : 'inner'))
      .map((d) => ({ id: d.id, name: d.name, region: d.region, tier: d.tier, cost: d.cost, description: d.description,
        lifeExp: p.visitedDestinations.includes(d.id) ? Math.floor(d.lifeExpGained / 2) : d.lifeExpGained,
        visited: p.visitedDestinations.includes(d.id), hpCost: d.hpCost, leaveMonths: d.leaveMonths, leaveCost: travelLeaveCost(p, d), statEffect: d.statEffect ?? null })),
    travelOnPayroll: isOnPayrollSchedule(p),
    travelMinHp: HP_ACTIVITY_THRESHOLDS.travel,
    social: { cost: cfg.SOCIAL_EVENT_COST, drsMin: cfg.SOCIAL_EVENT_DRS_MIN, drsMax: inPeak ? cfg.SOCIAL_EVENT_DRS_PEAK_MAX : cfg.SOCIAL_EVENT_DRS_MAX, inPeak,
      peakStart: marriageWindow.peakStart, peakEnd: marriageWindow.peakEnd, threshold: RELATIONSHIP_MARRIAGE_THRESHOLD, currentDrs: p.relationshipPoints, active: p.relationshipActive, minHp: HP_ACTIVITY_THRESHOLDS.socialEvent },
    matchmaking: { cost: cfg.MATCHMAKING_COST, drsMin: cfg.MATCHMAKING_DRS_MIN, drsMax: inPeak ? cfg.MATCHMAKING_DRS_PEAK_MAX : cfg.MATCHMAKING_DRS_MAX,
      usedThisRound: gs ? p.lastMatchmakingRound === gs.turnNumber : false },
    family: gs ? buildFamilyInfo(p, gs) : null,
    transport: buildTransportInfo(p),
    insurance,
    premiumMultiplier: premiumMult,
    bond: { monthlyYield: currentBondRate(gs) / 12, annualized: Math.round(currentBondRate(gs) * 1000) / 10, floating: true, amounts: cfg.BOND_FUND_AMOUNTS,
      principal: p.assets.find((a) => a.id === BOND_FUND_ID)?.cost ?? 0 },
    dca: { monthlyReturnRate: STOCK_DCA_MONTHLY_RETURN_RATE, monthlyDividendRate: STOCK_DCA_MONTHLY_DIVIDEND_RATE,
      annualized: Math.round((Math.pow(1 + STOCK_DCA_MONTHLY_RETURN_RATE, 12) - 1 + STOCK_DCA_MONTHLY_DIVIDEND_RATE * 12) * 1000) / 10,
      amounts: cfg.STOCK_DCA_AMOUNTS },
    loan: { rate, leverageRate: rate * cfg.LEVERAGE_RATE_MULTIPLIER, limit: getLoanLimit(p.creditScore), available: getAvailableLoan(p), presetAmounts: cfg.LOAN_PRESET_AMOUNTS,
      emergencyCreditPenalty: cfg.CREDIT_CHANGE_EMERGENCY_LOAN, repayCredit: cfg.CREDIT_CHANGE_REPAY, clearCredit: 25, negativeCashflowCredit: cfg.CREDIT_CHANGE_NEGATIVE_CF,
      tiers: cfg.LOAN_RATE_BY_TIER.map((t) => ({ minScore: t.minScore, rate: t.rate, limit: getLoanLimit(t.minScore) })) },
    capitalGainsTaxRate: cfg.CAPITAL_GAINS_TAX_RATE,
    homeTransactionCostRate: cfg.HOME_TRANSACTION_COST_RATE,
    fqMultipliers: FQ_MULTIPLIERS,
    hpDecayPerRound: cfg.HP_DECAY_BY_STAGE[p.lifeStage] ?? 0,
    hpThresholds: HP_ACTIVITY_THRESHOLDS,
    skill: { perSK: p.profession.salaryType === 'sk_driven' ? (p.profession.salaryPerSK ?? 0) : 0, raiseThreshold: cfg.SALARY_GROWTH_SKILL_THRESHOLD, careerChangeThreshold: cfg.SKILL_CAREER_CHANGE_THRESHOLD },
    network: { perNT: p.profession.salaryType === 'nt_driven' ? (p.profession.salaryPerNT ?? 0) : 0, shieldNT: 3, dealPickNT: 5, familySupportNT: cfg.PARENT_CARE_FAMILY_SUPPORT_NT },
  };
}

/** 薪資這個數字是怎麼算出來的（手機點「薪資」顯示）。 */
export function buildSalaryItems(p: Player): { label: string; note?: string }[] {
  const cfg = require('./gameConfig') as typeof import('./gameConfig');
  const items: { label: string; note?: string }[] = [];
  if (p.retirementStatus === 'retired') { items.push({ label: `退休金 $${p.pensionMonthly.toLocaleString()}`, note: `職涯平均月薪 $${p.averageCareerSalary.toLocaleString()} × 替代率（E 40%／S 25%／B、I 0%）` }); return items; }
  if (p.retirementStatus === 'consultant') { items.push({ label: `顧問收入 $${p.salary.toLocaleString()}`, note: `第二專長 ${p.stats.careerSkill} × 300 + 人脈 ${p.stats.network} × 3,000；HP < 50 接不到案，每輪 HP −5` }); return items; }
  if (p.retirementStatus === 'founder') { items.push({ label: '退休創業：沒有薪資', note: '收入來自創業事業的月現金流（列在被動收入）' }); return items; }
  const prof = p.profession;
  if (prof.salaryType === 'fixed') items.push({ label: `起薪 $${prof.startingSalary.toLocaleString()}`, note: `${prof.name}（固定薪）` });
  else if (prof.salaryType === 'random') items.push({ label: `浮動薪 $${(prof.minSalary ?? 0).toLocaleString()}–$${(prof.maxSalary ?? 0).toLocaleString()}`, note: '每個結算月隨機' });
  else if (prof.salaryType === 'nt_driven') items.push({ label: `底薪 $${(prof.salaryBase ?? 0).toLocaleString()} + 人脈 ${p.stats.network} × $${(prof.salaryPerNT ?? 0).toLocaleString()}`, note: '人脈驅動：人脈越高薪水越高' });
  else items.push({ label: `基礎 $${prof.startingSalary.toLocaleString()} + 專長 ${p.stats.careerSkill} × $${(prof.salaryPerSK ?? 0).toLocaleString()}`, note: '技能驅動：第二專長越高薪水越高' });
  if (p.salaryGrowthMultiplier !== 1) items.push({ label: `× 年資與升遷 ${p.salaryGrowthMultiplier.toFixed(3)}`, note: `每輪依階段加薪（青年 ${Math.round(cfg.SALARY_GROWTH_BY_STAGE.Youth * 100)}%、成家 ${Math.round(cfg.SALARY_GROWTH_BY_STAGE.Family * 100)}%、轉型 ${Math.round(cfg.SALARY_GROWTH_BY_STAGE.Transition * 100)}%），SK ≥ ${cfg.SALARY_GROWTH_SKILL_THRESHOLD} 再 +${Math.round(cfg.SALARY_GROWTH_SKILL_BONUS * 100)}%；升遷卡永久 +10%` });
  const habit = cfg.HEALTH_HABIT_OPTIONS[p.healthHabit];
  if (habit && habit.salaryMultiplier !== 1) items.push({ label: `× 健康習慣「${habit.label}」${habit.salaryMultiplier}`, note: habit.desc });
  if (p.salaryBonus) items.push({ label: `+ 永久加薪 $${p.salaryBonus.toLocaleString()}`, note: '決策回聲等事件' });
  if (p.salaryMultiplierMonths > 0) items.push({ label: `× 暫時倍率 ${p.salaryMultiplierPending}（剩 ${p.salaryMultiplierMonths} 個月）`, note: '升遷 ×1.2／職場霸凌 ×0.9' });
  if (p.downsizingTurnsLeft > 0) items.push({ label: `裁員中：薪資 $0，剩 ${p.downsizingTurnsLeft} 個月`, note: '職涯轉折格；月數依年齡，SK ≥ 60 減半' });
  items.push({ label: `＝ 目前月薪 $${p.salary.toLocaleString()}`, note: `另扣勞健保 ${Math.round(cfg.SOCIAL_INSURANCE_RATE * 100)}% = $${p.socialInsurance.toLocaleString()}（列在支出）` });
  return items;
}

/** 淨資產 = 現金 + 資產市值 − 負債（逐項列出）。 */
export function buildNetWorthBreakdown(p: Player): object {
  const liabilityById = new Map(p.liabilities.map((l) => [l.id, l]));
  const assets = p.assets.map((a) => ({ id: a.id, name: a.name, value: a.currentValue ?? a.cost, cost: a.cost, debt: a.linkedLiabilityId ? (liabilityById.get(a.linkedLiabilityId)?.totalDebt ?? 0) : 0, monthlyCashflow: a.monthlyCashflow, isResidence: Boolean(a.isResidence) }));
  const liabilities = p.liabilities.map((l) => ({ id: l.id, name: l.name, debt: l.totalDebt, monthlyPayment: l.monthlyPayment ?? 0 }));
  const assetTotal = assets.reduce((s, a) => s + a.value, 0);
  const liabilityTotal = liabilities.reduce((s, l) => s + l.debt, 0);
  return { cash: p.cash, assets, assetTotal, liabilities, liabilityTotal, total: p.cash + assetTotal - liabilityTotal };
}

export function serializePlayer(p: Player, gs: GameState): object {
  const personalAge = Math.round(Math.max(p.startAge ?? 20, getCurrentAge(gs)) * 10) / 10;

  // 計算保費與孩子支出（後端 Player.totalExpenses getter 內的細項，補給前端報表使用）
  const insurancePremiums = p.insurancePremiums;
  const childExpenses = p.childExpenses;
  const premiumMult = PREMIUM_MULT_BY_STAGE[p.lifeStage] ?? 1;

  // 無擔保負債月付加總（與 Player.totalExpenses getter 同邏輯）
  const _securedIds = new Set(
    p.assets.map((a) => a.linkedLiabilityId).filter((id): id is string => Boolean(id))
  );
  const unsecuredLoanPayments = p.liabilities
    .filter((l) => !_securedIds.has(l.id))
    .reduce((sum, l) => sum + (l.monthlyPayment ?? 0), 0);

  // 月現金流逐項組成（手機點「月現金流」顯示）
  const fqMultiplier = FQ_MULTIPLIERS[p.stats.financialIQ] ?? 1;
  const ftMultiplier = p.isInFastTrack ? FAST_TRACK_INCOME_MULTIPLIER : 1;
  const incomeItems: { label: string; amount: number; note?: string }[] = [];
  const salaryLabel = p.retirementStatus === 'retired' ? '退休金' : p.retirementStatus === 'consultant' ? '顧問收入' : p.retirementStatus === 'founder' ? '薪資（已退休創業）' : `薪資（${p.profession.name}）`;
  incomeItems.push({ label: salaryLabel, amount: p.salary,
    note: p.downsizingTurnsLeft > 0 ? `裁員中，剩 ${p.downsizingTurnsLeft} 個月`
      : p.salaryMultiplierMonths > 0 ? `薪資倍率 ×${p.salaryMultiplierPending}，剩 ${p.salaryMultiplierMonths} 個月` : undefined });
  const positiveAssets = p.assets.filter((a) => a.monthlyCashflow > 0);
  for (const a of positiveAssets) {
    const worldFactor = p.worldEffects.reduce((factor, entry) =>
      entry.effect.type === 'CashflowChange' && entry.effect.targetAssetType === a.type ? factor * (entry.effect.multiplier ?? 1) : factor, 1);
    const vacant = (a.vacantMonthsLeft ?? 0) > 0;
    incomeItems.push({ label: a.name, amount: vacant ? 0 : Math.round(a.monthlyCashflow * worldFactor),
      note: vacant ? `空置中，還要 ${a.vacantMonthsLeft} 個月才有新租客（原租金 $${a.monthlyCashflow.toLocaleString()}）` : worldFactor !== 1 ? `世界事件 ×${worldFactor.toFixed(2)}` : undefined });
  }
  const passiveMultiplier = fqMultiplier * ftMultiplier;
  if (passiveMultiplier !== 1 && p.totalPassiveIncome > 0) {
    incomeItems.push({ label: `被動收入乘數（財商 ×${fqMultiplier}${p.isInFastTrack ? `、外圈 ×${FAST_TRACK_INCOME_MULTIPLIER}` : ''}）`,
      amount: Math.round(p.totalPassiveIncome * passiveMultiplier) - Math.max(0, p.totalPassiveIncome), note: '以被動收入總額乘算後的差額' });
  }
  if (p.marriageBonus) incomeItems.push({ label: '婚姻加成（舊版）', amount: p.marriageBonus });
  if (p.spouse) incomeItems.push({ label: '配偶收入', amount: p.spouseIncome,
    note: p.spouse.unemployedMonthsLeft > 0 ? `配偶失業中，剩 ${p.spouse.unemployedMonthsLeft} 個月` : p.spouse.retired ? '配偶已退休（40%）' : undefined });
  const expenseItems: { label: string; amount: number; note?: string }[] = [];
  const pushExpense = (label: string, amount: number, note?: string) => { if (amount) expenseItems.push({ label, amount, note }); };
  pushExpense('稅', p.expenses.taxes);
  pushExpense('勞健保', p.socialInsurance, `薪資 × ${Math.round(SOCIAL_INSURANCE_RATE * 100)}%`);
  pushExpense('高齡醫療／長照', p.seniorCareExpense, p.stats.health < 30 ? 'HP < 30：醫療 + 長照' : 'HP < 60：醫療');
  pushExpense('房租', p.rentExpense, [
    p.livingCostMultiplier > 1 ? `隨物價 ×${p.livingCostMultiplier.toFixed(2)}` : '',
    p.isMarried && p.spouse ? '已婚住較大的房子 ×1.5' : '',
    '買房後不用付',
  ].filter(Boolean).join('；'));
  pushExpense('房貸月付', p.expenses.homeMortgagePayment, '可用「提前還款」降低');
  pushExpense('車貸月付', p.expenses.carLoanPayment, '可用「提前還款」降低');
  pushExpense(p.car ? `養車費（${p.car.name}）` : '交通費', p.transportExpense, p.car ? '油錢、保險、停車、保養；賣車後改付交通費' : '沒有車：大眾運輸與計程車；配偶與未成年孩子各多一半');
  pushExpense('信用卡', p.expenses.creditCardPayment);
  {
    const style = LIFESTYLE_OPTIONS[p.lifestyle] ?? LIFESTYLE_OPTIONS.normal;
    const habit = HEALTH_HABIT_OPTIONS[p.healthHabit] ?? HEALTH_HABIT_OPTIONS.normal;
    const notes: string[] = [];
    if (style.expenseMultiplier !== 1) notes.push(`${style.label} ×${style.expenseMultiplier}`);
    if (p.livingCostMultiplier > 1) notes.push(`物價 ×${p.livingCostMultiplier.toFixed(2)}`);
    if (p.retirementLivingFactor < 1) notes.push(`退休後 ×${p.retirementLivingFactor}`);
    pushExpense('生活支出', p.livingExpenses - habit.monthlyCost, notes.length ? `基準 $${p.expenses.otherExpenses.toLocaleString()}，${notes.join('、')}` : undefined);
    pushExpense('配偶生活費', p.spouseLivingExpenses, '和你的生活支出一樣，隨生活方式與物價變動');
    if (habit.monthlyCost) pushExpense(`健康習慣：${habit.label}`, habit.monthlyCost);
  }
  pushExpense('世界事件調整', p.worldExpenseAdjustment);
  const premiumNote = premiumMult !== 1 ? `年齡倍率 ×${premiumMult}` : undefined;
  if (p.insurance.hasMedicalInsurance) pushExpense('醫療險保費', Math.round(MEDICAL_INSURANCE_PREMIUM * premiumMult), premiumNote);
  if (p.insurance.hasLifeInsurance) pushExpense('壽險保費', Math.round(LIFE_INSURANCE_PREMIUM * premiumMult), premiumNote);
  if (p.insurance.hasPropertyInsurance) pushExpense('財產險保費', Math.round(PROPERTY_INSURANCE_PREMIUM * premiumMult), premiumNote);
  {
    const kids = p.childBirthAges.map((b) => p.currentAge - b);
    const grown = kids.filter((a) => a > CHILD_EXPENSE_BY_AGE[CHILD_EXPENSE_BY_AGE.length - 1].maxAge).length;
    pushExpense(`子女支出（${p.numberOfChildren} 人）`, childExpenses,
      kids.length ? `孩子 ${kids.map((a) => `${Math.max(0, Math.round(a))} 歲`).join('、')}${grown ? `，${grown} 人已獨立` : ''}` : undefined);
  }
  for (const r of p.recurringExpenses) pushExpense(r.label, r.monthly, `還剩 ${r.monthsLeft} 個月`);
  for (const l of p.liabilities) {
    if (_securedIds.has(l.id)) continue;
    pushExpense(`${l.name} 月付`, l.monthlyPayment ?? 0, `餘額 $${l.totalDebt.toLocaleString()}`);
  }
  for (const a of p.assets.filter((x) => x.monthlyCashflow < 0)) pushExpense(`${a.name}（資產淨支出）`, -a.monthlyCashflow);
  const cashflowBreakdown = {
    income: incomeItems,
    expenses: expenseItems,
    totalIncome: p.totalIncome,
    totalExpenses: p.totalExpenses,
    net: p.monthlyCashflow,
  };
  // 手頭現金的來源：最近的現金變動紀錄
  const cashLedger = [...p.eventLog].reverse()
    .filter((e) => e.cashAfter !== e.cashBefore)
    .slice(0, 20)
    .map((e) => ({ age: e.age, type: e.type, description: e.description, delta: e.cashAfter - e.cashBefore, cashAfter: e.cashAfter }));
  const startingCash = p.eventLog.length > 0 ? p.eventLog[0].cashBefore : p.cash;
  cashLedger.push({ age: p.startAge ?? 20, type: 'game_start', description: '起始現金（職業起始資金 + 社會階層加成 + 資源點數）', delta: startingCash, cashAfter: startingCash });

  return {
    id: p.id,
    name: p.name,
    profession: p.profession,
    cashflowBreakdown,
    salaryItems: buildSalaryItems(p),
    netWorthBreakdown: buildNetWorthBreakdown(p),
    actionInfo: buildActionInfo(p, gs),
    cashLedger,
    careerOptions: p.isAlive && p.stats.careerSkill >= SKILL_CAREER_CHANGE_THRESHOLD ? buildAvailableProfessions(p) : [],
    careerBlockReason: careerBlockReason(p, gs),
    careerQueuePosition: gs.careerRequests.findIndex((r) => r.playerId === p.id) + 1,
    quadrant: p.profession.quadrant,
    salaryType: p.profession.salaryType,
    currentPosition: p.currentPosition,
    isAlive: p.isAlive,
    cash: p.cash,
    salary: p.salary,
    expenses: { ...p.expenses, rent: p.rentExpense, otherExpenses: p.livingExpenses + p.worldExpenseAdjustment, insurancePremiums, childExpenses, unsecuredLoanPayments, socialInsurance: p.socialInsurance, recurringExpenses: p.recurringExpenseTotal },
    currentAge: p.currentAge,
    housing: p.housing,
    homeOffers: p.isAlive && !p.isBedridden ? getHomeOffers(p) : [],
    spouse: p.spouse,
    spouseIncome: p.spouseIncome,
    lifestyle: p.lifestyle,
    healthHabit: p.healthHabit,
    childBirthAges: p.childBirthAges,
    salaryGrowthMultiplier: p.salaryGrowthMultiplier,
    livingCostMultiplier: p.livingCostMultiplier,
    recurringExpenses: p.recurringExpenses,
    layoffMonthsTotal: p.layoffMonthsTotal,
    naturalDeathProbability: naturalDeathProbability(p),
    assets: p.assets.map((asset) => ({ ...asset, monthlyCashflow: asset.monthlyCashflow > 0
      ? Math.round(asset.monthlyCashflow * p.worldEffects.reduce((factor, entry) =>
        entry.effect.type === 'CashflowChange' && entry.effect.targetAssetType === asset.type
          ? factor * (entry.effect.multiplier ?? 1) : factor, 1)) : asset.monthlyCashflow })),
    liabilities: p.liabilities,
    insurance: p.insurance,
    numberOfChildren: p.numberOfChildren,
    congratulationsReceived: p.congratulationsReceived,
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
    salaryMultiplierPending: p.salaryMultiplierPending,
    salaryMultiplierMonths: p.salaryMultiplierMonths,
    salaryBonus: p.salaryBonus,
    startAge: p.startAge ?? 20,
    personalAge,
    retirementStatus: p.retirementStatus,
    pensionMonthly: p.pensionMonthly,
    isSenior: p.isSenior,
    isMarried: p.isMarried,
    marriageBonus: p.marriageBonus,
    relationshipPoints: p.relationshipPoints,
    relationshipActive: p.relationshipActive,
    marriageType: p.marriageType,
    isBedridden: p.isBedridden,
    travelPenaltyRemaining: p.travelPenaltyRemaining,
    isInFastTrack: p.isInFastTrack,
    hasPassedSecondLife: p.hasPassedSecondLife,
    secondLifeProgress: buildSecondLifeProgress(p),
    fastTrackPosition: p.fastTrackPosition,
    visitedDestinations: p.visitedDestinations ?? [],
    legacyBonusPoints: p.legacyBonusPoints ?? 0,
    taxPlanningCreditRate: p.taxPlanningCreditRate ?? 0,
    educationTurnsToSkip: p.educationTurnsToSkip ?? 0,
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
    legacyActionUsed: p.legacyActionUsed,
    charityTotal: p.charityTotal ?? 0,
    bucketList: p.bucketList ?? [],
    bucketGoals: describeBucketList(p, gs),
    retirementOutlook: buildRetirementOutlook(p, gs),
    mentorCount: p.mentorCount ?? 0,
    lastMentorRound: p.lastMentorRound ?? -1,
    adviceGiven: p.adviceGiven ?? 0,
    lastAdviceRound: p.lastAdviceRound ?? -1,
    milestonesPassed: p.milestonesPassed ?? { age40: false, age60: false, age80: false },
  };
}

export function serializeGameState(gs: GameState): object {
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
    hasAdmin: hasRoomAdmin(gs),
    gameStartTime: gs.gameStartTime,
    gameDurationMs: gs.gameDurationMs,
    remainingTimeMs: getRemainingActivityTimeMs(gs),
    isPaused: gs.pausedAt !== null,
    // 只有主持人手動暫停才為 true；決策階段與舞台事件的自動暫停不算
    isManuallyPaused: gs.pausedAt !== null && !gs.decisionPhase && !gs.facilitatorScene,
    readingAutoContinueMs: gs.readingAutoContinueMs,
    marriageGiftOverride: gs.marriageGiftOverride,
    restoredAt: gs.restoredAt,
    monthsPerRound: gs.monthsPerRound || MONTHS_PER_ROUND,
    autoRevealOnSubmit: gs.autoRevealOnSubmit,
    autoHost: gs.autoHost,
    communityChoiceAuto: gs.communityChoiceAuto,
    reviewView: gs.gamePhase === GamePhase.GameOver ? (gs.reviewView ?? null) : null,
    bondRateAnnual: currentBondRate(gs),
    adviceCards: ADVICE_CARDS,
    actionPhaseDone: gs.decisionPhase?.playerId === '__all_players__' && (gs.decisionPhase.kind === 'actions' || gs.decisionPhase.kind === 'payday') ? [...gs.actionPhaseDone] : [],
    actionPhaseEnabled: gs.actionPhaseEnabled,
    activeAuctions: Object.entries(gs.activeAuctions ?? {}).map(([auctionId, a]) => ({
      auctionId,
      dealCardId: a.dealCardId,
      triggeredBy: a.triggeredBy,
      triggeredByName: a.triggeredByName,
      minBid: a.minBid,
      highestBid: a.highestBid,
      highestBidderId: a.highestBidderId,
      endsAt: a.endTime,
      cardInfo: a.cardInfo,
      isSpecialAuction: a.isSpecialAuction ?? false,
      bids: a.bids ?? [],
    })),
    currentAge: Math.round(currentAge * 10) / 10,
    currentStage,
    completedLifeRounds: gs.turnNumber,
    yearsPerRound: YEARS_PER_COMPLETED_ROUND,
    totalLifeRounds: TOTAL_LIFE_ROUNDS,
    roundsSinceGlobalPayday: gs.roundsSinceGlobalPayday,
    paydayTimer: {
      enabled: gs.paydayTimerEnabled,
      intervalMs: gs.paydayIntervalMs,
      remainingMs: paydayRemainingMs(gs),
      roundsSince: gs.turnNumber - gs.roundsAtLastPayday,
      // 薪水每輪已入帳，人生規劃不再結算月數（保留欄位給舊畫面）
      settlementMonths: 0,
      due: isPaydayDue(gs) || gs.globalPaydayPending,
      frozen: gs.paydayPausedAt !== null,
      maxRounds: PAYDAY_MAX_ROUNDS,
    },
    monthsPerRoundPaid: gs.monthsPerRound || MONTHS_PER_ROUND,
    globalPaydayPending: gs.globalPaydayPending,
    globalPaydayInProgress: gs.globalPaydayInProgress,
    globalPaydayNumber: gs.globalPaydayNumber,
    basicInvestmentOffers: gs.globalPaydayInProgress ? BASIC_INVESTMENTS : [],
    finalRoundStarted: gs.finalRoundStarted,
    finalRoundPendingPlayerIds: gs.finalRoundPendingPlayerIds,
    decisionPhase: gs.decisionPhase,
    facilitatorScene: gs.facilitatorScene,
    turnInProgress: gs.turnInProgress,
    careerRequests: gs.careerRequests.filter(r => gs.players.get(r.playerId)?.isAlive).map(r => ({
      ...r, playerName: gs.players.get(r.playerId)!.name,
      professionName: PROFESSIONS.find(p => p.id === r.professionId)?.name ?? r.professionId,
    })),
  };
}

export function buildAffordableOptions(player: Player, settlementMonths = 1): object {
  const {
    HP_MAINTENANCE_COST: maintCost,
    HP_BOOST_COST: boostCost,
    SKILL_TRAINING_COST: skillCost,
    NETWORK_INVEST_COST: ntCost,
    SKILL_CAREER_CHANGE_THRESHOLD,
  } = require('./gameConfig');

  const fqCost = getFQUpgradeCost(player.stats.financialIQ);
  const coveredMonths = Math.min(12, Math.max(1, Math.floor(settlementMonths)));
  const totalMaintenanceCost = maintCost * coveredMonths;
  const totalBoostCost = boostCost + maintCost * (coveredMonths - 1);

  const cfg = require('./gameConfig') as typeof import('./gameConfig');
  const decay = cfg.HP_DECAY_BY_STAGE[player.lifeStage] ?? 0;
  const habitMult = (cfg.HEALTH_HABIT_OPTIONS[player.healthHabit] ?? cfg.HEALTH_HABIT_OPTIONS.normal).decayMultiplier;
  const passiveNow = Math.max(0, player.totalPassiveIncome);
  const fqNow = FQ_MULTIPLIERS[player.stats.financialIQ] ?? 1;
  const fqNext = FQ_MULTIPLIERS[Math.min(10, player.stats.financialIQ + 1)] ?? fqNow;
  return {
    fqUpgrade: {
      available: fqCost !== null && player.cash >= fqCost,
      cost: fqCost,
      currentFQ: player.stats.financialIQ,
      nextFQ: Math.min(10, player.stats.financialIQ + 1),
      currentMultiplier: fqNow, nextMultiplier: fqNext,
      passiveGainPerMonth: Math.round(passiveNow * (fqNext - fqNow)),
      value: `被動收入乘數 ×${fqNow} → ×${fqNext}${passiveNow ? `（目前被動收入 $${passiveNow.toLocaleString()} → 每月多 $${Math.round(passiveNow * (fqNext - fqNow)).toLocaleString()}）` : '（之後買資產都會放大）'}；FQ ≥ 7 發薪時看得到股市內幕`,
    },
    healthMaintenance: { available: player.cash >= totalMaintenanceCost, cost: totalMaintenanceCost,
      value: `本次不衰退：省下 ${Math.round(decay * habitMult)} HP × ${coveredMonths} 輪（${player.lifeStage === 'Youth' ? '青年期' : player.lifeStage === 'Family' ? '成家期' : player.lifeStage === 'Transition' ? '轉型期' : '高齡'}每輪自然衰退 ${decay}${habitMult !== 1 ? `，健康習慣 ×${habitMult}` : ''}）` },
    healthBoost: { available: player.cash >= totalBoostCost, cost: totalBoostCost,
      value: `HP ${player.stats.health} → ${Math.min(100, player.stats.health + cfg.HP_BOOST_AMOUNT)}，並含本次維護；HP ≥ 70 完成人生指標「健康」、危機費用減半；< 50 不能旅遊、< 40 不能聯誼` },
    skillTraining: { available: player.cash >= skillCost && player.stats.careerSkill < SKILL_CAREER_CHANGE_THRESHOLD, cost: skillCost, currentSK: player.stats.careerSkill,
      value: `SK ${player.stats.careerSkill} → ${Math.min(100, player.stats.careerSkill + 20)}；${player.profession.salaryType === 'sk_driven' ? `技能驅動職業：月薪 +$${((player.profession.salaryPerSK ?? 0) * 20).toLocaleString()}；` : ''}≥ 60 每輪多加薪 2%、裁員月數減半、完成人生指標「成長」；100 可申請轉職；退休顧問收入 SK × 300` },
    networkInvest: { available: player.cash >= ntCost && player.stats.network < (player.profession.salaryType === 'nt_driven' ? Infinity : 10), cost: ntCost, currentNT: player.stats.network,
      value: `NT ${player.stats.network} → ${player.stats.network + 1}；${player.profession.salaryType === 'nt_driven' ? `人脈驅動職業：月薪 +$${(player.profession.salaryPerNT ?? 0).toLocaleString()}；` : ''}≥ 3 有一次人脈護盾免除危機；≥ 5 交易抽 2 張擇一、父母事件親友分攤減半、退休創業擲骰 +1；退休顧問收入 NT × 3,000` },
  };
}

/** 已達 SK 100 但暫時不能申請轉職的原因（手機顯示，不再默默藏起清單） */
export function careerBlockReason(p: Player, gs: GameState): string | null {
  if (!p.isAlive || p.stats.careerSkill < SKILL_CAREER_CHANGE_THRESHOLD) return null;
  if (p.isBedridden) return '臥床中無法轉職，先恢復健康';
  if (p.stats.health < HP_ACTIVITY_THRESHOLDS.careerChange) return `健康值 ${p.stats.health} 未達 ${HP_ACTIVITY_THRESHOLDS.careerChange}，先在發薪規劃投資健康`;
  if (gs.facilitatorScene?.kind === 'career' && gs.facilitatorScene.careerPlayerId === p.id) return null;
  if (gs.careerRequests.some((r) => r.playerId === p.id)) return null;
  return null;
}

export function buildAvailableProfessions(player: Player): object[] {
  const { getCareerChangeAssetCost } = require('./statsSystem');
  return PROFESSIONS
    .filter((p) => p.id !== player.profession.id)
    .map((p) => {
      const assetCost = getCareerChangeAssetCost(p.id);
      const startingCashflow = (p.startingAssets ?? []).reduce((sum, a) => sum + a.monthlyCashflow, 0);
      return {
        id: p.id,
        name: p.name,
        quadrant: p.quadrant,
        salaryType: p.salaryType,
        salary: p.startingSalary,
        salaryRange: p.salaryType === 'random' ? [p.minSalary ?? 0, p.maxSalary ?? 0] : undefined,
        salaryPerNT: p.salaryPerNT, salaryBase: p.salaryBase, salaryPerSK: p.salaryPerSK,
        startingCashflow,
        otherExpenses: p.startingOtherExpenses,
        creditCard: p.startingCreditCard,
        flexible: p.hasFlexibleSchedule,
        startingFQ: p.startingFQ,
        assetCost, // 轉職到 B/I 需從現金扣除的「自有資產成本」
        canAfford: assetCost === 0 || player.cash >= assetCost,
      };
    });
}
