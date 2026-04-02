import { Profession } from './gameDataModels';
import { AssetType, SocialClass, LifeStage } from './gameConstants';
export {
  MEDICAL_INSURANCE_PREMIUM,
  LIFE_INSURANCE_PREMIUM,
  PROPERTY_INSURANCE_PREMIUM,
  PER_CHILD_EXPENSE,
  FQ_MULTIPLIERS,
  FAST_TRACK_INCOME_MULTIPLIER,
} from './gameConstants';
import {
  MEDICAL_INSURANCE_PREMIUM,
  LIFE_INSURANCE_PREMIUM,
  PROPERTY_INSURANCE_PREMIUM,
} from './gameConstants';

// ============================================================
// 地圖配置
// ============================================================

/** 老鼠賽跑圈的總格數 */
export const RAT_RACE_TRACK_SIZE = 24;

/** 外圈（FastTrack）棋盤的總格數 */
export const FAST_TRACK_TRACK_SIZE = 16;

/** 外圈發薪日額外紅利倍率（總資產 × 此比率）*/
export const FAST_TRACK_PAYDAY_BONUS_RATE = 0.01;

/**
 * 所有「發薪日」格的索引位置。
 * 起點(0)同時也是發薪日，之後每 6 格一個。
 */
export const PAYDAY_LOCATIONS: readonly number[] = [0, 6, 12, 18];

// ============================================================
// 玩家成長數值系統常量
// ============================================================

// --- 財商值 FQ (Financial IQ, 1–10) ---

/**
 * FQ 升級成本陣列。索引 = 當前 FQ 等級（0-based，level 1 在索引 0）。
 * FQ_UPGRADE_COSTS[i] = 從等級 (i+1) 升到 (i+2) 所需現金。
 * 共 9 個元素（FQ 1→2 到 FQ 9→10），FQ 10 已滿級無法繼續升級。
 */
export const FQ_UPGRADE_COSTS: readonly number[] = [
  500,   // 1 → 2
  800,   // 2 → 3
  1200,  // 3 → 4
  1800,  // 4 → 5
  2500,  // 5 → 6
  3200,  // 6 → 7
  4000,  // 7 → 8
  5000,  // 8 → 9
  6500,  // 9 → 10
];

// FQ_MULTIPLIERS 已移至 gameConstants.ts，從那裡 re-export

// --- 健康值 HP (Health Points, 0–100) ---

/** 每個發薪日未做任何健康投資時的自然衰退量 */
export const HP_DECAY_PER_PAYDAY = 5;
/** 「維護健康」費用：阻止本次衰退，HP 不變 */
export const HP_MAINTENANCE_COST = 200;
/** 「積極投資健康」費用：阻止衰退並提升 HP */
export const HP_BOOST_COST = 500;
/** 「積極投資健康」每次獲得的 HP 增量 */
export const HP_BOOST_AMOUNT = 20;
/** HP 危險閾值：低於此值遇到疾病危機時效果加重 */
export const HP_DANGER_THRESHOLD = 30;
/** HP 強壯閾值：高於此值遇到疾病危機時效果減輕 */
export const HP_STRONG_THRESHOLD = 70;

// --- 第二專長值 SK (Career Skill, 0–100) ---

/** 每個發薪日選擇「進修培訓」所需現金 */
export const SKILL_TRAINING_COST = 600;
/** 每次進修培訓獲得的 SK 增量 */
export const SKILL_TRAINING_GAIN = 20;
/** SK 達到此值解鎖轉職機會 */
export const SKILL_CAREER_CHANGE_THRESHOLD = 100;

// --- 人脈值 NT (Network, 1–10) ---

/** NT 每隔幾個發薪日自動 +1（paydayCount 為此值的倍數時觸發） */
export const NETWORK_AUTO_GAIN_INTERVAL = 2;
/** 主動投資人脈的費用（每個發薪日可選一次） */
export const NETWORK_INVEST_COST = 400;
/** 主動投資人脈每次獲得的 NT 增量 */
export const NETWORK_INVEST_GAIN = 1;

// --- 發薪日規劃逾時 ---

/** 玩家在發薪日規劃階段的最長決策時間（毫秒）；逾時自動略過投資 */
export const PAYDAY_PLANNING_TIMEOUT_MS = 30000;

// ============================================================
// 年度繳稅系統常量
// ============================================================

/**
 * 累進稅率級距（基於遊戲年收入 = totalIncome × 4）。
 * maxIncome 為 null 表示此級距無上限。
 */
export interface TaxBracket {
  minIncome: number;
  maxIncome: number | null;
  rate: number;
  label: string;
}

export const TAX_BRACKETS: TaxBracket[] = [
  { minIncome: 0,       maxIncome: 50000,  rate: 0.05, label: '$0 – $50,000 × 5%'      },
  { minIncome: 50001,   maxIncome: 120000, rate: 0.12, label: '$50,001 – $120,000 × 12%' },
  { minIncome: 120001,  maxIncome: 250000, rate: 0.20, label: '$120,001 – $250,000 × 20%' },
  { minIncome: 250001,  maxIncome: 500000, rate: 0.30, label: '$250,001 – $500,000 × 30%' },
  { minIncome: 500001,  maxIncome: null,   rate: 0.40, label: '$500,001 以上 × 40%'      },
];

/** 每位撫養子女的年度扣除額 */
export const DEPENDENT_DEDUCTION_PER_CHILD = 15000;

/** 醫療保險年度扣除額（$200/月 × 12） */
export const MEDICAL_INSURANCE_DEDUCTION = 2400;

/** 壽險年度扣除額（$100/月 × 12） */
export const LIFE_INSURANCE_DEDUCTION = 1200;

