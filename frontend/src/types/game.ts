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
  isMarried: boolean;
  marriageBonus: number;
  relationshipPoints: number;
  relationshipActive: boolean;
  marriageType?: string;
  isBedridden: boolean;
  travelPenaltyRemaining: number;
  isInFastTrack: boolean;
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
  netWorth: number;
  passiveIncome: number;
  financialHealth: number;
  family: number;
  lifeExperience: number;
  hp: number;
  legacyScore: number;
  total: number;
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
