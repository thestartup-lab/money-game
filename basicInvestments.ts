import { AssetType, Player } from './gameDataModels';

/** 公開基本機會：每人每期最多一份，不搶全桌庫存，不附攻略排名。
 * 報酬是遊戲數值，低於地圖高報酬交易；股票／事業仍受市場事件影響。
 */
export const BASIC_INVESTMENTS = [
  { id: 'basic-deposit', name: '基本定存', cost: 15000, monthlyCashflow: 120,
    type: AssetType.Other, description: '每月收入 $120；不參與股票與房地產行情，仍可能受全場事件影響。' },
  { id: 'basic-dividend', name: '配息基金小額份額', cost: 30000, monthlyCashflow: 360,
    type: AssetType.Stock, description: '每月基礎收入 $360；市值與收入可能受股票市場事件影響。' },
  { id: 'basic-business', name: '社區事業小額份額', cost: 45000, monthlyCashflow: 750,
    type: AssetType.Business, description: '每月基礎收入 $750；市值與收入可能受事業景氣事件影響。' },
] as const;

const purchases = new WeakMap<Player, Set<number>>();

export function buyBasicInvestment(player: Player, id: string | undefined, paydayNumber: number) {
  const offer = BASIC_INVESTMENTS.find(item => item.id === id);
  const used = purchases.get(player) ?? new Set<number>();
  if (!id) return { success: false, message: '本期不購買基本投資。' };
  if (!offer || !Number.isSafeInteger(paydayNumber) || paydayNumber < 1)
    return { success: false, message: '基本投資項目無效，未扣款。' };
  if (!player.isAlive || used.has(paydayNumber))
    return { success: false, message: '本期已購買或角色無法投資，未重複扣款。' };
  if (player.cash < offer.cost)
    return { success: false, message: '配置後現金不足，基本投資未執行。' };
  player.cash -= offer.cost;
  player.assets.push({ id: `basic-${player.id}-${paydayNumber}`, name: offer.name,
    type: offer.type, cost: offer.cost, currentValue: offer.cost, monthlyCashflow: offer.monthlyCashflow });
  used.add(paydayNumber);
  purchases.set(player, used);
  return { success: true, name: offer.name, cost: offer.cost, monthlyCashflow: offer.monthlyCashflow,
    message: `購入${offer.name}，支付 $${offer.cost.toLocaleString()}，每月基礎收入 $${offer.monthlyCashflow.toLocaleString()}。` };
}