/** 財產/企業險年度扣除額（$300/月 × 12） */
export const PROPERTY_INSURANCE_DEDUCTION = 3600;

// ============================================================
// 管理員設定
// ============================================================

/**
 * 管理員登入密碼。
 * 正式部署時建議改為讀取環境變數：process.env.ADMIN_PASSWORD
 */
export const ADMIN_PASSWORD = '123';

// ============================================================
// 職業範本資料
// ============================================================

/**
 * 遊戲內建職業清單（ESBI 四象限各類型代表）。
 * startingTaxes 全部設為 0，稅金由年度累進稅系統（taxSystem.ts）計算。
 *
 * E 象限（4）：固定薪資受薪族
 * S 象限（3）：自僱者，每發薪日動態計算薪資
 * B 象限（2）：企業主，低/零薪資但持有起始事業資產
 * I 象限（1）：投資者，零薪資但持有起始投資組合且 FQ 較高
 */
export const PROFESSIONS: Profession[] = [

  // ==========================================================
  // E 象限：受薪族（固定薪資）
  // ==========================================================

  {
    id: 'doctor',
    name: '醫生',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 13200,
    startingTaxes: 0,
    startingHomeMortgage: 1900,
    startingCarLoan: 380,
    startingCreditCard: 270,
    startingOtherExpenses: 2880,
    startingCash: 400,
    hasFlexibleSchedule: false,
  },
  {
    id: 'engineer',
    name: '工程師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 7500,
    startingTaxes: 0,
    startingHomeMortgage: 500,
    startingCarLoan: 300,
    startingCreditCard: 90,
    startingOtherExpenses: 1790,
    startingCash: 2560,
    hasFlexibleSchedule: false,
  },
  {
    id: 'teacher',
    name: '老師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 3300,
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 100,
    startingCreditCard: 60,
    startingOtherExpenses: 760,
    startingCash: 400,
    hasFlexibleSchedule: false,
  },
  {
    id: 'janitor',
    name: '清潔工',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 1600,
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 50,
    startingCreditCard: 30,
    startingOtherExpenses: 330,
    startingCash: 360,
    hasFlexibleSchedule: false,
  },
  {
    id: 'chef',
    name: '廚師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 2400,
    startingTaxes: 0,
    startingHomeMortgage: 250,
    startingCarLoan: 80,
    startingCreditCard: 40,
    startingOtherExpenses: 500,
    startingCash: 500,
    hasFlexibleSchedule: false,
  },
  {
    id: 'police',
    name: '警察',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 3000,
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 100,
    startingCreditCard: 50,
    startingOtherExpenses: 600,
    startingCash: 600,
    hasFlexibleSchedule: false,
  },
  {
    id: 'nurse',
    name: '護理師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 4200,
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 120,
    startingCreditCard: 70,
    startingOtherExpenses: 900,
    startingCash: 800,
    hasFlexibleSchedule: false,
  },
  {
    id: 'sales_manager',
    name: '業務主管',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 6500,
    startingTaxes: 0,
    startingHomeMortgage: 600,
    startingCarLoan: 250,
    startingCreditCard: 120,
    startingOtherExpenses: 1400,
    startingCash: 1500,
    hasFlexibleSchedule: false,
  },
  {
    id: 'accountant',
    name: '會計師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 5500,
    startingTaxes: 0,
    startingHomeMortgage: 500,
    startingCarLoan: 180,
    startingCreditCard: 100,
    startingOtherExpenses: 1100,
    startingCash: 1000,
    hasFlexibleSchedule: false,
  },
  {
    id: 'it_engineer',
    name: 'IT 工程師',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 8500,
    startingTaxes: 0,
    startingHomeMortgage: 800,
    startingCarLoan: 300,
    startingCreditCard: 150,
    startingOtherExpenses: 1800,
    startingCash: 2000,
    hasFlexibleSchedule: false,
  },
  {
    id: 'retail_staff',
    name: '門市人員',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 2200,
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 60,
    startingCreditCard: 30,
    startingOtherExpenses: 450,
    startingCash: 400,
    hasFlexibleSchedule: false,
  },
  {
    id: 'store_manager',
    name: '店長',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 4800,
    startingTaxes: 0,
    startingHomeMortgage: 450,
    startingCarLoan: 150,
    startingCreditCard: 80,
    startingOtherExpenses: 1000,
    startingCash: 900,
    hasFlexibleSchedule: false,
  },
  {
    id: 'civil_servant',
    name: '公職人員',
    quadrant: 'E',
    salaryType: 'fixed',
    startingSalary: 4500,
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 120,
    startingCreditCard: 70,
    startingOtherExpenses: 900,
    startingCash: 1000,
    hasFlexibleSchedule: false,
  },

  // ==========================================================
  // S 象限：自僱者（動態薪資）
  // ==========================================================

  {
    id: 'salesperson',
    name: '無底薪業務員',
    quadrant: 'S',
    salaryType: 'nt_driven',
    startingSalary: 0,          // 展示用基準；實際每發薪日 = NT × salaryPerNT
    salaryPerNT: 400,           // NT=1→$400; NT=5→$2,000; NT=10→$4,000
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 150,
    startingCreditCard: 50,
    startingOtherExpenses: 400,
    startingCash: 1800,         // 需要備用金應對低收入月份
    hasFlexibleSchedule: true,
  },
  {
    id: 'freelance_designer',
    name: '自由接案設計師',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 2500,       // 展示用估算值（實際每月隨機）
    minSalary: 500,
    maxSalary: 4500,
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 100,
    startingCreditCard: 60,
    startingOtherExpenses: 600,
    startingCash: 3000,         // 高備用金，收入不穩定
    hasFlexibleSchedule: false,
  },
  {
    id: 'solo_lawyer',
    name: '個人執業律師',
    quadrant: 'S',
    salaryType: 'sk_driven',
    startingSalary: 3000,
    salaryPerSK: 50,
    startingTaxes: 0,
    startingHomeMortgage: 600,
    startingCarLoan: 200,
    startingCreditCard: 100,
    startingOtherExpenses: 900,
    startingCash: 2000,
    hasFlexibleSchedule: false,
  },

  // S 低階基礎：接單型 & 佣金型
  {
    id: 'taxi_driver',
    name: '計程車司機',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 2000,
    minSalary: 800,
    maxSalary: 3500,
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 200,   // 車貸（自有車）
    startingCreditCard: 40,
    startingOtherExpenses: 500,
    startingCash: 800,
    hasFlexibleSchedule: true,
  },
  {
    id: 'delivery_rider',
    name: '外送員',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 1800,
    minSalary: 600,
    maxSalary: 3200,
    startingTaxes: 0,
    startingHomeMortgage: 150,
    startingCarLoan: 100,
    startingCreditCard: 30,
    startingOtherExpenses: 400,
    startingCash: 600,
    hasFlexibleSchedule: true,
  },
  {
    id: 'temp_worker',
    name: '派遣工',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 1600,
    minSalary: 600,
    maxSalary: 2800,
    startingTaxes: 0,
    startingHomeMortgage: 150,
    startingCarLoan: 50,
    startingCreditCard: 30,
    startingOtherExpenses: 350,
    startingCash: 500,
    hasFlexibleSchedule: true,
  },
  {
    id: 'insurance_agent',
    name: '保險業務員',
    quadrant: 'S',
    salaryType: 'nt_driven',
    startingSalary: 0,
    salaryPerNT: 450,
    startingTaxes: 0,
    startingHomeMortgage: 250,
    startingCarLoan: 100,
    startingCreditCard: 40,
    startingOtherExpenses: 350,
    startingCash: 1500,
    hasFlexibleSchedule: true,
  },
  {
    id: 'real_estate_agent',
    name: '房仲業務員',
    quadrant: 'S',
    salaryType: 'nt_driven',
    startingSalary: 0,
    salaryPerNT: 500,
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 120,
    startingCreditCard: 50,
    startingOtherExpenses: 400,
    startingCash: 1800,
    hasFlexibleSchedule: true,
  },
  {
    id: 'mlm_agent',
    name: '直銷業務員',
    quadrant: 'S',
    salaryType: 'nt_driven',
    startingSalary: 0,
    salaryPerNT: 380,
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 80,
    startingCreditCard: 40,
    startingOtherExpenses: 300,
    startingCash: 1200,
    hasFlexibleSchedule: true,
  },
  {
    id: 'market_vendor',
    name: '市集攤販',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 1500,
    minSalary: 400,
    maxSalary: 3000,
    startingTaxes: 0,
    startingHomeMortgage: 150,
    startingCarLoan: 50,
    startingCreditCard: 30,
    startingOtherExpenses: 400,
    startingCash: 700,
    hasFlexibleSchedule: true,
  },

  // S 中階基礎：技術型自僱
  {
    id: 'cram_teacher',
    name: '補教老師',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 2800,
    minSalary: 1000,
    maxSalary: 5000,
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 80,
    startingCreditCard: 50,
    startingOtherExpenses: 600,
    startingCash: 1200,
    hasFlexibleSchedule: true,
  },
  {
    id: 'trainer',
    name: '講師／培訓師',
    quadrant: 'S',
    salaryType: 'sk_driven',
    startingSalary: 2000,
    salaryPerSK: 30,
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 80,
    startingCreditCard: 50,
    startingOtherExpenses: 500,
    startingCash: 1500,
    hasFlexibleSchedule: true,
  },
  {
    id: 'freelance_photographer',
    name: '自由攝影師',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 2200,
    minSalary: 500,
    maxSalary: 4000,
    startingTaxes: 0,
    startingHomeMortgage: 250,
    startingCarLoan: 60,
    startingCreditCard: 50,
    startingOtherExpenses: 500,
    startingCash: 1500,
    hasFlexibleSchedule: true,
  },
  {
    id: 'beautician',
    name: '美容師／造型師',
    quadrant: 'S',
    salaryType: 'sk_driven',
    startingSalary: 1800,
    salaryPerSK: 20,
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 60,
    startingCreditCard: 40,
    startingOtherExpenses: 450,
    startingCash: 1000,
    hasFlexibleSchedule: true,
  },
  {
    id: 'renovation_contractor',
    name: '水電裝修師傅',
    quadrant: 'S',
    salaryType: 'random',
    startingSalary: 3000,
    minSalary: 800,
    maxSalary: 5500,
    startingTaxes: 0,
    startingHomeMortgage: 300,
    startingCarLoan: 150,
    startingCreditCard: 60,
    startingOtherExpenses: 600,
    startingCash: 1500,
    hasFlexibleSchedule: true,
  },

  // S 進階：需進修
  {
    id: 'consultant',
    name: '管理顧問',
    quadrant: 'S',
    salaryType: 'sk_driven',
    startingSalary: 4000,
    salaryPerSK: 60,
    startingTaxes: 0,
    startingHomeMortgage: 700,
    startingCarLoan: 200,
    startingCreditCard: 120,
    startingOtherExpenses: 1200,
    startingCash: 2500,
    hasFlexibleSchedule: true,
  },
  {
    id: 'financial_advisor',
    name: '財務顧問',
    quadrant: 'S',
    salaryType: 'nt_driven',
    startingSalary: 0,
    salaryPerNT: 700,
    startingTaxes: 0,
    startingHomeMortgage: 600,
    startingCarLoan: 180,
    startingCreditCard: 100,
    startingOtherExpenses: 1000,
    startingCash: 2000,
    hasFlexibleSchedule: true,
  },
  {
    id: 'counselor',
    name: '心理諮商師',
    quadrant: 'S',
    salaryType: 'sk_driven',
    startingSalary: 2500,
    salaryPerSK: 40,
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 100,
    startingCreditCard: 80,
    startingOtherExpenses: 700,
    startingCash: 1500,
    hasFlexibleSchedule: true,
  },

  // ==========================================================
  // B 象限：企業主（含起始事業資產）
  // ==========================================================

  {
    id: 'restaurant_owner',
    name: '餐廳老闆',
    quadrant: 'B',
    salaryType: 'fixed',
    startingSalary: 0,           // 收入完全來自事業現金流
    startingTaxes: 0,
    startingHomeMortgage: 400,
    startingCarLoan: 150,
    startingCreditCard: 80,
    startingOtherExpenses: 500,
    startingCash: 1200,
    startingAssets: [
      {
        name: '小型餐廳事業',
        type: AssetType.Business,
        cost: 80000,
        monthlyCashflow: 800,    // 月淨收入（已扣貸款月付 $400）
        currentValue: 80000,
        liabilityName: '事業創業貸款',
        liabilityAmount: 65000,
        liabilityMonthlyPayment: 400,
      },
    ],
    hasFlexibleSchedule: true,
  },
  {
    id: 'franchise_owner',
    name: '加盟主',
    quadrant: 'B',
    salaryType: 'fixed',
    startingSalary: 500,         // 小額管理費薪資
    startingTaxes: 0,
    startingHomeMortgage: 350,
    startingCarLoan: 120,
    startingCreditCard: 60,
    startingOtherExpenses: 400,
    startingCash: 800,
    startingAssets: [
      {
        name: '連鎖加盟店',
        type: AssetType.Business,
        cost: 50000,
        monthlyCashflow: 600,    // 月淨收入（已扣貸款月付 $250）
        currentValue: 50000,
        liabilityName: '加盟貸款',
        liabilityAmount: 40000,
        liabilityMonthlyPayment: 250,
      },
    ],
    hasFlexibleSchedule: true,
  },

  // ==========================================================
  // I 象限：投資者（起始股票組合 + 高 FQ）
  // ==========================================================

  {
    id: 'angel_investor',
    name: '天使投資人',
    quadrant: 'I',
    salaryType: 'fixed',
    startingSalary: 0,           // 收入來自資產配息，無工資
    startingTaxes: 0,
    startingHomeMortgage: 200,
    startingCarLoan: 0,          // 不開車，極簡生活
    startingCreditCard: 30,
    startingOtherExpenses: 200,
    startingCash: 200,           // 幾乎全部資金已投入市場
    startingFQ: 5,               // 財商值起始為 5（比其他職業高）
    startingAssets: [
      {
        name: '多元股票投資組合',
        type: AssetType.Stock,
        cost: 30000,
        monthlyCashflow: 500,    // 股息收入
        currentValue: 30000,
        // 無負債：資產全額持有
      },
    ],
    hasFlexibleSchedule: true,
  },
];

