export {
  AssetType,
  GamePhase,
  SocialClass,
  LifeStage,
  MarketEventType,
} from './gameConstants';
import {
  AssetType,
  GamePhase,
  SocialClass,
  LifeStage,
  MarketEventType,
  MEDICAL_INSURANCE_PREMIUM,
  LIFE_INSURANCE_PREMIUM,
  PROPERTY_INSURANCE_PREMIUM,
  PER_CHILD_EXPENSE,
  FQ_MULTIPLIERS,
  FAST_TRACK_INCOME_MULTIPLIER,
} from './gameConstants';
import { Deck, DealCard, DoodadCard, CrisisCard, MarketCard, SMALL_DEALS, BIG_DEALS, DOODADS, CRISIS_EVENTS, MARKET_CARDS } from './gameCards';
import type { AdminGlobalEvent, GlobalEventEffect } from './adminEvents';
import {
  SENIOR_MEDICAL_HP, SENIOR_MEDICAL_EXPENSE, SENIOR_CARE_HP, SENIOR_CARE_EXPENSE, MONTHS_PER_ROUND,
  CHILD_EXPENSE_BY_AGE, SOCIAL_INSURANCE_RATE, PREMIUM_MULT_BY_STAGE, LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS,
} from './gameConfig';
import type { Lifestyle, HealthHabit } from './gameConfig';

// ============================================================
// ENUMS — 定義於 gameConstants.ts，此處透過 re-export 保留向後相容性
// ============================================================
export interface GrowthStats {
  /** 學識 (0–10)：映射初始 financialIQ 與 careerSkill */
  academic:  number;
  /** 健康 (0–10)：映射初始 health */
  health:    number;
  /** 社交 (0–10)：映射初始 network */
  social:    number;
  /** 資源 (0–10)：映射起始現金加成（僅富裕/中等階層有意義） */
  resource:  number;
}

// MarketEventType 已移至 gameConstants.ts，透過 re-export 保留向後相容性

// ============================================================
// FINANCIAL INTERFACES
// ============================================================

/**
 * 職業的薪資計算類型（ESBI 象限各有不同）。
 * - fixed:    固定月薪（E 象限）
 * - random:   每發薪日隨機浮動於 minSalary–maxSalary（S 象限：自由接案）
 * - nt_driven: 收入 = NT × salaryPerNT（S 象限：業務員）
 * - sk_driven: 收入 = startingSalary + SK × salaryPerSK（S 象限：律師）
 */
export type SalaryType = 'fixed' | 'random' | 'nt_driven' | 'sk_driven';

/**
 * B/I 象限職業的起始資產模板。
 * createPlayer 會依此注入初始 Asset 與（如有）對應 Liability。
 * monthlyCashflow 已為淨值（已扣除貸款月付金額）。
 */
export interface StartingAssetTemplate {
  name: string;
  type: AssetType;
  /** 資產購買成本（市值） */
  cost: number;
  /** 每月淨現金流（已扣還款） */
  monthlyCashflow: number;
  /** 當前市場估值（與 cost 相同作為初始值） */
  currentValue: number;
  liabilityName?: string;
  liabilityAmount?: number;
  liabilityMonthlyPayment?: number;
}

/**
 * 職業模板，定義初始財務狀態。
 * 每一種職業在遊戲開始時會透過此介面初始化玩家的財務報表。
 */
export interface Profession {
  id: string;
  name: string;
  /** ESBI 象限標籤，用於前端顯示與教育說明 */
  quadrant: 'E' | 'S' | 'B' | 'I';
  /** 薪資計算類型；E 象限皆為 'fixed' */
  salaryType: SalaryType;

  /** fixed / sk_driven：月薪基本額；nt_driven / random：展示用基準（實際由公式計算） */
  startingSalary: number;
  /** random 專用：最低月收入 */
  minSalary?: number;
  /** random 專用：最高月收入 */
  maxSalary?: number;
  /** nt_driven 專用：每 1 NT 帶來的月收入 */
  salaryPerNT?: number;
  /**
   * nt_driven 專用：底薪基數（保底）。
   * 公式：total = salaryBase + NT × salaryPerNT
   * 用於避免 NT=1 起手月份直接破產。
   */
  salaryBase?: number;
  /** sk_driven 專用：每 1 SK 點在 startingSalary 之上增加的月收入 */
  salaryPerSK?: number;

  startingTaxes: number;
  startingHomeMortgage: number;
  startingCarLoan: number;
  startingCreditCard: number;
  startingOtherExpenses: number;
  startingCash: number;

  /** B/I 象限起始事業/投資資產（createPlayer 時注入） */
  startingAssets?: StartingAssetTemplate[];
  /** I 象限覆蓋 FQ 初始值（未設定時使用預設值 1） */
  startingFQ?: number;
  /**
   * 是否為「自由行程」職業。
   * true  → B/I 象限及無底薪業務（自主掌握時間），旅遊與社交活動不受每日次數限制。
   * false → E 象限及其他 S 象限（固定班表），每個發薪日只能進行 1 次選擇性活動。
   */
  hasFlexibleSchedule: boolean;
}

/**
 * 資產。
 * linkedLiabilityId 用於連結對應的負債（例如房產連結房貸），
 * 在傳承邏輯中確保資產與負債能一起轉移。
 */
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  /** 購買總成本（房地產為市場價格） */
  cost: number;
  /** 首付款（選填，僅房地產等需要貸款的資產使用） */
  downPayment?: number;
  /** 每月被動現金流（正值為收入，負值為淨支出） */
  monthlyCashflow: number;
  /** 當前市場估值（可因市場事件與購入 cost 不同） */
  currentValue: number;
  /** 對應的負債 ID，例如房貸 Liability 的 id */
  linkedLiabilityId?: string;
  /** 自住房：不算被動收入、不配息、出售免資本利得稅 */
  isResidence?: boolean;
}

