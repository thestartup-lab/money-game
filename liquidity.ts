/**
 * 流動資產：債券基金、定期定額、股票可以隨時賣出換現金。
 * 大交易的頭期款動輒上百萬，大家的錢多半放在債券和基金裡；抽到交易或得標時，
 * 允許本人用這些流動資產補足頭期款（系統依序部分賣出），不必先在別的時段賣。
 */
import type { Player } from './gameDataModels';
import { isPartiallySellable, sellAsset } from './gameLogic';

/** 賣出順序：債券（本金穩定）→ 定期定額 → 其他股票 */
function liquidAssets(player: Player) {
  const rank = (id: string) => (id === 'bond-fund' ? 0 : id === 'stock-dca' ? 1 : 2);
  return player.assets.filter((a) => isPartiallySellable(a) && a.currentValue > 0).sort((a, b) => rank(a.id) - rank(b.id));
}

/** 流動資產全部賣掉大約能拿回多少現金（未扣資本利得稅，給畫面估算用） */
export function liquidValue(player: Player): number {
  return liquidAssets(player).reduce((sum, a) => sum + a.currentValue, 0);
}

/**
 * 依序賣出流動資產，直到現金 ≥ target；回傳賣出的明細。
 * 部分賣出時多賣一點，把資本利得稅也算進去。
 */
export function raiseCashFromLiquid(player: Player, target: number): { sold: string[]; enough: boolean } {
  const sold: string[] = [];
  for (const asset of liquidAssets(player)) {
    if (player.cash >= target) break;
    const shortfall = target - player.cash;
    const gainShare = asset.currentValue > 0 ? Math.max(0, 1 - (asset.cost ?? 0) / asset.currentValue) : 0;
    const grossNeeded = shortfall / Math.max(0.5, 1 - gainShare * 0.2);
    const fraction = Math.min(1, grossNeeded / asset.currentValue + 0.001);
    const result = sellAsset(player, asset.id, fraction >= 0.999 ? 1 : fraction);
    if (result.success) sold.push(`${asset.name} $${(result.proceeds ?? 0).toLocaleString()}`);
  }
  return { sold, enough: player.cash >= target };
}