/**
 * 以職業 ID 快速查詢職業物件。
 * 在 createPlayer 中用於依 professionId 指定職業。
 */
export const PROFESSION_MAP: ReadonlyMap<string, Profession> = new Map(
  PROFESSIONS.map((p) => [p.id, p])
);

// ============================================================
// 信用值系統
// ============================================================

/** 玩家起始信用值 */
export const CREDIT_SCORE_INITIAL = 600;
/** 信用值下限 */
export const CREDIT_SCORE_MIN = 300;
/** 信用值上限 */
export const CREDIT_SCORE_MAX = 850;

/** 各操作觸發的信用值變化量 */
export const CREDIT_CHANGE_REPAY          =  15;   // 任何還款行為
export const CREDIT_CHANGE_FULL_REPAY     =  25;   // 完全清償一筆負債的額外加分
export const CREDIT_CHANGE_EMERGENCY_LOAN = -50;   // 取得應急借款
export const CREDIT_CHANGE_NEGATIVE_CF    = -10;   // 發薪日現金流為負

/**
 * 借款月利率區間表（依信用值由高到低排列）。
 * 查詢時取第一個 creditScore >= minScore 的項目。
 */
export const LOAN_RATE_BY_TIER: { minScore: number; rate: number }[] = [
  { minScore: 750, rate: 0.005 },   // 優良：0.5%/月
  { minScore: 650, rate: 0.008 },   // 良好：0.8%/月
  { minScore: 550, rate: 0.012 },   // 普通：1.2%/月
  { minScore: 300, rate: 0.020 },   // 差：  2.0%/月
];

