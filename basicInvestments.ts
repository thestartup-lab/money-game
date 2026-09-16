import { AssetType, Player } from './gameDataModels';

/** 公開基本機會：每人每期最多一種、最多 10 份，不搶全桌庫存，不附攻略排名。
 * 報酬是遊戲數值，低於地圖高報酬交易；股票／事業仍受市場事件影響。
 */
export const BASIC_INVESTMENTS = [
  { id: 'basic-deposit', name: '基本定存', cost: 15000, monthlyCashflow: 60,
    type: AssetType.Other, description: '每月收入 $60（年化約 4.8%）；不參與股票與房地產行情，仍可能受全場事件影響。' },
  { id: 'basic-dividend', name: '配息基金小額份額', cost: 30000, monthlyCashflow: 200,
    type: AssetType.Stock, description: '每月基礎收入 $200（年化 8%）；市值與收入可能受股票市場事件影響。' },
  { id: 'basic-business', name: '社區事業小額份額', cost: 45000, monthlyCashflow: 450,
    type: AssetType.Business, description: '每月基礎收入 $450（年化 12%）；市值與收入可能受事業景氣事件影響。' },
] as const;

const purchases = new WeakMap<Player, Set<number>>();

export const BASIC_INVESTMENT_MAX_QUANTITY = 10;

export function buyBasicInvestment(player: Player, id: string | undefined, paydayNumber: number, quantity = 1) {
  const offer = BASIC_INVESTMENTS.find(item => item.id === id);
  const used = purchases.get(player) ?? new Set<number>();
  if (!id) return { success: false, message: '本期不購買基本投資。' };
  if (!offer || !Number.isSafeInteger(paydayNumber) || paydayNumber < 1)
    return { success: false, message: '基本投資項目無效，未扣款。' };
  if (!player.isAlive || used.has(paydayNumber))
    return { success: false, message: '本期已購買或角色無法投資，未重複扣款。' };
  const qty = Math.min(BASIC_INVESTMENT_MAX_QUANTITY, Math.max(1, Math.floor(Number.isFinite(quantity) ? quantity : 1)));
  const totalCost = offer.cost * qty;
  const totalFlow = offer.monthlyCashflow * qty;
  if (player.cash < totalCost)
    return { success: false, message: `配置後現金不足（${qty} 份需 $${totalCost.toLocaleString()}），基本投資未執行。` };
  player.cash -= totalCost;
  player.assets.push({ id: `basic-${player.id}-${paydayNumber}`, name: qty > 1 ? `${offer.name} ×${qty}` : offer.name,
    type: offer.type, cost: totalCost, currentValue: totalCost, monthlyCashflow: totalFlow });
  used.add(paydayNumber);
  purchases.set(player, used);
  return { success: true, name: offer.name, cost: totalCost, monthlyCashflow: totalFlow, quantity: qty,
    message: `購入${offer.name} ${qty} 份，支付 $${totalCost.toLocaleString()}，每月基礎收入 $${totalFlow.toLocaleString()}。` };
}