/** 負債 */
export interface Liability {
  id: string;
  name: string;
  totalDebt: number;
  monthlyPayment: number;
  /** P2P monthly interest rate, retained through partial repayments. */
  monthlyRate?: number;
}

/** 保險持有狀態 */
export interface InsuranceState {
  /** 醫療險：觸發醫療事件時可豁免或降低費用 */
  hasMedicalInsurance: boolean;
  /** 壽險：玩家死亡時觸發傳承，資產轉移給繼承人 */
  hasLifeInsurance: boolean;
  /** 財產／企業險：觸發財產損失事件時可豁免費用 */
  hasPropertyInsurance: boolean;
}

/**
 * 支出細項，對應財務報表的 Expense 區塊。
 * 每個欄位代表單月金額。
 * 注意：保費與孩子支出由 Player.totalExpenses getter 依狀態自動計算，不在此儲存。
 */
export interface Expenses {
  taxes: number;
  /** 租屋月租（買房後歸零） */
  rent: number;
  homeMortgagePayment: number;
  carLoanPayment: number;
  creditCardPayment: number;
  otherExpenses: number;
}

/** 市場風雲事件 */
export interface MarketEvent {
  id: string;
  title: string;
  description: string;
  type: MarketEventType;
  /** 事件剩餘生效回合數，0 表示本回合結束後移除 */
  turnsRemaining: number;
}

/**
 * 全場決策階段。玩家可在手機送出選擇，但只有主持人能收束階段並繼續遊戲。
 * submitted 只公開「是否已送出」，不公開實際選項，避免大螢幕洩漏策略。
 */
export interface DecisionPhaseState {
  id: string;
  kind: 'reading' | 'payday' | 'deal' | 'charity' | 'crisis' | 'relationship' | 'marriage' | 'startup' | 'auction' | 'actions';
  description?: string;
  title: string;
  playerId: string;
  playerName: string;
  submitted: boolean;
  startedAt: number;
  /** 提醒用倒數終點；歸零不會自動送出或結束，仍由主持人決定。 */
  reminderEndsAt: number;
  /** 危機自救階段：本人可在此階段賣資產或申請應急借款，主持人確認後才判定生死。 */
  rescue?: boolean;
  /** 公開到大螢幕的決策內容（卡片、金額、選項），讓全場一起看 */
  publicLines?: string[];
}

export type FacilitatorSceneKind = 'community' | 'echo' | 'cooperation' | 'legacy' | 'marriage' | 'family' | 'global_event' | 'second_life' | 'career' | 'retirement';

export interface FacilitatorSceneState {
  id: string;
  kind: FacilitatorSceneKind;
  stage: 'prompt' | 'result';
  kicker: string;
  title: string;
  description: string;
  participantNames: string[];
  options?: { id: string; label: string; description: string }[];
  resultTitle?: string;
  resultDescription?: string;
  /** 主持人可調整的節奏提醒；歸零不會自動替玩家選擇。 */
  reminderEndsAt?: number;
  impacts?: { playerName: string; cashflowDelta: number; netWorthDelta: number; healthDelta: number }[];
  resumeOnClose: boolean;
  careerPlayerId?: string;
  careerConfirmed?: boolean;
}

export type AdaptiveDifficultyMode = 'support' | 'balanced' | 'challenge';

/**
 * 後台自動難度導演。只在季度發薪完成後評估，避免打斷玩家當前決策。
 * score 越高代表全場越順利，系統越可能加入溫和挑戰。
 */
export interface AdaptiveDirectorState {
  enabled: boolean;
  mode: AdaptiveDifficultyMode;
  score: number;
  reason: string;
  lastEvaluatedPayday: number;
  lastTriggeredPayday: number;
  lastEventId?: string;
  lastEventTitle?: string;
}

// ============================================================
// 玩家成長數值
// ============================================================

/**
 * 玩家的四個成長數值，在每個發薪日的「規劃分配階段」可投資提升。
 */
export interface PlayerStats {
  /** 財商值 FQ (1–10)：升級可提高被動收入乘數 */
  financialIQ: number;
  /** 健康值 HP (0–100)：影響疾病危機卡的受損程度；自然衰退 */
  health: number;
  /** 第二專長值 SK (0–100)：累積至 100 解鎖轉職機會 */
  careerSkill: number;
  /** 人脈值 NT (1–10)：帶來資訊與機遇優勢；部分自然成長 */
  network: number;
  /** NT≥3 的「免危機卡」一次性特權是否已使用 */
  networkCrisisSkipUsed: boolean;
  /** NT≥8 的「複製交易」一次性特權是否已使用 */
  networkDealCopyUsed: boolean;
}

/**
 * 玩家在發薪日規劃階段提交的投資選擇。
 * 每個 boolean 代表「是否選擇該投資項目」，實際扣款由 statsSystem 驗證。
 */