/**
 * 單次借款上限區間表（依信用值由高到低排列）。
 */
export const LOAN_LIMIT_BY_TIER: { minScore: number; limit: number }[] = [
  { minScore: 750, limit: 80000 },
  { minScore: 650, limit: 50000 },
  { minScore: 550, limit: 30000 },
  { minScore: 300, limit: 10000 },
];

/**
 * 依信用值查詢對應的借款月利率。
 * 投資槓桿借款享有八折優惠（呼叫方自行乘以 0.8）。
 */
export function getLoanRate(creditScore: number): number {
  for (const tier of LOAN_RATE_BY_TIER) {
    if (creditScore >= tier.minScore) return tier.rate;
  }
  return LOAN_RATE_BY_TIER[LOAN_RATE_BY_TIER.length - 1].rate;
}

/** 依信用值查詢單次借款上限 */
export function getLoanLimit(creditScore: number): number {
  for (const tier of LOAN_LIMIT_BY_TIER) {
    if (creditScore >= tier.minScore) return tier.limit;
  }
  return LOAN_LIMIT_BY_TIER[LOAN_LIMIT_BY_TIER.length - 1].limit;
}

// ============================================================
// 保險啟動費（首次購買一次性扣款 = 月保費 × 2）
// ============================================================

export const INSURANCE_ACTIVATION_FEE: Readonly<Record<string, number>> = {
  medical:  MEDICAL_INSURANCE_PREMIUM  * 2,   // $400
  life:     LIFE_INSURANCE_PREMIUM     * 2,   // $200
  property: PROPERTY_INSURANCE_PREMIUM * 2,   // $600
};

