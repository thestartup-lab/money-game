/**
 * 現金為負時的處理（2026-09-30 起）：以前現金可以一直是負的，沒有任何後果。
 * 每輪發薪結算後，現金若是負的，依序：
 * 1. 賣出債券、定期定額、股票（像動用存款）
 * 2. 向銀行申請應急借款（信用分 −50）
 * 3. 賣出其他投資資產（不含自住房與自用車）
 * 4. 還是不夠就破產重整：銀行債務註銷、現金歸零、信用分降到 300、生活方式改為節儉、健康 −10
 * 破產不會出局，可以繼續玩，但要從很低的起點重新開始。
 */
import type { GameState, Player } from './gameDataModels';
import { getAvailableLoan, sellAsset, takeEmergencyLoan } from './gameLogic';
import { isHouseholdAsset } from './householdLoans';
import { raiseCashFromLiquid } from './liquidity';

export const BANKRUPTCY_CREDIT_SCORE = 300;
export const BANKRUPTCY_HP_COST = 10;

export interface NegativeCashResolution {
  steps: string[];
  bankrupt: boolean;
}

export function resolveNegativeCash(gs: GameState, player: Player): NegativeCashResolution | null {
  if (!player.isAlive || player.cash >= 0) return null;
  void gs;
  const steps: string[] = [];
  const startingDebt = -player.cash;

  const liquid = raiseCashFromLiquid(player, 0);
  if (liquid.sold.length) steps.push(`賣出 ${liquid.sold.join('、')}`);

  if (player.cash < 0) {
    const amount = Math.min(-player.cash, getAvailableLoan(player));
    if (amount > 0 && takeEmergencyLoan(player, amount).success) steps.push(`應急借款 $${amount.toLocaleString()}（信用分 −50）`);
  }

  if (player.cash < 0) {
    const sellable = player.assets
      .filter((a) => !isHouseholdAsset(a.id) && !a.id.startsWith('home-') && !a.id.startsWith('p2p-'))
      .sort((a, b) => (a.currentValue - (a.cost ?? 0)) - (b.currentValue - (b.cost ?? 0)));
    for (const asset of sellable) {
      if (player.cash >= 0) break;
      const result = sellAsset(player, asset.id);
      if (result.success) steps.push(`賣出 ${asset.name}（淨得 $${(result.netCashChange ?? 0).toLocaleString()}）`);
    }
  }

  let bankrupt = false;
  if (player.cash < 0) {
    bankrupt = true;
    const bankDebts = player.liabilities.filter((l) => l.id.startsWith('emergency-') || l.id.startsWith('leverage-'));
    const forgiven = bankDebts.reduce((sum, l) => sum + l.totalDebt, 0) - player.cash;
    player.liabilities = player.liabilities.filter((l) => !bankDebts.includes(l));
    player.cash = 0;
    player.creditScore = BANKRUPTCY_CREDIT_SCORE;
    player.lifestyle = 'frugal';
    player.stats.health = Math.max(0, player.stats.health - BANKRUPTCY_HP_COST);
    player.bankruptcies = (player.bankruptcies ?? 0) + 1;
    steps.push(`破產重整：註銷約 $${forgiven.toLocaleString()} 的欠款與銀行借款，現金歸零、信用分降到 ${BANKRUPTCY_CREDIT_SCORE}、生活方式改為節儉、健康 −${BANKRUPTCY_HP_COST}`);
  }

  if (steps.length === 0) return null;
  steps.unshift(`現金透支 $${startingDebt.toLocaleString()}`);
  return { steps, bankrupt };
}
