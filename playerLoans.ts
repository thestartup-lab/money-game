import { Player } from './gameDataModels';
import { getLoanLimit } from './gameConfig';
import { repayLoan, RepayLoanResult } from './gameLogic';

export function validatePlayerLoan(lender: Player, borrower: Player, amount: number, rate: number): string | null {
  if (lender.id === borrower.id || !lender.isAlive || !borrower.isAlive) return '借貸雙方必須是不同且仍在遊戲中的玩家。';
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 0.1) return '借款金額或利率不正確。';
  if (lender.cash < amount) return '貸款方現金已不足。';
  const secured = new Set(borrower.assets.map(a => a.linkedLiabilityId));
  const used = borrower.liabilities.filter(l => !secured.has(l.id)).reduce((sum, l) => sum + l.totalDebt, 0);
  if (used + amount > getLoanLimit(borrower.creditScore)) return '超過借款人的信用借款上限。';
  return null;
}

/** Settle both sides atomically; partial repayment reduces both sides' monthly interest. */
export function repayRoomLoan(players: Iterable<Player>, borrower: Player, id: string, amount: number): RepayLoanResult {
  if (!id.startsWith('p2p-')) return repayLoan(borrower, id, amount);
  const liability = borrower.liabilities.find(l => l.id === id);
  const lender = [...players].find(p => p.id !== borrower.id && p.assets.some(a => a.id === id));
  const asset = lender?.assets.find(a => a.id === id);
  if (!liability || !lender || !asset) return { success: false, message: '借貸雙方帳目不完整，請主持人協助處理，尚未扣款。' };
  const rate = liability.monthlyRate ?? liability.monthlyPayment / liability.totalDebt;
  const result = repayLoan(borrower, id, amount);
  if (!result.success) return result;
  lender.cash += result.amountPaid!;
  if (result.fullyRepaid) lender.assets = lender.assets.filter(a => a.id !== id);
  else {
    asset.currentValue = liability.totalDebt;
    asset.cost = liability.totalDebt;
    liability.monthlyRate = rate;
    liability.monthlyPayment = Math.round(liability.totalDebt * rate);
    asset.monthlyCashflow = liability.monthlyPayment;
  }
  return result;
}