// ============================================================
// 百歲人生：社會階層系統
// ============================================================

/**
 * 各社會階層的初始設定。
 * growthPoints：Pre20 階段可分配的總成長點數。
 * startingCashBonus：額外起始現金加成（疊加在職業基礎值之上）。
 */
export const SOCIAL_CLASS_CONFIG: Readonly<Record<SocialClass, {
  label: string;
  growthPoints: number;
  startingCashBonus: number;
}>> = {
  [SocialClass.Rich]:         { label: '富裕', growthPoints: 20, startingCashBonus: 5000 },
  [SocialClass.Middle]:       { label: '中等', growthPoints: 15, startingCashBonus: 2000 },
  [SocialClass.WorkingClass]: { label: '小康', growthPoints: 10, startingCashBonus: 800  },
  [SocialClass.Poor]:         { label: '貧窮', growthPoints: 7,  startingCashBonus: 200  },
};

/**
 * 各職業的成長點數門檻（academic / social 維度分別需達到的最低值）。
 * 未滿足門檻則該職業無法主動選擇（會被分配）。
 * salesperson（無底薪業務員）無門檻限制，任何人皆可選擇。
 * advancedOnly：true 表示只有選擇「繼續進修」後才開放。
 */
export const PROFESSION_THRESHOLDS: Readonly<Record<string, {
  academicMin: number;
  socialMin: number;
  advancedOnly?: boolean;
}>> = {
  doctor:             { academicMin: 8, socialMin: 3, advancedOnly: true  },
  solo_lawyer:        { academicMin: 7, socialMin: 4, advancedOnly: true  },
  it_engineer:        { academicMin: 6, socialMin: 1, advancedOnly: true  },
  accountant:         { academicMin: 5, socialMin: 2, advancedOnly: true  },
  angel_investor:     { academicMin: 5, socialMin: 6, advancedOnly: true  },
  store_manager:      { academicMin: 4, socialMin: 3, advancedOnly: true  },
  civil_servant:      { academicMin: 4, socialMin: 2, advancedOnly: true  },
  consultant:         { academicMin: 6, socialMin: 4, advancedOnly: true  },
  financial_advisor:  { academicMin: 5, socialMin: 5, advancedOnly: true  },
  counselor:          { academicMin: 5, socialMin: 3, advancedOnly: true  },
  engineer:           { academicMin: 6, socialMin: 1 },
  sales_manager:      { academicMin: 3, socialMin: 4 },
  nurse:              { academicMin: 4, socialMin: 2 },
  teacher:            { academicMin: 5, socialMin: 3 },
  freelance_designer: { academicMin: 4, socialMin: 2 },
  franchise_owner:    { academicMin: 4, socialMin: 5 },
  restaurant_owner:   { academicMin: 3, socialMin: 4 },
  police:             { academicMin: 1, socialMin: 1 },
  chef:               { academicMin: 0, socialMin: 0 },
  janitor:            { academicMin: 0, socialMin: 0 },
  retail_staff:       { academicMin: 0, socialMin: 0 },
  taxi_driver:        { academicMin: 0, socialMin: 0 },
  delivery_rider:     { academicMin: 0, socialMin: 0 },
  temp_worker:        { academicMin: 0, socialMin: 0 },
  insurance_agent:    { academicMin: 0, socialMin: 1 },
  real_estate_agent:  { academicMin: 0, socialMin: 1 },
  mlm_agent:          { academicMin: 0, socialMin: 0 },
  market_vendor:      { academicMin: 0, socialMin: 0 },
  cram_teacher:       { academicMin: 3, socialMin: 2 },
  trainer:            { academicMin: 3, socialMin: 3 },
  freelance_photographer: { academicMin: 2, socialMin: 1 },
  beautician:         { academicMin: 1, socialMin: 2 },
  renovation_contractor: { academicMin: 1, socialMin: 1 },
  salesperson:        { academicMin: 0, socialMin: 0 },
};

// ============================================================
// 百歲人生：繼續進修系統
// ============================================================

/** 選擇「繼續進修」時產生的學生貸款總額 */
export const EDUCATION_LOAN_AMOUNT = 30000;
/** 學生貸款每月還款金額 */
export const EDUCATION_LOAN_MONTHLY = 600;
/** 選擇「繼續進修」後初始 FQ 加成（在成長點數映射基礎上額外加） */
export const EDUCATION_FQ_BONUS = 1;

// ============================================================
// 百歲人生：生命體驗值各事件加分常量
// ============================================================

export const LIFE_EXP = {
  TRAVEL:              10,   // 主動選擇旅遊
  MARRIAGE:            15,   // 結婚事件
  MARRIAGE_LOVE:       20,   // 自然戀愛結婚（DRS 路徑）
  MARRIAGE_MATCHMAKER: 15,   // 主持人媒合結婚
  MARRIAGE_ARRANGED:    8,   // 買賣婚姻（體驗值較低）
  HAVE_CHILD:          12,   // 生小孩
  INVEST_DEAL:          8,   // 接受投資交易
  CRISIS_SURVIVED:      6,   // 危機事件存活
  CAREER_CHANGE:       10,   // 成功轉職
  FAST_TRACK_ENTER:    20,   // 進入外圈
  CONTINUED_EDUCATION: 10,   // 選擇繼續進修
  REPAY_LOAN:           5,   // 完整清償一筆負債
  CHARITY_DONATED:      8,   // 慈善捐款
} as const;