export interface PaydayPlanPayload {
  /** 本次結算涵蓋的月份；省略時視為舊版單月發薪。 */
  settlementMonths?: number;
  /** 本次涵蓋的健康／人脈成長週期數（＝經過輪數）；伺服器填入，用於維護費計算 */
  growthCycles?: number;
  /** 只接受伺服器當期清單的 ID；每人每次發薪最多買一份。 */
  basicInvestmentId?: string;
  /** 基本投資購買份數（1–10，預設 1） */
  basicInvestmentQuantity?: number;
  /** 升級財商值（費用依當前 FQ 等級而定，見 FQ_UPGRADE_COSTS） */
  investInFQUpgrade: boolean;
  /** 維護健康：阻止本次 HP 自然衰退（費用 $3,000） */
  investInHealthMaintenance: boolean;
  /** 積極投資健康：+20 HP 並阻止衰退（費用 $7,500，包含維護） */
  investInHealthBoost: boolean;
  /** 進修培訓：+20 SK（費用 $9,000） */
  investInSkillTraining: boolean;
  /** 主動拓展人脈：+1 NT（費用 $6,000） */
  investInNetwork: boolean;
  /** 股票定期定額投入金額（0 = 不投入；可選 15000 / 30000 / 75000）*/
  stockDCAAmount: number;
  /** 本次購買的保險類型（已持有的將被跳過）*/
  buyInsuranceTypes: Array<'medical' | 'life' | 'property'>;
  /** 生活方式（節儉／普通／享受），送出後持續到下次更改 */
  lifestyle?: Lifestyle;
  /** 健康習慣（規律運動／普通／熬夜加班） */
  healthHabit?: HealthHabit;
  /** 發薪日同步選擇的生活行動；由主持人收束決策後才執行。 */
  lifeChoice?:
    | { type: 'none' }
    | { type: 'travel'; destinationId: string; destinationName?: string }
    | { type: 'social' };
}

// ============================================================
// PLAYER CLASS
// ============================================================

const DEFAULT_INSURANCE_STATE: InsuranceState = {
  hasMedicalInsurance: false,
  hasLifeInsurance: false,
  hasPropertyInsurance: false,
};

const DEFAULT_EXPENSES: Expenses = {
  taxes: 0,
  homeMortgagePayment: 0,
  rent: 0,
  carLoanPayment: 0,
  creditCardPayment: 0,
  otherExpenses: 0,
};

// ============================================================
// 玩家事件日誌（用於遊戲結束後的決策反思分析）
// ============================================================

export type PlayerEventType =
  | 'global_event'
  | 'game_start'
  | 'payday'
  | 'asset_buy'
  | 'asset_sell'
  | 'travel'
  | 'marriage'
  | 'child'
  | 'crisis'
  | 'career_change'
  | 'education'
  | 'rat_race_escaped'
  | 'loan_taken'
  | 'loan_repaid'
  | 'bedridden'
  | 'relationship'
  | 'franchise'
  | 'death'
  | 'bucket_goal_achieved'
  | 'life_milestone'
  | 'lucky_card'
  | 'community_choice'
  | 'decision_echo'
  | 'cooperation'
  | 'legacy';

/**
 * 記錄玩家人生中每個關鍵決策與事件的快照。
 * 用於遊戲結束後的反思階段，展示人生時間軸與決策影響分析。
 */
export interface PlayerEvent {
  /** 事件發生時的遊戲年齡（20–100） */
  age: number;
  /** 事件類型 */
  type: PlayerEventType;
  /** 人類可讀說明（中文，用於時間軸顯示） */
  description: string;
  /** 事件發生前的手頭現金 */
  cashBefore: number;
  /** 事件發生後的手頭現金 */
  cashAfter: number;
  /** 事件發生前的月現金流 */
  cashflowBefore: number;
  /** 事件發生後的月現金流 */
  cashflowAfter: number;
  /** 事件發生前的淨資產（assets 市值 - liabilities 餘額） */
  netWorthBefore: number;
  /** 事件發生後的淨資產 */
  netWorthAfter: number;
  /** 附加資訊（如資產名稱、危機類型、職業名稱等） */
  meta?: Record<string, unknown>;
}

/**
 * 玩家，代表一張完整的財務報表。
 *
 * 所有「總計」欄位（totalPassiveIncome、totalIncome、totalExpenses、monthlyCashflow）
 * 皆為 getter，從原始數據動態計算，確保永遠一致。
 */
export class Player {
  /** 獨立於財務月數的健康／自然人脈成長週期。 */
  growthPaydayCount = 0;
  worldEffects: { eventId: string; title: string; expiresAfterPayday: number; effect: GlobalEventEffect }[] = [];
  id: string;
  name: string;
  profession: Profession;
  currentPosition: number;

  // --- 生命與傳承 ---
  isAlive: boolean;

