import { Player, AssetType } from './gameDataModels';
import { HOME_OPTIONS, HOME_DOWN_PAYMENT_RATIO, HOME_LOAN_MONTHLY_RATE, HOME_LOAN_TERM_MONTHS, HOME_TRANSACTION_COST_RATE } from './gameConfig';

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

/** 房貸月付（本息平均攤還） */
export function homeLoanPayment(principal: number, monthlyRate = HOME_LOAN_MONTHLY_RATE, months = HOME_LOAN_TERM_MONTHS): number {
  if (principal <= 0) return 0;
  if (monthlyRate <= 0) return Math.ceil(principal / months);
  return Math.round(principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
}

export interface HomeOfferView {
  id: string; name: string; price: number; downPayment: number; loan: number; monthlyPayment: number;
  transactionCost: number; cashNeeded: number; affordable: boolean; reason?: string;
  monthlyDelta: number;
}

/** 手機「買房」清單：每個選項的頭期款、月付與買不起的原因 */
export function getHomeOffers(player: Player): HomeOfferView[] {
  return HOME_OPTIONS.map((o) => {
    const downPayment = Math.round(o.price * HOME_DOWN_PAYMENT_RATIO);
    const loan = o.price - downPayment;
    const monthlyPayment = homeLoanPayment(loan);
    const transactionCost = Math.round(o.price * HOME_TRANSACTION_COST_RATE);
    const cashNeeded = downPayment + transactionCost;
    let reason: string | undefined;
    if (player.housing === 'own') reason = '已經有自住房；想換屋請先出售';
    else if (player.cash < cashNeeded) reason = `現金不足：需要 $${cashNeeded.toLocaleString()}（頭期款 + 交易稅費）`;
    else if (player.isBedridden) reason = '臥床中無法辦理';
    return { id: o.id, name: o.name, price: o.price, downPayment, loan, monthlyPayment, transactionCost, cashNeeded,
      affordable: !reason, reason, monthlyDelta: player.rentExpense - monthlyPayment };
  });
}

export interface BuyHomeResult { success: boolean; message: string; price?: number; downPayment?: number; monthlyPayment?: number; rentSaved?: number }

/** 買自住房：付頭期款＋交易稅費，房租歸零，改繳 30 年房貸；房子是資產（隨房市漲跌） */
export function buyHome(player: Player, optionId: string): BuyHomeResult {
  const offer = getHomeOffers(player).find((o) => o.id === optionId);
  if (!offer) return { success: false, message: '沒有這個房型。' };
  if (!offer.affordable) return { success: false, message: offer.reason ?? '目前無法購買。' };
  const rentSaved = player.rentExpense;
  player.cash -= offer.cashNeeded;
  player.housing = 'own';
  player.expenses.homeMortgagePayment = offer.monthlyPayment;
  const liabilityId = homeLoanId(player.id);
  const assetId = homeAssetId(player.id);
  player.liabilities = player.liabilities.filter((l) => l.id !== liabilityId);
  player.assets = player.assets.filter((a) => a.id !== assetId);
  player.liabilities.push({ id: liabilityId, name: '房貸（自住房）', totalDebt: offer.loan, monthlyPayment: offer.monthlyPayment });
  player.assets.push({ id: assetId, name: `自住房：${offer.name}`, type: AssetType.RealEstate, cost: offer.price, currentValue: offer.price,
    downPayment: offer.downPayment, monthlyCashflow: 0, linkedLiabilityId: liabilityId, isResidence: true });
  return { success: true, message: `買下${offer.name}：頭期款 $${offer.downPayment.toLocaleString()}、稅費 $${offer.transactionCost.toLocaleString()}；每月房貸 $${offer.monthlyPayment.toLocaleString()}，不再付房租 $${rentSaved.toLocaleString()}。`,
    price: offer.price, downPayment: offer.downPayment, monthlyPayment: offer.monthlyPayment, rentSaved };
}

export interface SellHomeResult { success: boolean; message: string; proceeds?: number; debtSettled?: number; transactionCost?: number; netCashChange?: number }

/** 賣自住房：市價 − 剩餘房貸 − 交易稅費；之後回到租屋（月租依職業設定） */
export function sellHome(player: Player): SellHomeResult {
  const assetId = homeAssetId(player.id);
  const asset = player.assets.find((a) => a.id === assetId);
  if (!asset || player.housing !== 'own') return { success: false, message: '目前沒有自住房可出售。' };
  const liabilityId = homeLoanId(player.id);
  const liability = player.liabilities.find((l) => l.id === liabilityId);
  const proceeds = asset.currentValue;
  const debtSettled = liability?.totalDebt ?? 0;
  const transactionCost = Math.round(proceeds * HOME_TRANSACTION_COST_RATE);
  const netCashChange = proceeds - debtSettled - transactionCost;
  player.cash += netCashChange;
  player.assets = player.assets.filter((a) => a.id !== assetId);
  player.liabilities = player.liabilities.filter((l) => l.id !== liabilityId);
  player.expenses.homeMortgagePayment = 0;
  player.housing = 'rent';
  if (player.expenses.rent <= 0) player.expenses.rent = player.profession.startingHomeMortgage;
  return { success: true, message: `賣出自住房：市價 $${proceeds.toLocaleString()}，清償房貸 $${debtSettled.toLocaleString()}，稅費 $${transactionCost.toLocaleString()}，淨入帳 ${netCashChange >= 0 ? '+' : '-'}$${Math.abs(netCashChange).toLocaleString()}；之後改租屋，每月 $${player.rentExpense.toLocaleString()}。`,
    proceeds, debtSettled, transactionCost, netCashChange };
}
