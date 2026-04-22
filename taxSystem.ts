import { Player } from './gameDataModels';
import {
  TAX_BRACKETS,
  DEPENDENT_DEDUCTION_PER_CHILD,
  MEDICAL_INSURANCE_DEDUCTION,
  LIFE_INSURANCE_DEDUCTION,
  PROPERTY_INSURANCE_DEDUCTION,
} from './gameConfig';

// ============================================================
// 稅務結果介面
// ============================================================

/**
 * 扣除額明細，讓前端能顯示各項節稅來源。
 */
export interface TaxDeductionBreakdown {
  dependentDeduction: number;       // 撫養扣除：子女人數 × DEPENDENT_DEDUCTION_PER_CHILD
  medicalInsuranceDeduction: number; // 醫療保險年度扣除額
  lifeInsuranceDeduction: number;    // 壽險年度扣除額
  propertyInsuranceDeduction: number; // 財產/企業險年度扣除額
  totalDeductions: number;           // 以上各項之總和
}

/**
 * 年度繳稅計算結果，包含完整明細供前端顯示教育說明。
 */
export interface AnnualTaxResult {
  /** 遊戲年收入 = totalIncome × 4（每圈 4 個發薪日 = 一年） */
  annualIncome: number;
  /** 各項節稅扣除明細 */
  deductions: TaxDeductionBreakdown;
  /** 應稅收入 = 年收入 − 總扣除額（最低為 0） */
  taxableIncome: number;
  /** 最終應繳稅額（已套用累進稅率） */
  taxAmount: number;
  /** 各稅率級距的計算明細字串，供前端展示（如 "$50k×5% + $70k×12%..."） */
  bracketBreakdown: string;
}

// ============================================================
// 累進稅率計算
// ============================================================

/**
 * 對指定應稅收入套用累進稅率，回傳稅額與每個級距的計算明細。
 */
function applyProgressiveTax(taxableIncome: number): {
  taxAmount: number;
  bracketBreakdown: string;
} {
  if (taxableIncome <= 0) {
    return { taxAmount: 0, bracketBreakdown: '應稅收入為 $0，免稅' };
  }

  let remaining = taxableIncome;
  let totalTax = 0;
  const parts: string[] = [];

  for (const bracket of TAX_BRACKETS) {
    if (remaining <= 0) break;

    const bracketSize =
      bracket.maxIncome !== null
        ? bracket.maxIncome - bracket.minIncome + 1
        : Infinity;

    const taxableInBracket = Math.min(remaining, bracketSize);
    const taxInBracket = Math.round(taxableInBracket * bracket.rate);

    if (taxInBracket > 0) {
      parts.push(`$${taxableInBracket.toLocaleString()} × ${(bracket.rate * 100).toFixed(0)}% = $${taxInBracket.toLocaleString()}`);
      totalTax += taxInBracket;
    }

    remaining -= taxableInBracket;
  }

  return {
    taxAmount: totalTax,
    bracketBreakdown: parts.join(' + '),
  };
}

// ============================================================
// 主要計算函數
// ============================================================

/**
 * 純計算：根據玩家當前財務狀況計算年度稅金，不修改玩家物件。
 *
 * 年收入 = player.totalIncome × 4（遊戲設定：4 個發薪日 = 一年）
 *
 * 節稅扣除順序：
 *  1. 撫養扣除：子女人數 × $225,000
 *  2. 醫療保險：$36,000（若已持有）
 *  3. 壽　　險：$18,000（若已持有）
 *  4. 財產/企業險：$54,000（若已持有）
 *
 * @param player 玩家物件（唯讀，不會被修改）
 * @returns AnnualTaxResult 稅務計算結果明細
 */
export function calculateAnnualTax(player: Player): AnnualTaxResult {
  const annualIncome = player.totalIncome * 4;

  // 計算各項扣除額
  const dependentDeduction = player.numberOfChildren * DEPENDENT_DEDUCTION_PER_CHILD;
  const medicalInsuranceDeduction = player.insurance.hasMedicalInsurance
    ? MEDICAL_INSURANCE_DEDUCTION
    : 0;
  const lifeInsuranceDeduction = player.insurance.hasLifeInsurance
    ? LIFE_INSURANCE_DEDUCTION
    : 0;
  const propertyInsuranceDeduction = player.insurance.hasPropertyInsurance
    ? PROPERTY_INSURANCE_DEDUCTION
    : 0;

  const totalDeductions =
    dependentDeduction +
    medicalInsuranceDeduction +
    lifeInsuranceDeduction +
    propertyInsuranceDeduction;

  const taxableIncome = Math.max(0, annualIncome - totalDeductions);

  const { taxAmount, bracketBreakdown } = applyProgressiveTax(taxableIncome);

  return {
    annualIncome,
    deductions: {
      dependentDeduction,
      medicalInsuranceDeduction,
      lifeInsuranceDeduction,
      propertyInsuranceDeduction,
      totalDeductions,
    },
    taxableIncome,
    taxAmount,
    bracketBreakdown,
  };
}

/**
 * 計算年度稅金並直接從玩家的 cash 中扣除。
 * 若現金不足，cash 可能變為負數（代表欠稅）。
 *
 * @param player 玩家物件（直接修改 cash）
 * @returns AnnualTaxResult 稅務計算結果明細
 */
export function applyAnnualTax(player: Player): AnnualTaxResult {
  const result = calculateAnnualTax(player);
  player.cash -= result.taxAmount;
  return result;
}