  // --- 財務原始值 ---
  cash: number;
  salary: number;
  expenses: Expenses;
  assets: Asset[];
  liabilities: Liability[];
  insurance: InsuranceState;
  numberOfChildren: number;
  /** 收到的祝賀次數；每 5 次 NT +1 */
  congratulationsReceived: number;
  /** 65 歲人生轉折：working（未退休）、retired（領退休金）、consultant（顧問）、founder（退休創業） */
  retirementStatus: 'working' | 'retired' | 'consultant' | 'founder';
  /** 退休金月額（retired 時使用） */
  pensionMonthly: number;
  /** 是否已進入 65 歲後的醫療／長照支出階段 */
  isSenior: boolean;
  /** 已延後退休的次數 */
  retirementDeferrals: number;
  /** 延後退休當下的輪數（該輪不再詢問） */
  retirementDeferralRound: number;
  /** 職涯期間有薪月數與累計薪資，用來算退休金 */
  salaryMonthsWorked: number;
  salaryTotalEarned: number;
  /**
   * 累計發薪日次數。每次 triggerPayday 時遞增。
   * 每 12 個月觸發一次年度累進稅結算。
   */
  paydayCount: number;
  /**
   * 玩家成長數值（財商、健康、第二專長、人脈）。
   * 在每個發薪日的規劃階段可投資提升。
   */
  stats: PlayerStats;
  /**
   * 是否正處於發薪日規劃等待中。
   * true 時伺服器等待玩家提交 submitPaydayPlan（或逾時自動略過）。
   */
  paydayPlanningPending: boolean;
  /**
   * 尚需跳過的回合數（危機事件 / 住院）。
   * > 0 時 playerRoll 開頭自動跳過並遞減，不進行正常移動。
   */
  turnsToSkip: number;
  /**
   * 裁員剩餘發薪日數。
   * > 0 時 triggerPayday 中薪資計為 0，每次發薪遞減 1。
   */
  downsizingTurnsLeft: number;
  /**
   * 慈善捐款後的額外骰子數。
   * > 0 時下次 playerRoll 的骰子數加上此值，擲完後歸零。
   */
  bonusDice: number;
  /**
   * 信用值（300–850）。影響銀行借款的月利率與單次借款上限。
   * - 還款行為可提升；應急借款與發薪日現金流為負會降低。
   * - 投資槓桿借款不影響信用值。
   */
  creditScore: number;

  // --- 百歲人生：開局與人生旅程 ---

  /** 投胎社會階層（隨機決定，開局時定義） */
  socialClass: SocialClass;
  /**
   * 20 歲前成長點數分配結果。
   * 決定玩家成人 stats 初始值與職業選擇權。
   */
  growthStats: GrowthStats;
  /** 尚未分配的成長點數（開局 Pre20 階段使用，分配完畢後歸零） */
  growthPointsRemaining: number;
  /**
   * 生命體驗值：經歷各種事件（旅遊、婚姻、危機、投資）時累積。
   * 值越高最終 Life Score 越高，體現「豐富人生」的遊戲主題。
   */
  lifeExperience: number;
  /** 是否曾選擇「繼續進修」（20 歲職業選擇時），會帶來學生貸款但開放高階職業 */
  hasContinuedEducation: boolean;
  /** 玩家職涯起始年齡（22 = 基礎職業，25 = 進修後高階職業） */
  startAge: number;
  /** 是否已結婚（影響部分事件機率與 marriageBonus） */
  isMarried: boolean;
  /** 結婚帶來的月收入加成（$0 若未婚） */
  marriageBonus: number;
  /**
   * 深度關係經營值（Deep Relationship Score）。
   * 透過聯誼活動或主持人觸發累積；達到閾值後可提親結婚。
   */
  relationshipPoints: number;
  /**
   * 關係路徑是否已啟動（主動聯誼或主持人觸發後為 true）。
   * false 時 attendSocialEvent 不會累積 DRS。
   */
  relationshipActive: boolean;
  /**
   * 婚姻類型：love（自然戀愛）、matchmaker（主持人媒合）、arranged（買賣婚姻）。
   * 未婚時為 undefined。
   */
  marriageType?: 'love' | 'matchmaker' | 'arranged';
  /**
   * HP 歸零後進入臥床狀態，無法行動。
   * 每次輪到該玩家自動跳過回合，且有 30% 機率觸發自然死亡。
   */
  isBedridden: boolean;
  /**
   * 旅遊薪資懲罰剩餘次數。
   * > 0 時下次 triggerPayday 薪資乘以 TRAVEL_SALARY_PENALTY，並遞減 1。
   */
  travelPenaltyRemaining: number;
  /**
   * 人際關係卡等帶來的暫時薪資倍率（例如 1.2 升遷、0.9 減薪）。
   * triggerPayday 每月套用一次並遞減 salaryMultiplierMonths；歸零後恢復。
   */
  salaryMultiplierPending: number;
  salaryMultiplierMonths: number;
  /** 決策回聲等給的永久月薪加成，triggerPayday 重算薪資時加回。 */
  salaryBonus: number;
  /**
   * 是否已進入 FastTrack（外圈）。
   * true 時 totalIncome 套用 FAST_TRACK_INCOME_MULTIPLIER（被動收入加倍）。
   */
  isInFastTrack: boolean;
  /** 外圈當前位置（0–16），進入 FastTrack 後獨立計算。 */
  fastTrackPosition: number;
  /** 已造訪過的旅遊目的地 ID 清單（每個目的地只計一次體驗值）。 */
  visitedDestinations: string[];
  /** 旅遊特殊事件（如南極探險）直接累積的傳承分加分點數。 */
  legacyBonusPoints: number;
  /** 外圈稅務規劃累積的「下一次年度稅」減免比例；年度結算後歸零。 */
  taxPlanningCreditRate: number;
  /**
   * 是否已完成 Pre-20 流程（投胎、分配成長點數、選職業）。
   * startGame 時會驗證所有玩家均為 true 才允許啟動。
   */
  pre20Done: boolean;
  /**
   * 本發薪日剩餘的「選擇性活動」次數。
   * 固定行程職業（hasFlexibleSchedule = false）每發薪日重置為 1，
   * 使用旅遊或社交活動後扣 1；自由行程職業不受此限制（值保持 Infinity）。
   */
  actionTokensThisPayday: number;
  /** 進修尚需延後的完整人生回合數；通常為 1。 */
  educationTurnsToSkip: number;
  /** 玩家是否處於斷線等待重連狀態（30 秒內可重新加入恢復資料）。 */
  isDisconnected: boolean;
  /** 玩家是否已至少路過「第二人生」格一次；路過後才能進入 FastTrack。 */
  hasPassedSecondLife: boolean;
  /**
   * 玩家人生事件日誌。
   * 用於遊戲結束後的決策反思分析，記錄每個關鍵決策點的前後財務狀況。
   */
  eventLog: PlayerEvent[];

