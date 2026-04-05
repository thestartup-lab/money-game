// 與後端 gameDataModels.ts 對應的前端型別定義

export type GamePhase = 'WaitingForPlayers' | 'Pre20' | 'RatRace' | 'FastTrack' | 'GameOver';
export type SocialClass = 'Wealthy' | 'UpperMiddle' | 'Middle' | 'LowerClass';
export type LifeStage = 'Youth' | 'Family' | 'Peak' | 'Senior' | 'Legacy';
export type PlayerEventType =
  | 'game_start' | 'payday' | 'asset_buy' | 'asset_sell'
  | 'travel' | 'marriage' | 'child' | 'crisis'
  | 'career_change' | 'education' | 'rat_race_escaped'
  | 'loan_taken' | 'loan_repaid' | 'bedridden' | 'relationship' | 'death';

export interface PlayerEvent {
  age: number;
  type: PlayerEventType;
  description: string;
  cashBefore: number;
  cashAfter: number;
  cashflowBefore: number;
  cashflowAfter: number;
  netWorthBefore: number;
  netWorthAfter: number;
  meta?: Record<string, unknown>;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  cost: number;
  currentValue?: number;
  downPayment?: number;
  monthlyCashflow: number;
  linkedLiabilityId?: string;
}

export interface Liability {
  id: string;
  name: string;
  totalDebt: number;
  monthlyPayment: number;
}

export interface PlayerStats {
  financialIQ: number;
  health: number;
  careerSkill: number;
  network: number;
  networkCrisisSkipUsed: boolean;
  networkDealCopyUsed: boolean;
}

export interface Expenses {
  taxes: number;
  homeMortgagePayment: number;
  carLoanPayment: number;
  creditCardPayment: number;
  otherExpenses: number;
  insurancePremiums: number;
  childExpenses: number;
}

export interface InsuranceState {
  hasMedicalInsurance: boolean;
  hasLifeInsurance: boolean;
  hasPropertyInsurance: boolean;
}

export interface Profession {
  id: string;
  name: string;
  quadrant: string;
  salaryType: string;
  startingSalary: number;
}

export interface Player {
  id: string;
  name: string;
  profession: Profession;
  quadrant: string;
  salaryType: string;
  currentPosition: number;
  isAlive: boolean;
  cash: number;
  salary: number;
  expenses: Expenses;
  assets: Asset[];
  liabilities: Liability[];
  insurance: InsuranceState;
  numberOfChildren: number;
  paydayCount: number;
  stats: PlayerStats;
  paydayPlanningPending: boolean;
  turnsToSkip: number;
  downsizingTurnsLeft: number;
  bonusDice: number;
  creditScore: number;
  socialClass: SocialClass;
  growthStats: { academic: number; health: number; social: number; resource: number };
  growthPointsRemaining: number;
  lifeExperience: number;
  hasContinuedEducation: boolean;
  startAge: number;
  isMarried: boolean;
  marriageBonus: number;
  relationshipPoints: number;
  relationshipActive: boolean;
  marriageType?: string;
  isBedridden: boolean;
  travelPenaltyRemaining: number;
  isInFastTrack: boolean;
  hasPassedSecondLife: boolean;
  fastTrackPosition: number;
  visitedDestinations: string[];
  legacyBonusPoints: number;
  pre20Done: boolean;
  /** 本發薪日剩餘選擇性活動次數（自由行程職業為 Infinity）*/
  actionTokensThisPayday: number;
  /** 是否為自由行程職業（B/I 象限及無底薪業務）*/
  hasFlexibleSchedule: boolean;
  /** 進修代價：true 時下一個發薪日自動跳過 */
  skipFirstPayday: boolean;
  totalPassiveIncome: number;
  totalIncome: number;
  totalExpenses: number;
  monthlyCashflow: number;
  nextFQUpgradeCost: number | null;
  eventLog: PlayerEvent[];
}

export interface GameState {
  gameId: string;
  roomId: string;
  players: Player[];
  playerOrder: string[];
  currentPlayerTurnId: string;
  gamePhase: GamePhase;
  turnNumber: number;
  createdAt: string;
  hasAdmin: boolean;
  gameStartTime?: string;
  gameDurationMs: number;
  isPaused: boolean;
  currentAge: number;
  currentStage: LifeStage;
}

export interface LifeScoreBreakdown {
  // 7 維度原始分（0–100，供雷達圖）
  netWorth:            number;
  passiveIncome:       number;
  lifeExperience:      number;
  hp:                  number;
  financialHealth:     number;
  family:              number;
  legacyScore:         number;
  // 3 大幸福指數（0–100）
  lifeExperienceIndex: number;
  achievementIndex:    number;
  relationshipIndex:   number;
  // 總分與評等
  total:               number;
  grade:               string;
  achievements:        string[];
}

export interface PlayerAnalysis {
  playerId: string;
  playerName: string;
  profession: string;
  quadrant: string;
  isMarried: boolean;
  numberOfChildren: number;
  lifeExperience: number;
  deathAge: number;
  finalScore: LifeScoreBreakdown;
  eventLog: PlayerEvent[];
  summary: {
    assetBuyCount: number;
    assetSellCount: number;
    crisisCount: number;
    travelCount: number;
    paydayCount: number;
    isMarried: boolean;
    numberOfChildren: number;
    escapedRatRace: boolean;
    finalNetWorth: number;
    finalCashflow: number;
    finalPassiveIncome: number;
  };
  cashflowHistory: { age: number; cashflow: number; netWorth: number }[];
  keyDecisions: {
    age: number;
    type: PlayerEventType;
    description: string;
    cashflowDelta: number;
    cashDelta: number;
    netWorthDelta: number;
  }[];
}

