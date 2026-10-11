import type { Player } from './gameDataModels';

/** Signed cash movements captured at the actual monthly posting boundary. */
export function monthlyLedger(p: Player): Record<string, number> {
  const e = p.expenses;
  const linked = new Set(p.assets.map(a => a.linkedLiabilityId).filter(Boolean));
  return {
    '薪資／退休收入': p.salary,
    '配息／被動淨收入': p.totalIncome - p.salary - p.marriageBonus - p.spouseIncome,
    '配偶與家庭收入': p.marriageBonus + p.spouseIncome,
    '生活與家庭費': -(p.livingExpenses + p.spouseLivingExpenses + p.childExpenses),
    '住房與交通費': -(p.rentExpense + p.transportExpense),
    '貸款與信用卡月付': -(e.homeMortgagePayment + e.carLoanPayment + e.creditCardPayment + p.liabilities.filter(l => !linked.has(l.id)).reduce((n, l) => n + (l.monthlyPayment ?? 0), 0)),
    '商業保費': -p.insurancePremiums,
    '社會保險與照護': -(p.socialInsurance + p.seniorCareExpense),
    '固定稅費': -e.taxes,
    '其他定期支出／環境調整': -(p.recurringExpenseTotal + p.worldExpenseAdjustment),
  };
}