// ============================================================
// 婚姻系統（深度關係經營值 DRS）
// ============================================================

/** 每次參加聯誼活動的費用 */
export const SOCIAL_EVENT_COST = 500;
/** 每次聯誼活動獲得的 DRS 最小值 */
export const SOCIAL_EVENT_DRS_MIN = 10;
/** 每次聯誼活動獲得的 DRS 最大值 */
export const SOCIAL_EVENT_DRS_MAX = 25;
/** 到達 DRS 黃金期可獲得的額外上限 */
export const SOCIAL_EVENT_DRS_PEAK_MAX = 35;
/** 累積此 DRS 後可提親（自然戀愛路徑） */
export const RELATIONSHIP_MARRIAGE_THRESHOLD = 100;
/** 主持人觸發「邂逅」後立即給予的初始 DRS 加成 */
export const HOST_ACTIVATION_DRS_BONUS = 40;

/**
 * 買賣婚姻費用（隨年齡遞增）。
 * 費用 = BASE_COST + (currentAge - 20) * COST_STEP，上限 MAX_COST。
 */
export const ARRANGED_MARRIAGE_BASE_COST = 5000;
export const ARRANGED_MARRIAGE_COST_STEP = 200;   // 每歲增加 $200
export const ARRANGED_MARRIAGE_MAX_COST = 30000;

/** 各婚姻類型帶來的月收入加成（婚姻紅利） */
export const MARRIAGE_BONUS_BY_TYPE: Record<'love' | 'matchmaker' | 'arranged', number> = {
  love:        1000,   // 愛情婚姻：最高加成
  matchmaker:   600,   // 媒合婚姻：中等加成
  arranged:     200,   // 買賣婚姻：最低加成
};

// ============================================================
// 百歲人生：時鐘驅動年齡系統
// ============================================================

/** 預設遊戲時長（毫秒）；對應遊戲年齡 20–100 歲（80 年） */
export const DEFAULT_GAME_DURATION_MS = 5_400_000; // 90 分鐘

/** 最短遊戲時長（毫秒）；快速場為 60 分鐘 */
export const MIN_GAME_DURATION_MS = 3_600_000; // 60 分鐘

/** 最長遊戲時長（毫秒）；長場最多 120 分鐘 */
export const MAX_GAME_DURATION_MS = 7_200_000; // 120 分鐘

/** 遊戲結束年齡 */
export const GAME_END_AGE = 100;
/** 遊戲開始年齡（職業選擇後） */
export const GAME_START_AGE = 20;

/**
 * 各人生階段的年齡區間 [最小年齡, 最大年齡)。
 * 年齡由 getCurrentAge() 即時計算，無需儲存於玩家資料。
 */
export const LIFE_STAGE_AGE_RANGES: Readonly<Record<LifeStage, [number, number]>> = {
  [LifeStage.Youth]:      [20, 35],
  [LifeStage.Family]:     [35, 50],
  [LifeStage.Transition]: [50, 65],
  [LifeStage.Retirement]: [65, 80],
  [LifeStage.Legacy]:     [80, 100],
};

/**
 * 各人生階段的危機卡觸發機率調整係數（相對基準 1.0）。
 * 在 handleLandingSquare 中與基礎觸發率相乘使用。
 */
export const CRISIS_FREQ_BY_STAGE: Readonly<Record<LifeStage, number>> = {
  [LifeStage.Youth]:      1.0,
  [LifeStage.Family]:     1.2,
  [LifeStage.Transition]: 1.5,
  [LifeStage.Retirement]: 1.8,
  [LifeStage.Legacy]:     2.2,
};

/**
 * 各人生階段的薪資倍率。
 * 退休期以後薪資乘以此係數以反映職業收入下降。
 */
export const SALARY_MULT_BY_STAGE: Readonly<Record<LifeStage, number>> = {
  [LifeStage.Youth]:      1.0,
  [LifeStage.Family]:     1.0,
  [LifeStage.Transition]: 1.0,
  [LifeStage.Retirement]: 0.5,
  [LifeStage.Legacy]:     0.0, // 無薪資，依靠被動收入
};

// ============================================================
// 百歲人生：人生事件機率視窗（依年齡區間調整）
// ============================================================

/**
 * 各類人生事件的機率視窗（[最高機率年齡起, 最高機率年齡止]）。
 * 在視窗內觸發機率最高；視窗外機率大幅降低但不為零（仍是人生選擇）。
 */
export const LIFE_EVENT_WINDOWS = {
  marriage:  { peakStart: 25, peakEnd: 40, baseProbability: 0.3, peakProbability: 0.6 },
  children:  { peakStart: 27, peakEnd: 42, baseProbability: 0.2, peakProbability: 0.5 },
  /** 職業轉型、進修機率（SK 達標後激活） */
  careerChange: { peakStart: 30, peakEnd: 55, baseProbability: 0.1, peakProbability: 0.4 },
} as const;

// ============================================================
// FastTrack（外圈）常量
// ============================================================

/**
 * FastTrack 每個發薪日的資產自動增值率（複利）。
 * 適用於玩家進入外圈後持有的所有資產。
 */
export const FAST_TRACK_ASSET_APPRECIATION_RATE = 0.15;

// FAST_TRACK_INCOME_MULTIPLIER 已移至 gameConstants.ts，從那裡 re-export

