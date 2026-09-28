import { AssetType, Player } from './gameDataModels';
import { BOND_FUND_MONTHLY_YIELD } from './gameConfig';

/**
 * 債券基金（高股息）：給「存很多現金、沒時間找交易」的玩家一條穩定的被動收入路。
 * - 不限額，任何時間的自由操作或發薪規劃都能投入
 * - 本金不隨股市行情卡漲跌（資產類型 Other），每月配息 = 本金 × 月殖利率，算被動收入
 * - 報酬刻意低於定期定額：安全但慢；出售時本金全額拿回，沒有資本利得
 */
export const BOND_FUND_ID = 'bond-fund';

export interface BondResult { success: boolean; message: string; amount?: number; principal?: number; monthlyIncome?: number }

export function investBondFund(player: Player, amount: number): BondResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { success: false, message: '投入金額必須是正整數。' };
  if (player.cash < amount) return { success: false, message: `現金不足（需要 $${amount.toLocaleString()}）。` };
  player.cash -= amount;
  const existing = player.assets.find((a) => a.id === BOND_FUND_ID);
  const principal = (existing?.cost ?? 0) + amount;
  const monthlyIncome = Math.round(principal * BOND_FUND_MONTHLY_YIELD);
  if (existing) {
    existing.cost = principal;
    existing.currentValue = principal;
    existing.monthlyCashflow = monthlyIncome;
  } else {
    player.assets.push({ id: BOND_FUND_ID, name: '債券基金（高股息）', type: AssetType.Other, cost: principal, currentValue: principal, monthlyCashflow: monthlyIncome });
  }
  return { success: true, amount, principal, monthlyIncome,
    message: `投入債券基金 $${amount.toLocaleString()}：本金 $${principal.toLocaleString()}，每月配息 +$${monthlyIncome.toLocaleString()}。` };
}