  /** 已故玩家每場僅能透過主持人進行一次傳承儀式。 */
  legacyActionUsed: boolean;

  /**
   * 累積慈善捐款金額（含內圈/外圈 Charity 格、人際關係捐款等所有管道）。
   * 用於慈善排行榜與最終評分加成（每 $100K +5 傳承點）。
   */
  charityTotal: number;

  /**
   * 人生夢想清單（Bucket List）— 進入外圈時隨機抽 3 個目標。
   * 達成時 claimed=true 並加分；全部達成額外給一次性大獎。
   */
  bucketList: { id: string; claimed: boolean; claimedAt?: number }[];

  /**
   * 已通過的人生里程碑年齡（40/60/80）。
   * 跨越時觸發「人生回顧」事件，依當下狀態自動加分。
   */
  milestonesPassed: { age40: boolean; age60: boolean; age80: boolean };

  // --- 真實人生擬真 ---
  /** 伺服器每輪同步的個人年齡（支出分段、保費倍率用） */
  currentAge: number;
  /** 累積薪資成長倍率（每輪依階段成長；升遷永久加薪） */
  salaryGrowthMultiplier: number;
  /** 生活成本上漲倍率（其他支出、房租） */
  livingCostMultiplier: number;
  /** 每個孩子出生時的本人年齡 */
  childBirthAges: number[];
  /** 生活方式 */
  lifestyle: Lifestyle;
  /** 健康習慣 */
  healthHabit: HealthHabit;
  /** 配偶（含收入與失業狀態）；未婚為 null */
  spouse: { income: number; unemployedMonthsLeft: number; retired: boolean } | null;
  /** 住房：租屋或自有 */
  housing: 'rent' | 'own';
  /** 奉養父母／長照等暫時性月支出 */
  recurringExpenses: { id: string; label: string; monthly: number; monthsLeft: number }[];
  /** 已被裁員總月數（復盤用） */
  layoffMonthsTotal: number;

  constructor(id: string, name: string, profession: Profession) {
    this.id = id;
    this.name = name;
    this.profession = profession;
    this.currentPosition = 0;
    this.isAlive = true;

    this.cash = profession.startingCash;
    this.salary = profession.startingSalary;
    this.expenses = {
      ...DEFAULT_EXPENSES,
      taxes: profession.startingTaxes,
      // 開局租屋：職業設定的「房貸」數字改為月租；買房後才有房貸
      rent: profession.startingHomeMortgage,
      homeMortgagePayment: 0,
      carLoanPayment: profession.startingCarLoan,
      creditCardPayment: profession.startingCreditCard,
      otherExpenses: profession.startingOtherExpenses,
    };
    this.assets = [];
    this.liabilities = [];
    this.insurance = { ...DEFAULT_INSURANCE_STATE };
    this.numberOfChildren = 0;
    this.congratulationsReceived = 0;
    this.retirementStatus = 'working';
    this.pensionMonthly = 0;
    this.isSenior = false;
    this.retirementDeferrals = 0;
    this.retirementDeferralRound = -1;
    this.salaryMonthsWorked = 0;
    this.salaryTotalEarned = 0;
    this.paydayCount = 0;
    this.stats = {
      financialIQ: 1,
      health: 80,
      careerSkill: 0,
      network: 1,
      networkCrisisSkipUsed: false,
      networkDealCopyUsed: false,
    };
    this.paydayPlanningPending = false;
    this.turnsToSkip = 0;
    this.downsizingTurnsLeft = 0;
    this.bonusDice = 0;
    this.creditScore = 600;

    // 百歲人生：開局預設值（Pre20 流程完成前為佔位值）
    this.socialClass = SocialClass.Middle;
    this.growthStats = { academic: 0, health: 0, social: 0, resource: 0 };
    this.growthPointsRemaining = 0;
    this.lifeExperience = 0;
    this.hasContinuedEducation = false;
    this.startAge = 20;
    this.isMarried = false;
    this.marriageBonus = 0;
    this.relationshipPoints = 0;
    this.relationshipActive = false;
    this.marriageType = undefined;
    this.isBedridden = false;
    this.travelPenaltyRemaining = 0;
    this.salaryMultiplierPending = 1;
    this.salaryMultiplierMonths = 0;
    this.salaryBonus = 0;
    this.isInFastTrack = false;
    this.fastTrackPosition = 0;
    this.visitedDestinations = [];
    this.legacyBonusPoints = 0;
    this.taxPlanningCreditRate = 0;
    this.pre20Done = false;
    this.actionTokensThisPayday = profession.hasFlexibleSchedule ? Infinity : 1;
    this.educationTurnsToSkip = 0;
    this.isDisconnected = false;
    this.hasPassedSecondLife = false;
    this.eventLog = [];
    this.legacyActionUsed = false;
    this.charityTotal = 0;
    this.bucketList = [];
    this.milestonesPassed = { age40: false, age60: false, age80: false };

    this.currentAge = 20;
    this.salaryGrowthMultiplier = 1;
    this.livingCostMultiplier = 1;
    this.childBirthAges = [];
    this.lifestyle = 'normal';
    this.healthHabit = 'normal';
    this.spouse = null;
    this.housing = 'rent';
    this.recurringExpenses = [];
    this.layoffMonthsTotal = 0;
  }