// ============================================================
// 百歲人生：人生評分系統
// ============================================================

/** 最終 Life Score 各維度的權重 */
export const LIFE_SCORE_WEIGHTS = {
  netWorth:       0.20,   // 淨資產
  passiveIncome:  0.20,   // 被動收入
  lifeExperience: 0.15,   // 生命體驗值
  health:         0.15,   // 最終健康值
  familyBonus:    0.10,   // 家庭（婚姻 + 子女）
  ageBonus:       0.05,   // 壽命（活得越久分越高）
  legacyScore:    0.15,   // 傳承分（死後遺產淨值）
} as const;

/**
 * 遺產淨值達此金額時傳承分為滿分 100 分。
 * 淨值越高代表留給後代越多；負值（留下負債）則得 0 分。
 */
export const LEGACY_FULL_SCORE_AMOUNT = 100_000;

// =============================================================================
// HP 老化與旅遊系統
// =============================================================================

/**
 * 每發薪日 HP 自然衰退量（依人生階段加速）。
 * 取代舊的固定值 HP_DECAY_PER_PAYDAY。
 * 不投資健康的自然軌跡：20 歲 HP80 → 65 歲剩約 12 → 70 歲前後歸零。
 */
export const HP_DECAY_BY_STAGE: Record<LifeStage, number> = {
  [LifeStage.Youth]:       4,
  [LifeStage.Family]:      6,
  [LifeStage.Transition]:  10,
  [LifeStage.Retirement]:  15,
  [LifeStage.Legacy]:      20,
};

/** 臥床玩家每回合自然死亡機率（30%） */
export const BEDRIDDEN_DEATH_PROBABILITY = 0.30;

/**
 * 各生命活動所需的最低 HP 門檻。
 * 低於門檻時伺服器拒絕操作並回傳 error。
 */
export const HP_ACTIVITY_THRESHOLDS = {
  travel:           50,
  socialEvent:      40,
  baby:             35,
  careerChange:     30,
  bigDeal:          25,
  arrangedMarriage: 20,
} as const;

/** 旅遊費用（扣除現金） */
export const TRAVEL_COST = 2000;

/** 旅遊後下次薪水乘以此倍率（0.7 = 七折） */
export const TRAVEL_SALARY_PENALTY = 0.7;

// ============================================================
// 象限職業池（Pre-20 隨機分配用）
// ============================================================

/** E 象限職業池 */
export const E_PROFESSION_POOLS = {
  /** 無需進修即可分配 */
  basic:    ['janitor', 'chef', 'police', 'nurse', 'sales_manager', 'teacher', 'retail_staff'],
  /** 需進修後才加入隨機池 */
  advanced: ['engineer', 'accountant', 'it_engineer', 'doctor', 'store_manager', 'civil_servant'],
};

/** S 象限職業池 */
export const S_PROFESSION_POOLS = {
  /** 低階基礎：接單型 & 佣金型（無需進修） */
  basicLow: ['taxi_driver', 'delivery_rider', 'temp_worker', 'insurance_agent', 'real_estate_agent', 'mlm_agent', 'market_vendor'],
  /** 中階基礎：技術型自僱（無需進修） */
  basicMid: ['freelance_designer', 'cram_teacher', 'trainer', 'freelance_photographer', 'beautician', 'renovation_contractor'],
  /** 進階：需進修後才加入隨機池 */
  advanced: ['solo_lawyer', 'consultant', 'financial_advisor', 'counselor'],
};

/** 加盟主申請最低現金門檻 */
export const FRANCHISE_CASH_THRESHOLD = 50000;

// ============================================================
// 旅遊目的地系統
// ============================================================

export type TravelStatEffect = Partial<{
  nt: number;    // 人脈值加成
  fq: number;    // 財商值加成
  sk: number;    // 技能值加成
  hp: number;    // 健康值加成（正數為回復）
  legacyScore: number;      // 直接加傳承分
  unlockEntrepreneur: boolean; // 解鎖創業者事件
  salaryPenaltyOverride: number; // 覆蓋薪水懲罰係數
}>;

export interface TravelDestination {
  id: string;
  name: string;
  region: string;
  /** 哪個賽道可用：inner=內圈, outer=外圈專屬, both=兩圈皆可 */
  tier: 'inner' | 'outer' | 'both';
  cost: number;
  lifeExpGained: number;
  /** 薪水懲罰係數（1.0=無懲罰, 0.7=七折） */
  salaryPenalty: number;
  hpCost: number;
  statEffect?: TravelStatEffect;
  description: string;
}

