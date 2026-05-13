// ============================================================
// gameConstants.ts
// 基礎常數與 Enum — 不依賴任何其他遊戲模組，供 gameDataModels 與 gameConfig 共同使用。
// ============================================================

// ---- Enums ----

export enum AssetType {
  RealEstate = 'RealEstate',
  Stock = 'Stock',
  Business = 'Business',
  Commodity = 'Commodity',
  Other = 'Other',
}

export enum GamePhase {
  WaitingForPlayers = 'WaitingForPlayers',
  Pre20 = 'Pre20',
  RatRace = 'RatRace',
  FastTrack = 'FastTrack',
  EventProcessing = 'EventProcessing',
  GameOver = 'GameOver',
}

export enum SocialClass {
  Rich         = 'Rich',
  Middle       = 'Middle',
  WorkingClass = 'WorkingClass',
  Poor         = 'Poor',
}

export enum LifeStage {
  Youth      = 'Youth',
  Family     = 'Family',
  Transition = 'Transition',
  Retirement = 'Retirement',
  Legacy     = 'Legacy',
}

export enum MarketEventType {
  PositiveMarket   = 'PositiveMarket',
  NegativeMarket   = 'NegativeMarket',
  RealEstateDown   = 'RealEstateDown',
  StockMarketCrash = 'StockMarketCrash',
}

// ---- 保險保費常量（月繳） ----

export const MEDICAL_INSURANCE_PREMIUM = 3_000;
export const LIFE_INSURANCE_PREMIUM = 1_500;
export const PROPERTY_INSURANCE_PREMIUM = 4_500;

// ---- 孩子費用常量 ----

export const PER_CHILD_EXPENSE = 7_500;

// ---- FQ 乘數 ----
// 設計理念：早期投入財商有正回饋（FQ 4–5 即見效），高財商者享有顯著加成，
// 讓「持續升 FQ」成為值得投資的策略，而非 FQ 1-3 完全沒差別。
// 同時搭配「股市內幕」（FQ ≥ 7 可預知下一張 MarketCard）作為高 FQ 質性獎勵。

export const FQ_MULTIPLIERS: readonly number[] = [
  1.00, // 索引 0（unused）
  1.00, // FQ 1
  1.02, // FQ 2  ── 微幅加成
  1.05, // FQ 3
  1.10, // FQ 4
  1.15, // FQ 5
  1.22, // FQ 6
  1.30, // FQ 7  ── 解鎖「股市內幕」
  1.40, // FQ 8
  1.50, // FQ 9
  1.65, // FQ 10 ── 投資大師
];

/** 股市內幕門檻：FQ ≥ 此值可在發薪日規劃時提前看到下一張 MarketCard 預告 */
export const FQ_INSIDER_THRESHOLD = 7;

// ---- FastTrack 乘數 ----

export const FAST_TRACK_INCOME_MULTIPLIER = 2.0;