  /** 目前人生階段（依 currentAge） */
  get lifeStage(): LifeStage {
    const age = this.currentAge;
    if (age < 35) return LifeStage.Youth;
    if (age < 50) return LifeStage.Family;
    if (age < 65) return LifeStage.Transition;
    if (age < 80) return LifeStage.Retirement;
    return LifeStage.Legacy;
  }

  /** 子女支出：依每個孩子目前年齡分段，成年後為 0 */
  get childExpenses(): number {
    return this.childBirthAges.reduce((sum, bornAt) => {
      const childAge = this.currentAge - bornAt;
      const tier = CHILD_EXPENSE_BY_AGE.find((t) => childAge <= t.maxAge);
      return sum + (tier ? tier.monthly : 0);
    }, 0);
  }

  /** 尚未成年的子女數（節稅扶養用） */
  get dependentChildren(): number {
    const lastTier = CHILD_EXPENSE_BY_AGE[CHILD_EXPENSE_BY_AGE.length - 1];
    return this.childBirthAges.filter((bornAt) => this.currentAge - bornAt <= lastTier.maxAge).length;
  }

  /** 勞健保：有薪工作者薪資 × 5%（退休金、顧問不算） */
  get socialInsurance(): number {
    if (this.retirementStatus !== 'working' || this.salary <= 0) return 0;
    return Math.round(this.salary * SOCIAL_INSURANCE_RATE);
  }

  /** 保費（隨年齡上升） */
  get insurancePremiums(): number {
    const mult = PREMIUM_MULT_BY_STAGE[this.lifeStage] ?? 1;
    const base =
      (this.insurance.hasMedicalInsurance ? MEDICAL_INSURANCE_PREMIUM : 0) +
      (this.insurance.hasLifeInsurance ? LIFE_INSURANCE_PREMIUM : 0) +
      (this.insurance.hasPropertyInsurance ? PROPERTY_INSURANCE_PREMIUM : 0);
    return Math.round(base * mult);
  }

  /** 生活支出（其他支出 × 生活方式 × 生活成本上漲）＋ 健康習慣附帶支出 */
  get livingExpenses(): number {
    const style = LIFESTYLE_OPTIONS[this.lifestyle] ?? LIFESTYLE_OPTIONS.normal;
    const habit = HEALTH_HABIT_OPTIONS[this.healthHabit] ?? HEALTH_HABIT_OPTIONS.normal;
    return Math.round(this.expenses.otherExpenses * style.expenseMultiplier * this.livingCostMultiplier) + habit.monthlyCost;
  }

  /** 房租（隨生活成本上漲；買房後為 0） */
  get rentExpense(): number {
    if (this.housing === 'own') return 0;
    return Math.round((this.expenses.rent ?? 0) * this.livingCostMultiplier);
  }

  /** 配偶收入（失業中為 0） */
  get spouseIncome(): number {
    if (!this.spouse) return 0;
    return this.spouse.unemployedMonthsLeft > 0 ? 0 : this.spouse.income;
  }

  /** 暫時性月支出（奉養父母等）加總 */
  get recurringExpenseTotal(): number {
    return this.recurringExpenses.reduce((sum, r) => sum + (r.monthsLeft > 0 ? r.monthly : 0), 0);
  }

  /** 所有資產的每月現金流總和 */
  get totalPassiveIncome(): number {
    return this.assets.reduce((sum, asset) => {
      if (asset.isResidence) return sum;
      const multiplier = this.worldEffects.reduce((factor, entry) =>
        entry.effect.type === 'CashflowChange' && entry.effect.targetAssetType === asset.type
          ? factor * (entry.effect.multiplier ?? 1) : factor, 1);
      // 負現金流是既有成本，景氣下滑不應反而減輕它。
      return sum + (asset.monthlyCashflow > 0 ? Math.round(asset.monthlyCashflow * multiplier) : asset.monthlyCashflow);
    }, 0);
  }

  /** 65 歲後：HP < 60 每月醫療 +3,000；HP < 30 再加長照 +9,000 */
  get seniorCareExpense(): number {
    if (!this.isSenior) return 0;
    return (this.stats.health < SENIOR_MEDICAL_HP ? SENIOR_MEDICAL_EXPENSE : 0)
      + (this.stats.health < SENIOR_CARE_HP ? SENIOR_CARE_EXPENSE : 0);
  }

  /** 職涯平均月薪（退休金基準）；沒有薪資紀錄時用目前薪資 */
  get averageCareerSalary(): number {
    return this.salaryMonthsWorked > 0 ? Math.round(this.salaryTotalEarned / this.salaryMonthsWorked) : this.salary;
  }

  get worldExpenseAdjustment(): number {
    const change = this.worldEffects.reduce((sum, entry) =>
      sum + (entry.effect.type === 'ExpenseChange' ? entry.effect.flatAmount ?? 0 : 0), 0);
    return Math.max(-this.expenses.otherExpenses, change);
  }

  /** 工資 + 被動收入（被動收入依財商值 FQ 套用乘數）+ 婚姻收入加成
   *
   * FastTrack 玩家的被動收入額外乘以 FAST_TRACK_INCOME_MULTIPLIER（2×），
   * 體現外圈資產倍增速度遠超內圈的設計。
   */
  get totalIncome(): number {
    const fqMultiplier = FQ_MULTIPLIERS[this.stats.financialIQ] ?? 1.0;
    const ftMultiplier = this.isInFastTrack ? FAST_TRACK_INCOME_MULTIPLIER : 1.0;
    return this.salary + Math.round(this.totalPassiveIncome * fqMultiplier * ftMultiplier) + this.marriageBonus + this.spouseIncome;
  }