export const TRAVEL_DESTINATIONS: readonly TravelDestination[] = [
  // ── 內圈可用（亞太 + 預算型）─────────────────────────
  {
    id: 'taiwan_cycling',
    name: '台灣環島',
    region: '亞太',
    tier: 'inner',
    cost: 1000,
    lifeExpGained: 8,
    salaryPenalty: 0.9,
    hpCost: 5,
    description: '騎單車環島，感受台灣之美。',
  },
  {
    id: 'japan_tokyo',
    name: '日本東京',
    region: '亞太',
    tier: 'inner',
    cost: 2500,
    lifeExpGained: 12,
    salaryPenalty: 0.7,
    hpCost: 8,
    statEffect: { nt: 1 },
    description: '繁華都市，開拓人際視野。',
  },
  {
    id: 'thailand_bangkok',
    name: '泰國曼谷',
    region: '亞太',
    tier: 'inner',
    cost: 1500,
    lifeExpGained: 10,
    salaryPenalty: 0.8,
    hpCost: 6,
    description: '平價旅遊，體驗東南亞文化。',
  },
  {
    id: 'korea_seoul',
    name: '韓國首爾',
    region: '亞太',
    tier: 'inner',
    cost: 2000,
    lifeExpGained: 10,
    salaryPenalty: 0.75,
    hpCost: 7,
    description: '流行文化前線，感受韓流。',
  },
  {
    id: 'malaysia_kl',
    name: '馬來西亞',
    region: '亞太',
    tier: 'inner',
    cost: 1500,
    lifeExpGained: 9,
    salaryPenalty: 0.8,
    hpCost: 5,
    description: '多元文化交融的美食天堂。',
  },
  {
    id: 'hong_kong',
    name: '香港',
    region: '亞太',
    tier: 'inner',
    cost: 1200,
    lifeExpGained: 8,
    salaryPenalty: 0.85,
    hpCost: 4,
    statEffect: { fq: 1 },
    description: '國際金融中心，拓展財商視野。',
  },
  {
    id: 'vietnam_hanoi',
    name: '越南河內',
    region: '亞太',
    tier: 'inner',
    cost: 1000,
    lifeExpGained: 8,
    salaryPenalty: 0.9,
    hpCost: 4,
    description: '歷史古城，感受不同的生活節奏。',
  },
  {
    id: 'bali',
    name: '峇里島',
    region: '亞太',
    tier: 'inner',
    cost: 2000,
    lifeExpGained: 11,
    salaryPenalty: 0.75,
    hpCost: 3,
    statEffect: { hp: 5 },
    description: '靈性島嶼，身心靈療癒之旅。',
  },
  {
    id: 'singapore',
    name: '新加坡',
    region: '亞太',
    tier: 'inner',
    cost: 2500,
    lifeExpGained: 10,
    salaryPenalty: 0.75,
    hpCost: 5,
    statEffect: { fq: 1 },
    description: '亞洲金融樞紐，開拓財務視野。',
  },
  {
    id: 'australia_sydney',
    name: '澳洲雪梨',
    region: '亞太',
    tier: 'inner',
    cost: 4000,
    lifeExpGained: 14,
    salaryPenalty: 0.7,
    hpCost: 8,
    description: '南半球大都市，體驗多元文化。',
  },

  // ── 外圈專屬（全球頂級）────────────────────────────────
  {
    id: 'france_paris',
    name: '法國巴黎',
    region: '歐洲',
    tier: 'outer',
    cost: 8000,
    lifeExpGained: 20,
    salaryPenalty: 0.85,
    hpCost: 8,
    statEffect: { nt: 2 },
    description: '藝術之都，結識國際精英。',
  },
  {
    id: 'usa_newyork',
    name: '美國紐約',
    region: '北美',
    tier: 'outer',
    cost: 9000,
    lifeExpGained: 20,
    salaryPenalty: 0.8,
    hpCost: 9,
    statEffect: { fq: 2 },
    description: '全球金融中心，深化財務洞察。',
  },
  {
    id: 'africa_safari',
    name: '非洲獵遊',
    region: '非洲',
    tier: 'outer',
    cost: 15000,
    lifeExpGained: 30,
    salaryPenalty: 0.7,
    hpCost: 12,
    statEffect: { sk: 1 },
    description: '壯闊草原，拓展人生格局。',
  },
  {
    id: 'antarctica',
    name: '南極探險',
    region: '極地',
    tier: 'outer',
    cost: 30000,
    lifeExpGained: 50,
    salaryPenalty: 0.6,
    hpCost: 15,
    statEffect: { legacyScore: 10 },
    description: '地球最南端，極少數人能到達的地方。傳承分直接加成。',
  },
  {
    id: 'italy_culture',
    name: '義大利文化之旅',
    region: '歐洲',
    tier: 'outer',
    cost: 10000,
    lifeExpGained: 22,
    salaryPenalty: 0.8,
    hpCost: 7,
    statEffect: { nt: 2 },
    description: '千年文藝復興，滋養人文素養。',
  },
  {
    id: 'uae_dubai',
    name: '中東杜拜',
    region: '中東',
    tier: 'outer',
    cost: 12000,
    lifeExpGained: 22,
    salaryPenalty: 0.8,
    hpCost: 8,
    statEffect: { fq: 1 },
    description: '現代奇蹟之城，感受財富的另一種面貌。',
  },
  {
    id: 'peru_machu',
    name: '南美洲秘魯',
    region: '南美',
    tier: 'outer',
    cost: 12000,
    lifeExpGained: 25,
    salaryPenalty: 0.7,
    hpCost: 12,
    description: '印加古文明，感受歷史的重量。',
  },
  {
    id: 'world_cruise',
    name: '環遊世界（郵輪）',
    region: '全球',
    tier: 'outer',
    cost: 50000,
    lifeExpGained: 80,
    salaryPenalty: 1.0, // 外圈無薪水懲罰
    hpCost: 10,
    statEffect: { nt: 1, fq: 1, sk: 1, hp: 5 },
    description: '人生最終夢想之旅，環遊世界一圈。所有屬性提升。',
  },
  {
    id: 'japan_fuji',
    name: '日本富士山朝聖',
    region: '亞太',
    tier: 'outer',
    cost: 5000,
    lifeExpGained: 18,
    salaryPenalty: 0.85,
    hpCost: 5,
    statEffect: { hp: 10 },
    description: '靈峰朝聖，精神深度修復。',
  },
  {
    id: 'silicon_valley',
    name: '矽谷創業考察',
    region: '北美',
    tier: 'outer',
    cost: 10000,
    lifeExpGained: 20,
    salaryPenalty: 0.85,
    hpCost: 6,
    statEffect: { fq: 3, unlockEntrepreneur: true },
    description: '走訪創業聖地，可能觸發創業者機會事件。',
  },
];
