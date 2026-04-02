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
}

/** 負債 */
export interface Liability {
  id: string;
  name: string;
  totalDebt: number;
  monthlyPayment: number;
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
  /** 升級財商值（費用依當前 FQ 等級而定，見 FQ_UPGRADE_COSTS） */
  investInFQUpgrade: boolean;
  /** 維護健康：阻止本次 HP 自然衰退（費用 $200） */
  investInHealthMaintenance: boolean;
  /** 積極投資健康：+20 HP 並阻止衰退（費用 $500，包含維護） */
  investInHealthBoost: boolean;
  /** 進修培訓：+20 SK（費用 $600） */
  investInSkillTraining: boolean;
  /** 主動拓展人脈：+1 NT（費用 $400） */
  investInNetwork: boolean;
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
  carLoanPayment: 0,
  creditCardPayment: 0,
  otherExpenses: 0,
};

// ============================================================
// 玩家事件日誌（用於遊戲結束後的決策反思分析）
// ============================================================

export type PlayerEventType =
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
  | 'death';

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
  /**
   * 累計發薪日次數。每次 triggerPayday 時遞增。
   * 每 4 次觸發一次年度累進稅結算（4 個發薪日 = 遊戲一圈 = 一年）。
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
   * 是否已進入 FastTrack（外圈）。
   * true 時 totalIncome 套用 FAST_TRACK_INCOME_MULTIPLIER（被動收入加倍）。
   */
  isInFastTrack: boolean;
  /** 外圈當前位置（0–15），進入 FastTrack 後獨立計算。 */
  fastTrackPosition: number;
  /** 已造訪過的旅遊目的地 ID 清單（每個目的地只計一次體驗值）。 */
  visitedDestinations: string[];
  /** 旅遊特殊事件（如南極探險）直接累積的傳承分加分點數。 */
  legacyBonusPoints: number;
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
  /** 進修代價：true 時下一個發薪日自動跳過（少一回合）。 */
  skipFirstPayday: boolean;
  /**
   * 玩家人生事件日誌。
   * 用於遊戲結束後的決策反思分析，記錄每個關鍵決策點的前後財務狀況。
   */
  eventLog: PlayerEvent[];

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
      homeMortgagePayment: profession.startingHomeMortgage,
      carLoanPayment: profession.startingCarLoan,
      creditCardPayment: profession.startingCreditCard,
      otherExpenses: profession.startingOtherExpenses,
    };
    this.assets = [];
    this.liabilities = [];
    this.insurance = { ...DEFAULT_INSURANCE_STATE };
    this.numberOfChildren = 0;
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
    this.isMarried = false;
    this.marriageBonus = 0;
    this.relationshipPoints = 0;
    this.relationshipActive = false;
    this.marriageType = undefined;
    this.isBedridden = false;
    this.travelPenaltyRemaining = 0;
    this.isInFastTrack = false;
    this.fastTrackPosition = 0;
    this.visitedDestinations = [];
    this.legacyBonusPoints = 0;
    this.pre20Done = false;
    this.actionTokensThisPayday = profession.hasFlexibleSchedule ? Infinity : 1;
    this.skipFirstPayday = false;
    this.eventLog = [];
  }

  /** 所有資產的每月現金流總和 */
  get totalPassiveIncome(): number {
    return this.assets.reduce((sum, asset) => sum + asset.monthlyCashflow, 0);
  }

  /** 工資 + 被動收入（被動收入依財商值 FQ 套用乘數）+ 婚姻收入加成
   *
   * FastTrack 玩家的被動收入額外乘以 FAST_TRACK_INCOME_MULTIPLIER（2×），
   * 體現外圈資產倍增速度遠超內圈的設計。
   */
  get totalIncome(): number {
    const fqMultiplier = FQ_MULTIPLIERS[this.stats.financialIQ] ?? 1.0;
    const ftMultiplier = this.isInFastTrack ? FAST_TRACK_INCOME_MULTIPLIER : 1.0;
    return this.salary + Math.round(this.totalPassiveIncome * fqMultiplier * ftMultiplier) + this.marriageBonus;
  }

  /**
   * 所有支出細項加總。
   * 保費依 insurance 持有狀態從 gameConfig 常量自動計算；
   * 孩子費用依 numberOfChildren × PER_CHILD_EXPENSE 自動計算。
   */
  get totalExpenses(): number {
    const e = this.expenses;

    const insurancePremiums =
      (this.insurance.hasMedicalInsurance ? MEDICAL_INSURANCE_PREMIUM : 0) +
      (this.insurance.hasLifeInsurance ? LIFE_INSURANCE_PREMIUM : 0) +
      (this.insurance.hasPropertyInsurance ? PROPERTY_INSURANCE_PREMIUM : 0);

    const childExpenses = this.numberOfChildren * PER_CHILD_EXPENSE;

    return (
      e.taxes +
      e.homeMortgagePayment +
      e.carLoanPayment +
      e.creditCardPayment +
      e.otherExpenses +
      insurancePremiums +
      childExpenses
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
  gameId: string;
  /** 以玩家 ID 為 key 的快速查詢表 */
  players: Map<string, Player>;
  /** 玩家回合順序（存放玩家 ID，按加入順序排列） */
  playerOrder: string[];
  currentPlayerTurnId: string;
  gamePhase: GamePhase;
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
  /** 待回應的 P2P 借貸邀請（key = offerId） */
  pendingLoanOffers?: Record<string, {
    lenderId: string; borrowerId: string; amount: number; monthlyRate: number; createdAt: number;
  }>;
  /** 進行中的競標（key = auctionId） */
  activeAuctions?: Record<string, {
    dealCardId: string; startTime: number; endTime: number;
    highestBid: number; highestBidderId?: string; highestBidderName?: string;
  }>;

  // ── 時鐘驅動年齡系統 ────────────────────────────────────────
  /** 遊戲正式開始時的時間戳（startGame 事件觸發時設定；null = 尚未開始） */
  gameStartTime: Date | null;
  /** 遊戲總時長（毫秒）。預設 90 分鐘 = 5,400,000 ms，主持人可設定 */
  gameDurationMs: number;
  /** 當前暫停開始時間；null 表示未暫停 */
  pausedAt: Date | null;
  /** 所有歷次暫停的累積毫秒數（用於準確計算已過時間） */
  totalPausedMs: number;

  /** 當前發薪日規劃中已確認完成的玩家 ID 集合（全員確認後自動恢復時鐘） */
  paydayPlanningConfirmed: Set<string>;

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
  }

  /**
   * 推進到下一位存活玩家的回合。
   * 跳過 isAlive = false 的玩家。
   */
  advanceToNextTurn(): void {
    if (this.playerOrder.length === 0) return;

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
        }
        return;
      }
    }
  }
}