  /**
   * 所有支出細項加總。
   * 保費依 insurance 持有狀態從 gameConfig 常量自動計算；
   * 孩子費用依 numberOfChildren × PER_CHILD_EXPENSE 自動計算；
   * 「無擔保負債月付」（應急借款、進修貸款、P2P 借貸、投資槓桿借款等）
   * 自動加總 — 房貸／事業貸款不算（因其資產的 monthlyCashflow 已是淨額）。
   */
  get totalExpenses(): number {
    const e = this.expenses;
    const securedLiabilityIds = new Set(
      this.assets.map((a) => a.linkedLiabilityId).filter((id): id is string => Boolean(id))
    );
    const unsecuredLoanPayments = this.liabilities
      .filter((l) => !securedLiabilityIds.has(l.id))
      .reduce((sum, l) => sum + (l.monthlyPayment ?? 0), 0);

    return (
      e.taxes +
      this.socialInsurance +
      this.seniorCareExpense +
      this.rentExpense +
      e.homeMortgagePayment +
      e.carLoanPayment +
      e.creditCardPayment +
      this.livingExpenses +
      this.worldExpenseAdjustment +
      this.insurancePremiums +
      this.childExpenses +
      this.recurringExpenseTotal +
      unsecuredLoanPayments
    );
  }

  /** 每月淨現金流 = 總收入 − 總支出 */
  get monthlyCashflow(): number {
    return this.totalIncome - this.totalExpenses;
  }
}

// ============================================================
// GAME STATE CLASS
// ============================================================

/**
 * 全局遊戲狀態，由伺服器管理一個完整房間的所有狀態。
 */
export class GameState {
  pendingWorldEvent: { id: string; event: AdminGlobalEvent; source: 'manual' | 'automatic'; deferred: boolean } | null = null;
  worldEventHistory: { eventId: string; title: string; payday: number; round: number; source: string; major: boolean }[] = [];
  turnInProgress = false;
  /** 落格說明自動放行毫秒數；預設 10 秒，0 = 每次都等主持人按「看完了，繼續」。 */
  readingAutoContinueMs = 10_000;
  /** 玩家送出選擇後是否自動揭曉（不必等主持人按）；競標仍由主持人結束。 */
  autoRevealOnSubmit = true;
  /** 已跑過「全體行動時間」的輪數（turnNumber）；每輪開始只跑一次 */
  /** 每輪開始是否開「全體行動時間」（主持人可關） */
  actionPhaseEnabled = true;
  actionPhaseRound = -1;
  /** 人生轉折：待處理的玩家順序 */
  retirementQueue: string[] = [];
  /** 主持人自訂結婚禮金（null = 用預設表 + 隨機浮動） */
  marriageGiftOverride: number | null = null;
  /** 每輪結算月數（12／24／48） */
  monthsPerRound = MONTHS_PER_ROUND;
  /** 計時發薪：開關、間隔、上次發薪時的「有效經過時間」與輪數 */
  paydayTimerEnabled = true;
  paydayIntervalMs = 10 * 60 * 1000;
  lastPaydayActiveMs = 0;
  roundsAtLastPayday = 0;
  /** 本輪行動時間已按「完成」的玩家 */
  actionPhaseDone: Set<string> = new Set();
  gameId: string;
  /** 以玩家 ID 為 key 的快速查詢表 */
  players: Map<string, Player>;
  /** 玩家回合順序（存放玩家 ID，按加入順序排列） */
  playerOrder: string[];
  currentPlayerTurnId: string;
  gamePhase: GamePhase;
  /** 已完成的全體人生回合數；每增加 1，遊戲年齡增加 4 歲。 */
  turnNumber: number;
  marketEvents: MarketEvent[];
  createdAt: Date;
  /** 已通過密碼驗證的管理員 Socket ID；未登入時為 undefined */
  adminSocketId?: string;

  // ── 玩家互動：暫存 offers ─────────────────────────────────
  /** 待回應的合夥邀請（key = offerId） */
  pendingPartnershipOffers?: Record<string, {
    offerorId: string; targetId: string; dealCardId?: string; createdAt: number;
  }>;
  /** 待回應的 P2P 借貸邀請（key = offerId）— 借款方主動「提供借款」給特定玩家 */
  pendingLoanOffers?: Record<string, {
    lenderId: string; borrowerId: string; amount: number; monthlyRate: number; createdAt: number;
  }>;
  /**
   * 待回應的 P2P 借貸請求（key = requestId）— 玩家「主動向其他玩家請求借款」。
   * 被請求的玩家可以接受（同意以指定條件借款）或拒絕。
   */
  pendingLoanRequests?: Record<string, {
    borrowerId: string; lenderId: string; amount: number; monthlyRate: number; createdAt: number;
  }>;
  /** 進行中的競標（key = auctionId） */
  activeAuctions?: Record<string, {
    dealCardId: string; startTime: number; endTime: number;
    highestBid: number; highestBidderId?: string; highestBidderName?: string;
    minBid: number; triggeredBy: string; triggeredByName: string;
    cardInfo?: { name: string; monthlyCashflow: number; downPayment: number };
    isSpecialAuction?: boolean;
    /** 出價紀錄（公開喊價，主持人後台可看） */
    bids?: { bidderId: string; bidderName: string; amount: number; at: number }[];
  }>;

