import { AssetType, Asset, Player } from './gameDataModels';
import {
  PROPERTY_EVENT_CHANCE, PROPERTY_VACANCY_MONTHS, PROPERTY_REPAIR_RATE, PROPERTY_REPAIR_MIN, PROPERTY_RENT_RAISE_RATE,
} from './gameConfig';

/**
 * 當房東的真實風險：租客退租空置、房屋大修，以及隨物價調漲租金。
 * 只在「意外支出」格觸發，取代原本的意外支出卡；沒有房產的玩家不受影響。
 */
export type PropertyEventKind = 'vacancy' | 'repair' | 'rentRaise';

export interface PropertyEventResult {
  kind: PropertyEventKind;
  title: string;
  description: string;
  assetId: string;
  assetName: string;
  cashChange: number;
  monthlyChange: number;
  months?: number;
}

/** 正在出租、會產生租金的房地產（自住房不算） */
export function rentalProperties(player: Player): Asset[] {
  return player.assets.filter((a) => a.type === AssetType.RealEstate && !a.isResidence && a.monthlyCashflow > 0);
}

/** 需要維修的房子：出租房與自住房（租屋族不用修房子） */
export function repairableProperties(player: Player): Asset[] {
  return player.assets.filter((a) => a.type === AssetType.RealEstate && (a.isResidence || a.monthlyCashflow > 0));
}

export function isVacant(asset: Asset): boolean {
  return (asset.vacantMonthsLeft ?? 0) > 0;
}

/**
 * 落在意外支出格時先擲房東事件；回傳 null 代表照常抽意外支出卡。
 * rng 可注入，方便測試。
 */
export function rollPropertyEvent(player: Player, rng: () => number = Math.random): PropertyEventResult | null {
  const rentals = rentalProperties(player).filter((a) => !isVacant(a));
  const repairable = repairableProperties(player);
  if (repairable.length === 0) return null;
  if (rng() >= PROPERTY_EVENT_CHANCE) return null;

  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const roll = rng();
  if (rentals.length > 0 && roll < 0.4) {
    const asset = pick(rentals);
    asset.vacantMonthsLeft = PROPERTY_VACANCY_MONTHS;
    return {
      kind: 'vacancy', title: '租客退租，房子空著',
      description: `${asset.name} 的租客搬走了，找到新租客前 ${PROPERTY_VACANCY_MONTHS} 個月沒有租金（每月少 $${asset.monthlyCashflow.toLocaleString()}），房貸照繳。`,
      assetId: asset.id, assetName: asset.name, cashChange: 0, monthlyChange: -asset.monthlyCashflow, months: PROPERTY_VACANCY_MONTHS,
    };
  }
  if (rentals.length > 0 && roll >= 0.8) {
    const asset = pick(rentals);
    const raise = Math.max(100, Math.round(asset.monthlyCashflow * PROPERTY_RENT_RAISE_RATE));
    asset.monthlyCashflow += raise;
    return {
      kind: 'rentRaise', title: '續約調漲租金',
      description: `${asset.name} 續約，租金隨行情調漲，每月現金流 +$${raise.toLocaleString()}。`,
      assetId: asset.id, assetName: asset.name, cashChange: 0, monthlyChange: raise,
    };
  }
  const asset = pick(repairable);
  const cost = Math.max(PROPERTY_REPAIR_MIN, Math.round((asset.currentValue ?? asset.cost) * PROPERTY_REPAIR_RATE));
  const paid = Math.min(cost, Math.max(0, player.cash));
  player.cash -= paid;
  return {
    kind: 'repair', title: asset.isResidence ? '自住房要大修' : '出租房要大修',
    description: `${asset.name} 的屋頂漏水、管線老舊，修繕費 $${cost.toLocaleString()}（房價的 ${Math.round(PROPERTY_REPAIR_RATE * 100)}%）${paid < cost ? `，現金只夠付 $${paid.toLocaleString()}` : ''}。有房子就有維修成本，租屋族不用負擔。`,
    assetId: asset.id, assetName: asset.name, cashChange: -paid, monthlyChange: 0,
  };
}

/** 每個結算月遞減空置月數 */
export function tickVacancies(player: Player): void {
  for (const asset of player.assets) {
    if ((asset.vacantMonthsLeft ?? 0) > 0) asset.vacantMonthsLeft = (asset.vacantMonthsLeft ?? 0) - 1;
  }
}
