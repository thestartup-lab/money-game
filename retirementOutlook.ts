import type { GameState, Player } from './gameDataModels';
import { computePension, getCurrentAge } from './gameLogic';
import { HEALTH_HABIT_OPTIONS, RETIREMENT_LIVING_COST_FACTOR, RETIREMENT_OUTLOOK_AGE, SPOUSE_RETIRED_RATIO } from './gameConfig';
import { FQ_MULTIPLIERS } from './gameConstants';

/**
 * 退休準備度（55 歲起、還在全職工作時顯示）：用目前的數字估算「65 歲退休後」每月收支。
 * 收入 = 退休金（至少基本年金）+ 被動收入 + 配偶（退休後 40%）；支出 = 現在支出 − 勞健保 − 生活支出兩成。
 */
export function buildRetirementOutlook(p: Player, gs: GameState) {
  const age = Math.max(p.startAge ?? 20, getCurrentAge(gs));
  if (!p.isAlive || p.retirementStatus !== 'working' || p.isInFastTrack || age < RETIREMENT_OUTLOOK_AGE) return null;
  const pension = computePension(p);
  const fq = FQ_MULTIPLIERS[p.stats.financialIQ] ?? 1;
  const passive = Math.round(Math.max(0, p.totalPassiveIncome) * fq);
  const spouse = p.spouse && !p.spouse.retired ? Math.round(p.spouse.income * SPOUSE_RETIRED_RATIO) : p.spouseIncome;
  const livingCut = Math.round((p.livingExpenses - (HEALTH_HABIT_OPTIONS[p.healthHabit]?.monthlyCost ?? 0) + p.spouseLivingExpenses) * (1 - RETIREMENT_LIVING_COST_FACTOR));
  const expensesAfter = Math.max(0, p.totalExpenses - p.socialInsurance - livingCut);
  const incomeAfter = pension + passive + spouse;
  const gap = incomeAfter - expensesAfter;
  const yearsCovered = gap >= 0 ? null : Math.floor(Math.max(0, p.cash) / (-gap * 12));
  return {
    age: Math.round(age), yearsToRetire: Math.max(0, Math.ceil((65 - age) / 4) * 4),
    pension, passive, spouse, incomeAfter, expensesAfter, gap, yearsCovered,
    passiveNeeded: gap >= 0 ? 0 : Math.round(-gap / fq),
  };
}