  // ── 回合年齡＋主持人活動倒數 ─────────────────────────────────
  /** 活動倒數開始時間；只供主持人掌控總時長，不再決定遊戲年齡。 */
  gameStartTime: Date | null;
  /** 遊戲總時長（毫秒）。預設 90 分鐘 = 5,400,000 ms，主持人可設定 */
  gameDurationMs: number;
  /** 當前暫停開始時間；null 表示未暫停 */
  pausedAt: Date | null;
  /** 所有歷次暫停的累積毫秒數（用於準確計算已過時間） */
  totalPausedMs: number;

  /** 當前發薪日規劃中已確認完成的玩家 ID 集合（全員確認後自動恢復時鐘） */
  paydayPlanningConfirmed: Set<string>;

  /** 主持人控制的目前決策階段；null 表示正在正常推進棋盤。 */
  decisionPhase: DecisionPhaseState | null;

  /** 主持人導演的大螢幕舞台事件；存在時正常回合暫停。 */
  facilitatorScene: FacilitatorSceneState | null;
  /** 舞台事件尚未公開的伺服器端資料，不會傳到前端。 */
  facilitatorSceneContext: Record<string, unknown> | null;
  careerRequests: { id: string; playerId: string; professionId: string }[] = [];
  /** 已使用的決策回聲索引，避免同一選擇重複出現。 */
  facilitatorEchoHistory: Set<string>;

  /** 每季結算後依全場狀況調節隨機事件強度。 */
  adaptiveDirector: AdaptiveDirectorState;

  /** 完成第 19 個全體回合、來到 96 歲後進入公平的最後一輪。 */
  finalRoundStarted: boolean;
  /** 尚未完成最後一次行動的存活玩家 ID，依實際回合順序排列。 */
  finalRoundPendingPlayerIds: string[];

  /** 距離上次全體發薪日已完成的完整輪數（0–3）。 */
  roundsSinceGlobalPayday: number;
  /** 第三輪結束後等待伺服器啟動全體季度結算。 */
  globalPaydayPending: boolean;
  /** 全體季度結算正在依序進行。 */
  globalPaydayInProgress: boolean;
  /** 已完成的全體發薪次數。 */
  globalPaydayNumber: number;

  // ── 牌組 ──────────────────────────────────────────────────
  smallDealDeck: Deck<DealCard>;
  bigDealDeck: Deck<DealCard>;
  doodadDeck: Deck<DoodadCard>;
  crisisDeck: Deck<CrisisCard>;
  marketDeck: Deck<MarketCard>;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.players = new Map();
    this.playerOrder = [];
    this.currentPlayerTurnId = '';
    this.gamePhase = GamePhase.WaitingForPlayers;
    this.turnNumber = 0;
    this.marketEvents = [];
    this.createdAt = new Date();
    this.gameStartTime = null;
    this.gameDurationMs = 5_400_000; // 預設 90 分鐘
    this.pausedAt = null;
    this.totalPausedMs = 0;
    this.paydayPlanningConfirmed = new Set();
    this.decisionPhase = null;
    this.facilitatorScene = null;
    this.facilitatorSceneContext = null;
    this.facilitatorEchoHistory = new Set();
    this.adaptiveDirector = {
      enabled: true,
      mode: 'balanced',
      score: 50,
      reason: '尚未完成第一次季度評估',
      lastEvaluatedPayday: 0,
      lastTriggeredPayday: 0,
    };
    this.finalRoundStarted = false;
    this.finalRoundPendingPlayerIds = [];
    this.roundsSinceGlobalPayday = 0;
    this.globalPaydayPending = false;
    this.globalPaydayInProgress = false;
    this.globalPaydayNumber = 0;
    this.smallDealDeck = new Deck(SMALL_DEALS);
    this.bigDealDeck   = new Deck(BIG_DEALS);
    this.doodadDeck    = new Deck(DOODADS);
    this.crisisDeck    = new Deck(CRISIS_EVENTS);
    this.marketDeck    = new Deck(MARKET_CARDS);
  }

  /** 加入玩家並記錄回合順序 */
  addPlayer(player: Player): void {
    this.players.set(player.id, player);
    this.playerOrder.push(player.id);
  }

  /** 移除玩家（中途離線等情況） */
  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.playerOrder = this.playerOrder.filter((id) => id !== playerId);
    this.finalRoundPendingPlayerIds = this.finalRoundPendingPlayerIds.filter((id) => id !== playerId);
  }

  /**
   * 推進到下一位存活玩家的回合。
   * 跳過 isAlive = false 的玩家。
   */
  advanceToNextTurn(): void {
    if (this.playerOrder.length === 0) return;

    if (this.finalRoundStarted) {
      this.finalRoundPendingPlayerIds = this.finalRoundPendingPlayerIds.filter(
        (id) => id !== this.currentPlayerTurnId
      );
    }

    const currentIndex = this.playerOrder.indexOf(this.currentPlayerTurnId);
    const total = this.playerOrder.length;

    for (let offset = 1; offset <= total; offset++) {
      const nextIndex = (currentIndex + offset) % total;
      const nextId = this.playerOrder[nextIndex];
      const nextPlayer = this.players.get(nextId);

      if (nextPlayer?.isAlive) {
        this.currentPlayerTurnId = nextId;
        if (nextIndex <= currentIndex) {
          this.turnNumber += 1;
          if (!this.finalRoundStarted && !this.globalPaydayInProgress && !this.globalPaydayPending) {
            this.roundsSinceGlobalPayday += 1;
            // 計時器關閉時才用「每三輪」備援；開啟時由伺服器依時間判定
            if (!this.paydayTimerEnabled && this.roundsSinceGlobalPayday >= 3) {
              this.globalPaydayPending = true;
            }
          }
        }
        return;
      }
    }
  }
}
