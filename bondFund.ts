import { AssetType, GameState, Player } from './gameDataModels';
import { BOND_RATE_START_ANNUAL, BOND_RATE_MIN_ANNUAL, BOND_RATE_MAX_ANNUAL, BOND_RATE_STEPS } from './gameConfig';

/**
 * 債券基金（高股息）：給「存很多現金、沒時間找交易」的玩家一條穩定的被動收入路。
 * - 不限額，任何時間的自由操作或發薪規劃都能投入
 * - 本金不隨股市行情卡漲跌（資產類型 Other），每月配息 = 本金 × 月殖利率，算被動收入
 * - 報酬刻意低於定期定額：安全但慢；出售時本金全額拿回，沒有資本利得
 * - 殖利率跟著全場利率環境浮動（gs.bondRateAnnual），已持有的配息會跟著重算
 */
export const BOND_FUND_ID = 'bond-fund';

export interface BondResult { success: boolean; message: string; amount?: number; principal?: number; monthlyIncome?: number }

/** 目前利率下，一筆本金每月的配息 */
export function bondMonthlyIncome(principal: number, annualRate: number): number {
  return Math.round(principal * annualRate / 12);
}

export function currentBondRate(gs?: GameState | null): number {
  const rate = gs?.bondRateAnnual;
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : BOND_RATE_START_ANNUAL;
}

/** 利率變動後，所有玩家已持有的債券基金配息跟著新利率重算 */
export function repriceBondFunds(gs: GameState): void {
  const rate = currentBondRate(gs);
  for (const player of gs.players.values()) {
    const bond = player.assets.find((a) => a.id === BOND_FUND_ID);
    if (bond) bond.monthlyCashflow = bondMonthlyIncome(bond.cost, rate);
  }
}

/** 調整利率（delta 省略時隨機走一步），夾在上下限內；回傳調整前後 */
export function shiftBondRate(gs: GameState, delta?: number): { from: number; to: number } {
  const from = currentBondRate(gs);
  const step = delta ?? BOND_RATE_STEPS[Math.floor(Math.random() * BOND_RATE_STEPS.length)];
  const to = Math.round(Math.min(BOND_RATE_MAX_ANNUAL, Math.max(BOND_RATE_MIN_ANNUAL, from + step)) * 1000) / 1000;
  gs.bondRateAnnual = to;
  if (to !== from) repriceBondFunds(gs);
  return { from, to };
}

export function investBondFund(player: Player, amount: number, annualRate = BOND_RATE_START_ANNUAL): BondResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { success: false, message: '投入金額必須是正整數。' };
  if (player.cash < amount) return { success: false, message: `現金不足（需要 $${amount.toLocaleString()}）。` };
  player.cash -= amount;
  const existing = player.assets.find((a) => a.id === BOND_FUND_ID);
  const principal = (existing?.cost ?? 0) + amount;
  const monthlyIncome = bondMonthlyIncome(principal, annualRate);
  if (existing) {
    existing.cost = principal;
    existing.currentValue = principal;
    existing.monthlyCashflow = monthlyIncome;
  } else {
    player.assets.push({ id: BOND_FUND_ID, name: '債券基金（高股息）', type: AssetType.Other, cost: principal, currentValue: principal, monthlyCashflow: monthlyIncome });
  }
  return { success: true, amount, principal, monthlyIncome,
    message: `投入債券基金 $${amount.toLocaleString()}：本金 $${principal.toLocaleString()}，目前年殖利率 ${(annualRate * 100).toFixed(1)}%，每月配息 +$${monthlyIncome.toLocaleString()}（利率會變動）。` };
}