export interface RoomPlayerSummary {
  playerId: string;
  playerName: string;
  profession: string;
  quadrant: string;
  isAlive: boolean;
  isMarried: boolean;
  numberOfChildren: number;
  lifeExperience: number;
  deathAge: number;
  escapedRatRace: boolean;
  finalNetWorth: number;
  finalCashflow: number;
  finalPassiveIncome: number;
  score: LifeScoreBreakdown;
  cashflowHistory: { age: number; cashflow: number; netWorth: number }[];
}

// ── 外圈新格子事件型別 ─────────────────────────────────────

/** 科技新創投資機會（後端 emit 給落格玩家）*/
export interface TechStartupOffer {
  playerId: string;
  playerName: string;
  investmentAmount: number;
  playerCash: number;
}

/** 科技新創結果（後端 emit 給落格玩家）*/
export interface TechStartupResult {
  playerId: string;
  invested: boolean;
  success?: boolean;
  diceRoll?: number;
  investmentAmount: number;
  monthlyCashflow?: number;
  cashAfter?: number;
}

/** 資產槓桿自動獎勵（後端 emit 給落格玩家）*/
export interface AssetLeverageBonus {
  playerId: string;
  playerName: string;
  bonus: number;
  passiveIncome: number;
  cashAfter: number;
}

/** 疾病危機卡結果（後端 emit 給落格玩家）*/
export interface DiseaseCrisisCard {
  crisis: {
    id: string;
    title: string;
    description: string;
    requiredInsurance: string;
    baseCost: number;
    insuredCost: number;
    turnsLostWithoutInsurance: number;
    turnsLostWithInsurance: number;
    canCauseDeath: boolean;
  };
  result: {
    wasInsured: boolean;
    effectiveCost: number;
    turnsLost: number;
    deathTriggered: boolean;
  };
  hpBefore: number;
  hpAfter: number;
}

// ── 格子事件 & 發薪日表單 ─────────────────────────────────

/** 格子落點後的互動事件（在 PlayerPage 以 activeEvent state 控制顯示）*/
export type ActiveEvent =
  | { kind: 'doodad'; title: string; description: string; cashDeducted: number; expenseIncrease: number }
  | { kind: 'crisis_nt_skip'; title: string; description: string; baseCost: number; network: number; timeoutMs: number }
  | { kind: 'crisis_applied'; title: string; description: string; effectiveCost: number; turnsLost: number; wasInsured: boolean }
  | { kind: 'deal_pick'; cards: { id: string; name: string; description?: string; downPayment: number; monthlyCashflow: number }[]; playerCash: number }
  | { kind: 'charity'; amount: number }
  | { kind: 'tech_startup_offer'; investmentAmount: number; playerCash: number }
  | { kind: 'tech_startup_result'; success: boolean; diceRoll: number; investmentAmount: number; monthlyCashflow?: number }
  | { kind: 'asset_leverage'; bonus: number; passiveIncome: number }
  | { kind: 'disease_crisis'; title: string; description: string; effectiveCost: number; turnsLost: number; hpBefore: number; hpAfter: number; wasInsured: boolean }
  | { kind: 'global_event'; title: string; description: string }
  | { kind: 'marriage_window'; title: string; description: string; monthlyBonus: number; lifeExpGain: number; inPeakWindow: boolean; timeoutMs: number };

/** 發薪日規劃可用選項（後端 buildAffordableOptions 輸出格式）*/
export interface AffordableOption {
  available: boolean;
  cost: number;
}

export interface AffordableOptions {
  fqUpgrade:     AffordableOption;
  healthBoost:   AffordableOption;
  healthMaintenance: AffordableOption;
  skillTraining: AffordableOption;
  networkInvest: AffordableOption;
}

/** paydayPlanningRequired 的完整 payload（前端收到後存入 paydayForm state）*/
export interface PaydayFormData {
  paydayPosition: number;
  currentCash: number;
  currentStats: { financialIQ: number; health: number; careerSkill: number; network: number };
  affordableOptions: AffordableOptions;
  currentInsurance: { hasMedicalInsurance: boolean; hasLifeInsurance: boolean; hasPropertyInsurance: boolean };
  stockDCAPortfolioValue: number;
  timeoutMs: number;
  travelDestinations?: Array<{ id: string; name: string; region: string; cost: number; lifeExpGained: number }>;
}

/** 發薪日規劃表單的送出 payload */
export interface PaydayPlanPayload {
  investInFQUpgrade: boolean;
  investInHealthMaintenance: boolean;
  investInHealthBoost: boolean;
  investInSkillTraining: boolean;
  investInNetwork: boolean;
  stockDCAAmount: number;
  buyInsuranceTypes: Array<'medical' | 'life' | 'property'>;
}

/** 生活體驗選擇 */
export type LifeChoice =
  | { type: 'none' }
  | { type: 'travel'; destinationId: string; destinationName: string }
  | { type: 'social' };
