import { Player, AssetType } from './gameDataModels';

/**
 * 職業自帶的房貸與車貸原本只是「每月支出」，沒有本金，玩家無法提前還款。
 * 這裡把它們具象成「自住房 / 自用車」資產 + 對應負債：
 * - 資產與負債同額，淨值不變；資產綁定負債，所以不占信用借款額度。
 * - 月付仍由 expenses.homeMortgagePayment / carLoanPayment 計算（totalExpenses 不重複計算有擔保負債）。
 * - 提前還款會等比例降低月付；還清後負債移除、資產保留。
 */
export const HOME_LOAN_MONTHS = 240;
export const CAR_LOAN_MONTHS = 60;

export const homeLoanId = (playerId: string) => `home-loan-${playerId}`;
export const carLoanId = (playerId: string) => `car-loan-${playerId}`;
export const homeAssetId = (playerId: string) => `home-${playerId}`;
export const carAssetId = (playerId: string) => `car-${playerId}`;

export function isHouseholdLoan(liabilityId: string): boolean {
  return liabilityId.startsWith('home-loan-') || liabilityId.startsWith('car-loan-');
}

export function isHouseholdAsset(assetId: string): boolean {
  return assetId.startsWith('home-') || assetId.startsWith('car-');
}

function ensure(player: Player, kind: 'home' | 'car'): void {
  const payment = kind === 'home' ? player.expenses.homeMortgagePayment : player.expenses.carLoanPayment;
  const liabilityId = kind === 'home' ? homeLoanId(player.id) : carLoanId(player.id);
  const assetId = kind === 'home' ? homeAssetId(player.id) : carAssetId(player.id);
  const existing = player.liabilities.find((l) => l.id === liabilityId);

  if (payment <= 0) {
    // 沒有月付：移除負債，資產（已付清的房或車）保留
    if (existing) player.liabilities = player.liabilities.filter((l) => l.id !== liabilityId);
    const asset = player.assets.find((a) => a.id === assetId);
    if (asset && asset.linkedLiabilityId === liabilityId) asset.linkedLiabilityId = undefined;
    return;
  }
  if (existing) {
    existing.monthlyPayment = payment;
    return;
  }
  const months = kind === 'home' ? HOME_LOAN_MONTHS : CAR_LOAN_MONTHS;
  const principal = payment * months;
  player.liabilities.push({
    id: liabilityId,
    name: kind === 'home' ? '房貸（自住房）' : '車貸（自用車）',
    totalDebt: principal,
    monthlyPayment: payment,
  });
  const asset = player.assets.find((a) => a.id === assetId);
  if (asset) {
    asset.linkedLiabilityId = liabilityId;
    asset.currentValue = Math.max(asset.currentValue, principal);
  } else {
    player.assets.push({
      id: assetId,
      name: kind === 'home' ? '自住房' : '自用車',
      type: AssetType.Other,
      cost: principal,
      currentValue: principal,
      monthlyCashflow: 0,
      linkedLiabilityId: liabilityId,
    });
  }
}

/** 依目前的房貸／車貸月付，建立或同步對應的資產與負債。職業指派後呼叫。 */
export function syncHouseholdLoans(player: Player): void {
  ensure(player, 'home');
  ensure(player, 'car');
}

/**
 * 房貸／車貸提前還款後，月付依剩餘本金等比例調降；還清時月付歸零、負債移除。
 * 由 repayLoan 在扣除本金之後呼叫。
 */
export function applyHouseholdRepayment(player: Player, liabilityId: string, debtBefore: number, debtAfter: number): void {
  if (!isHouseholdLoan(liabilityId)) return;
  const isHome = liabilityId.startsWith('home-loan-');
  const field = isHome ? 'homeMortgagePayment' : 'carLoanPayment';
  if (debtAfter <= 0 || debtBefore <= 0) {
    player.expenses[field] = 0;
    const assetId = isHome ? homeAssetId(player.id) : carAssetId(player.id);
    const asset = player.assets.find((a) => a.id === assetId);
    if (asset) asset.linkedLiabilityId = undefined;
    return;
  }
  const newPayment = Math.round(player.expenses[field] * (debtAfter / debtBefore));
  player.expenses[field] = Math.max(0, newPayment);
  const liability = player.liabilities.find((l) => l.id === liabilityId);
  if (liability) liability.monthlyPayment = player.expenses[field];
}
