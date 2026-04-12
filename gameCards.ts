import { AssetType, LifeStage } from './gameConstants';

// ============================================================
// 棋盤格類型
// ============================================================

export enum SquareType {
  Payday       = 'Payday',
  SmallDeal    = 'SmallDeal',
  BigDeal      = 'BigDeal',
  Doodad       = 'Doodad',
  Market       = 'Market',
  Charity      = 'Charity',
  Downsizing   = 'Downsizing',
  Baby         = 'Baby',
  /** 危機事件格：停在此格須抽 CRISIS_EVENTS 牌組 */
  Crisis       = 'Crisis',
  /** 人際關係事件格：停在此格須抽 RELATIONSHIP_EVENTS 牌組 */
  Relationship = 'Relationship',
}

export interface BoardSquare {
  index: number;
  type: SquareType;
  /** 顯示名稱，供前端 UI 渲染使用 */
  label: string;
}

// ============================================================
// 棋盤 24 格配置
// ============================================================

/**
 * 老鼠賽跑圈的完整棋盤。
 * 發薪日固定在 0、6、12、18 格（與 gameConfig.ts 的 PAYDAY_LOCATIONS 一致）。
 * Crisis 格位於 5、11（改為 Crisis）、17、23 — 共 3 格。
 */
export const BOARD: readonly BoardSquare[] = [
  { index: 0,  type: SquareType.Payday,     label: '發薪日' },
  { index: 1,  type: SquareType.SmallDeal,  label: '小交易' },
  { index: 2,  type: SquareType.Doodad,     label: '意外支出' },
  { index: 3,  type: SquareType.SmallDeal,  label: '小交易' },
  { index: 4,  type: SquareType.BigDeal,    label: '大交易' },
  { index: 5,  type: SquareType.Crisis,     label: '危機事件' },
  { index: 6,  type: SquareType.Payday,     label: '發薪日' },
  { index: 7,  type: SquareType.SmallDeal,  label: '小交易' },
  { index: 8,  type: SquareType.Doodad,     label: '意外支出' },
  { index: 9,  type: SquareType.Baby,       label: '添丁' },
  { index: 10, type: SquareType.Relationship, label: '人際關係' },
  { index: 11, type: SquareType.Charity,    label: '慈善捐款' },
  { index: 12, type: SquareType.Payday,     label: '發薪日' },
  { index: 13, type: SquareType.Doodad,     label: '意外支出' },
  { index: 14, type: SquareType.BigDeal,    label: '大交易' },
  { index: 15, type: SquareType.SmallDeal,  label: '小交易' },
  { index: 16, type: SquareType.Market,     label: '市場行情' },
  { index: 17, type: SquareType.Crisis,     label: '危機事件' },
  { index: 18, type: SquareType.Payday,     label: '發薪日' },
  { index: 19, type: SquareType.SmallDeal,  label: '小交易' },
  { index: 20, type: SquareType.Relationship, label: '人際關係' },
  { index: 21, type: SquareType.BigDeal,    label: '大交易' },
  { index: 22, type: SquareType.Downsizing, label: '裁員' },
  { index: 23, type: SquareType.Crisis,     label: '危機事件' },
];

// ============================================================
// 卡牌介面
// ============================================================

/** 小交易 / 大交易卡（共用介面） */
export interface DealCard {
  id: string;
  title: string;
  description: string;
  dealType: 'SmallDeal' | 'BigDeal';
  asset: {
    name: string;
    assetType: AssetType;
    /** 資產總市場價格 */
    cost: number;
    /** 首付款（有貸款時才有） */
    downPayment?: number;
    /** 每月被動現金流 */
    monthlyCashflow: number;
    /** 對應負債名稱（如「商辦房貸」），有貸款時提供 */
    liabilityName?: string;
    /** 貸款金額 = cost - downPayment */
    liabilityAmount?: number;
  };
}

/** 危機事件卡（保險機制核心，可觸發死亡判定） */
export type CrisisInsuranceType =
  | 'hasMedicalInsurance'
  | 'hasPropertyInsurance'
  | 'hasLifeInsurance';

export interface CrisisCard {
  id: string;
  title: string;
  description: string;
  /** 哪種保險可抵免此事件費用 */
  requiredInsurance: CrisisInsuranceType;
  /** 無保險時需支付的金額 */
  baseCost: number;
  /** 有保險時需支付的金額（通常為 0） */
  insuredCost: number;
  /** 無保險時額外損失的發薪日數（工資停發） */
  turnsLostWithoutInsurance: number;
  /** 有保險時損失的發薪日數（通常為 0） */
  turnsLostWithInsurance: number;
  /**
   * 若為 true：玩家無保險且現金不足以支付 baseCost 時觸發死亡判定。
   */
  canCauseDeath: boolean;
}

/** 意外支出卡（日常生活花費） */
export interface DoodadCard {
  id: string;
  title: string;
  description: string;
  /** OneTime: 一次性扣款；MonthlyIncrease: 每月固定支出增加 */
  expenseType: 'OneTime' | 'MonthlyIncrease';
  cost: number;
}

/** 市場行情卡（影響現有資產市值） */
export interface MarketCard {
  id: string;
  title: string;
  description: string;
  /** 受影響的資產類型 */
  targetAssetType: AssetType;
  effect: 'PriceIncrease' | 'PriceDecrease' | 'SellOpportunity';
  /** 市值倍數（例如 2 表示翻倍，0.5 表示腰斬） */
  priceMultiplier?: number;
  /** 以固定價格出售的機會（SellOpportunity 時使用） */
  fixedPriceOffer?: number;
}

/** 添丁卡（numberOfChildren += 1，由 gameLogic 套用） */
export interface BabyCard {
  id: string;
  title: string;
  description: string;
}

/** 裁員卡（N 個發薪日無工資收入） */
export interface DownsizingCard {
  id: string;
  title: string;
  description: string;
  turnsWithoutSalary: number;
}

/** 慈善捐款卡（自願捐款可獲額外骰子） */
export interface CharityCard {
  id: string;
  title: string;
  description: string;
  /** 捐款佔月薪比例（通常 0.1 = 10%） */
  donationPercentage: number;
  /** 捐款後本回合可使用的額外骰子數 */
  bonusDiceCount: number;
}

// ============================================================
// 泛型 Deck 類別
// ============================================================

/**
 * 泛型牌組類別，支援洗牌、抽牌、棄牌與重置。
 * 使用 Fisher-Yates 演算法確保洗牌結果均勻分佈。
 * 抽牌堆耗盡時自動重洗棄牌堆。
 */
export class Deck<T extends { id: string }> {
  private drawPile: T[];
  private discardPile: T[];

  constructor(cards: T[]) {
    this.discardPile = [];
    this.drawPile = Deck.shuffle([...cards]);
  }

  /** Fisher-Yates 洗牌（純函數，不改動原陣列） */
  private static shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 從抽牌堆頂部抽一張牌。
   * 若抽牌堆已空，自動將棄牌堆重新洗牌後補充。
   * 兩堆皆空時回傳 null。
   */
  draw(): T | null {
    if (this.drawPile.length === 0) {
      if (this.discardPile.length === 0) return null;
      this.drawPile = Deck.shuffle([...this.discardPile]);
      this.discardPile = [];
    }
    return this.drawPile.pop() ?? null;
  }

  /** 將已使用的牌放入棄牌堆 */
  discard(card: T): void {
    this.discardPile.push(card);
  }

  /** 將所有牌（含棄牌堆）重新洗牌並還原到抽牌堆 */
  reset(originalCards: T[]): void {
    this.discardPile = [];
    this.drawPile = Deck.shuffle([...originalCards]);
  }

  /** 目前抽牌堆剩餘張數（供偵錯用） */
  get remaining(): number {
    return this.drawPile.length;
  }
}

// ============================================================
// 實際牌組資料
// ============================================================

/** 小交易牌組（12 張） */
export const SMALL_DEALS: DealCard[] = [
  {
    id: 'sd-001',
    title: '3 房 2 廳出租公寓',
    description: '市區小型公寓，租金穩定，適合首次投資。',
    dealType: 'SmallDeal',
    asset: {
      name: '市區出租公寓',
      assetType: AssetType.RealEstate,
      cost: 1_125_000,
      downPayment: 75_000,
      monthlyCashflow: 3_000,
      liabilityName: '公寓房貸',
      liabilityAmount: 1_050_000,
    },
  },
  {
    id: 'sd-002',
    title: '科技股票（每股 $15）',
    description: '新興科技公司股票，低價入手，等待市場行情。',
    dealType: 'SmallDeal',
    asset: {
      name: '科技公司股票',
      assetType: AssetType.Stock,
      cost: 15_000,
      monthlyCashflow: 0,
    },
  },
  {
    id: 'sd-003',
    title: 'CD 定期存款',
    description: '銀行定存，穩定每月利息收入。',
    dealType: 'SmallDeal',
    asset: {
      name: 'CD 定存',
      assetType: AssetType.Other,
      cost: 75_000,
      monthlyCashflow: 750,
    },
  },
  {
    id: 'sd-004',
    title: '二手停車場投資',
    description: '城市停車場小股份，每月穩定收租。',
    dealType: 'SmallDeal',
    asset: {
      name: '停車場小股份',
      assetType: AssetType.Business,
      cost: 45_000,
      monthlyCashflow: 1_200,
    },
  },
  {
    id: 'sd-005',
    title: '單身套房出租',
    description: '學區附近小套房，租客穩定。',
    dealType: 'SmallDeal',
    asset: {
      name: '學區套房',
      assetType: AssetType.RealEstate,
      cost: 675_000,
      downPayment: 45_000,
      monthlyCashflow: 2_500,
      liabilityName: '套房貸款',
      liabilityAmount: 630_000,
    },
  },
  {
    id: 'sd-006',
    title: '黃金 ETF',
    description: '追蹤黃金價格的指數基金，對抗通膨。',
    dealType: 'SmallDeal',
    asset: {
      name: '黃金 ETF',
      assetType: AssetType.Commodity,
      cost: 30_000,
      monthlyCashflow: 0,
    },
  },
  {
    id: 'sd-007',
    title: '飲料加盟小店（小股）',
    description: '知名手搖飲料品牌加盟店的小額股份。',
    dealType: 'SmallDeal',
    asset: {
      name: '手搖飲料加盟股份',
      assetType: AssetType.Business,
      cost: 120_000,
      monthlyCashflow: 1_800,
    },
  },
  {
    id: 'sd-008',
    title: '農地投資',
    description: '郊區農地，每月收取租用費用。',
    dealType: 'SmallDeal',
    asset: {
      name: '郊區農地',
      assetType: AssetType.RealEstate,
      cost: 225_000,
      monthlyCashflow: 1_500,
    },
  },
  {
    id: 'sd-009',
    title: '能源股票（每股 $75）',
    description: '傳統能源公司股票，股息穩定。',
    dealType: 'SmallDeal',
    asset: {
      name: '能源公司股票',
      assetType: AssetType.Stock,
      cost: 75_000,
      monthlyCashflow: 450,
    },
  },
  {
    id: 'sd-010',
    title: '網路廣告分潤',
    description: '購買小型網站版位，每月廣告分潤。',
    dealType: 'SmallDeal',
    asset: {
      name: '網路廣告版位',
      assetType: AssetType.Business,
      cost: 37_000,
      monthlyCashflow: 900,
    },
  },
  {
    id: 'sd-011',
    title: '太陽能板投資',
    description: '屋頂太陽能板，賣電給電力公司。',
    dealType: 'SmallDeal',
    asset: {
      name: '太陽能板',
      assetType: AssetType.Other,
      cost: 90_000,
      monthlyCashflow: 1_500,
    },
  },
  {
    id: 'sd-012',
    title: '二房公寓（屋齡較老）',
    description: '老公寓低價入手，租金不高但現金流穩定。',
    dealType: 'SmallDeal',
    asset: {
      name: '老社區公寓',
      assetType: AssetType.RealEstate,
      cost: 525_000,
      downPayment: 30_000,
      monthlyCashflow: 1_500,
      liabilityName: '老公寓貸款',
      liabilityAmount: 495_000,
    },
  },
];

/** 大交易牌組（8 張） */
export const BIG_DEALS: DealCard[] = [
  {
    id: 'bd-001',
    title: '市中心商辦大樓（部分樓層）',
    description: '黃金地段商業辦公室，租戶為大型企業，現金流豐厚。',
    dealType: 'BigDeal',
    asset: {
      name: '商辦大樓樓層',
      assetType: AssetType.RealEstate,
      cost: 6_000_000,
      downPayment: 1_125_000,
      monthlyCashflow: 24_000,
      liabilityName: '商辦房貸',
      liabilityAmount: 4_875_000,
    },
  },
  {
    id: 'bd-002',
    title: '洗車連鎖加盟（獨資）',
    description: '繁忙路段洗車站，低人力需求，穩定現金流。',
    dealType: 'BigDeal',
    asset: {
      name: '洗車加盟店',
      assetType: AssetType.Business,
      cost: 2_025_000,
      downPayment: 975_000,
      monthlyCashflow: 18_000,
      liabilityName: '加盟貸款',
      liabilityAmount: 1_050_000,
    },
  },
  {
    id: 'bd-003',
    title: '工業廠房出租',
    description: '郊區工業區廠房，承租方為製造業廠商，長期合約。',
    dealType: 'BigDeal',
    asset: {
      name: '工業廠房',
      assetType: AssetType.RealEstate,
      cost: 7_500_000,
      downPayment: 1_500_000,
      monthlyCashflow: 30_000,
      liabilityName: '廠房貸款',
      liabilityAmount: 6_000_000,
    },
  },
  {
    id: 'bd-004',
    title: '連鎖便利商店（多店）',
    description: '三家便利商店的全部股份，品牌授權已取得。',
    dealType: 'BigDeal',
    asset: {
      name: '連鎖便利商店',
      assetType: AssetType.Business,
      cost: 3_750_000,
      downPayment: 1_200_000,
      monthlyCashflow: 27_000,
      liabilityName: '便利商店貸款',
      liabilityAmount: 2_550_000,
    },
  },
  {
    id: 'bd-005',
    title: '豪華民宿（山區景觀）',
    description: '網路預訂平台高評分民宿，假日滿房率高。',
    dealType: 'BigDeal',
    asset: {
      name: '山區景觀民宿',
      assetType: AssetType.RealEstate,
      cost: 4_500_000,
      downPayment: 1_350_000,
      monthlyCashflow: 33_000,
      liabilityName: '民宿房貸',
      liabilityAmount: 3_150_000,
    },
  },
  {
    id: 'bd-006',
    title: '太陽能電廠（小型）',
    description: '獨立太陽能電廠，與電力公司簽有 20 年購電合約。',
    dealType: 'BigDeal',
    asset: {
      name: '小型太陽能電廠',
      assetType: AssetType.Other,
      cost: 5_250_000,
      downPayment: 1_050_000,
      monthlyCashflow: 22_500,
      liabilityName: '電廠建設貸款',
      liabilityAmount: 4_200_000,
    },
  },
  {
    id: 'bd-007',
    title: '停車場（整棟）',
    description: '市中心多層停車場，月租及時租雙重收入。',
    dealType: 'BigDeal',
    asset: {
      name: '市中心停車場',
      assetType: AssetType.Business,
      cost: 6_750_000,
      downPayment: 1_800_000,
      monthlyCashflow: 37_500,
      liabilityName: '停車場貸款',
      liabilityAmount: 4_950_000,
    },
  },
  {
    id: 'bd-008',
    title: '海景別墅出租',
    description: '海濱豪華別墅，長租客為外派高管，租金極高。',
    dealType: 'BigDeal',
    asset: {
      name: '海景別墅',
      assetType: AssetType.RealEstate,
      cost: 9_000_000,
      downPayment: 2_250_000,
      monthlyCashflow: 45_000,
      liabilityName: '別墅房貸',
      liabilityAmount: 6_750_000,
    },
  },
];

/** 意外支出牌組（12 張） */
export const DOODADS: DoodadCard[] = [
  {
    id: 'dd-001',
    title: '汽車大修',
    description: '引擎出問題，修車廠開出了高額帳單。',
    expenseType: 'OneTime',
    cost: 30_000,
  },
  {
    id: 'dd-002',
    title: '出國旅遊',
    description: '一時衝動訂了歐洲十日遊，花費不菲。',
    expenseType: 'OneTime',
    cost: 52_000,
  },
  {
    id: 'dd-003',
    title: '購置新電視',
    description: '舊電視壞了，換了一台最新款大螢幕 OLED。',
    expenseType: 'OneTime',
    cost: 22_000,
  },
  {
    id: 'dd-004',
    title: '牙齒矯正',
    description: '牙醫建議矯正牙齒，分期付款仍是一筆負擔。',
    expenseType: 'OneTime',
    cost: 60_000,
  },
  {
    id: 'dd-005',
    title: '朋友婚禮包紅包',
    description: '這個月有三場婚禮，紅包錢燒了不少。',
    expenseType: 'OneTime',
    cost: 15_000,
  },
  {
    id: 'dd-006',
    title: '新款手機',
    description: '忍不住入手最新旗艦機，荷包大失血。',
    expenseType: 'OneTime',
    cost: 18_000,
  },
  {
    id: 'dd-007',
    title: '家電維修費',
    description: '洗衣機、冰箱相繼故障，維修費累積。',
    expenseType: 'OneTime',
    cost: 12_000,
  },
  {
    id: 'dd-008',
    title: '訂閱制 APP 增加',
    description: '不知不覺訂閱了太多平台，每月支出悄悄增加。',
    expenseType: 'MonthlyIncrease',
    cost: 1_500,
  },
  {
    id: 'dd-009',
    title: '房屋漏水修繕',
    description: '梅雨季節房屋漏水，請師傅修繕費用不低。',
    expenseType: 'OneTime',
    cost: 38_000,
  },
  {
    id: 'dd-010',
    title: '寵物醫療費',
    description: '家中寵物生病住院，獸醫帳單讓人心疼。',
    expenseType: 'OneTime',
    cost: 27_000,
  },
  {
    id: 'dd-011',
    title: '買了健身房年票',
    description: '充滿幹勁辦了年票，但每月仍需支付費用。',
    expenseType: 'MonthlyIncrease',
    cost: 1_200,
  },
  {
    id: 'dd-012',
    title: '請客吃飯',
    description: '升職慶功宴請同事，一頓飯花了一大筆。',
    expenseType: 'OneTime',
    cost: 9_000,
  },
];

/** 慈善捐款卡（單張，落在慈善格時使用） */
export const CHARITY_CARD: CharityCard = {
  id: 'ch-001',
  title: '慈善募款活動',
  description: '您被邀請參加慈善晚宴。自願捐出本月薪資的 10%，可獲得本回合額外 1 顆骰子。',
  donationPercentage: 0.1,
  bonusDiceCount: 1,
};

/** 市場行情牌組（8 張，涵蓋 4 種資產類型的漲跌與出售機會） */
export const MARKET_CARDS: MarketCard[] = [
  {
    id: 'mk-001',
    title: '科技股大牛市',
    description: '科技板塊全面爆發，持有科技股的投資者笑開懷！所有科技股市值翻倍。',
    targetAssetType: AssetType.Stock,
    effect: 'PriceIncrease',
    priceMultiplier: 2.0,
  },
  {
    id: 'mk-002',
    title: '科技泡沫破滅',
    description: '科技股遭遇嚴重超賣，市場大恐慌。所有科技股市值腰斬。',
    targetAssetType: AssetType.Stock,
    effect: 'PriceDecrease',
    priceMultiplier: 0.5,
  },
  {
    id: 'mk-003',
    title: '房地產景氣大漲',
    description: '市場買氣旺盛，所有房地產資產市值上漲 50%。',
    targetAssetType: AssetType.RealEstate,
    effect: 'PriceIncrease',
    priceMultiplier: 1.5,
  },
  {
    id: 'mk-004',
    title: '房市修正走跌',
    description: '利率上升衝擊房市，所有房地產資產市值下跌 30%。',
    targetAssetType: AssetType.RealEstate,
    effect: 'PriceDecrease',
    priceMultiplier: 0.7,
  },
  {
    id: 'mk-005',
    title: '創業潮帶動事業增值',
    description: '市場創業熱潮，事業類資產估值全面上漲 30%。',
    targetAssetType: AssetType.Business,
    effect: 'PriceIncrease',
    priceMultiplier: 1.3,
  },
  {
    id: 'mk-006',
    title: '消費市場萎縮',
    description: '景氣下滑，消費力減弱，事業類資產市值下降 20%。',
    targetAssetType: AssetType.Business,
    effect: 'PriceDecrease',
    priceMultiplier: 0.8,
  },
  {
    id: 'mk-007',
    title: '大宗商品牛市',
    description: '國際供應鏈緊張，大宗商品（黃金、石油等）市值翻倍！',
    targetAssetType: AssetType.Commodity,
    effect: 'PriceIncrease',
    priceMultiplier: 2.0,
  },
  {
    id: 'mk-008',
    title: '法拍屋出售機會',
    description: '銀行拍賣一棟優質房產，以固定價格 $1,800,000 出售。有房地產資產的玩家可選擇出售持有物件。',
    targetAssetType: AssetType.RealEstate,
    effect: 'SellOpportunity',
    fixedPriceOffer: 1_800_000,
  },
];

/** 危機事件牌組（8 張，含醫療 / 財產 / 極端事故三類） */
export const CRISIS_EVENTS: CrisisCard[] = [
  // --- 醫療類（需醫療險）---
  {
    id: 'cr-001',
    title: '心臟病突發',
    description: '突發心臟病緊急送醫，手術與住院費用高達 $750,000。無醫療險者現金不足時將觸發死亡判定。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 750_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 2,
    turnsLostWithInsurance: 0,
    canCauseDeath: true,
  },
  {
    id: 'cr-002',
    title: '重大疾病確診',
    description: '確診需要長期治療的重大疾病，醫療費用 $375,000 且需休養。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 375_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 1,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  {
    id: 'cr-003',
    title: '緊急手術住院',
    description: '意外受傷需緊急手術，手術加住院費 $225,000。有醫療險僅需支付掛號費。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 225_000,
    insuredCost: 7_500,
    turnsLostWithoutInsurance: 1,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  // --- 財產 / 企業類（需財產險）---
  {
    id: 'cr-004',
    title: '住宅大火',
    description: '家中發生火災，損失慘重。無財產險需自行賠付 $450,000 修繕費用。',
    requiredInsurance: 'hasPropertyInsurance',
    baseCost: 450_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 0,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  {
    id: 'cr-005',
    title: '企業訴訟',
    description: '生意上的糾紛引發法律訴訟，律師費與賠償金共 $300,000。有財產/企業險可全額理賠。',
    requiredInsurance: 'hasPropertyInsurance',
    baseCost: 300_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 0,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  {
    id: 'cr-006',
    title: '天然災害損失',
    description: '地震造成房屋結構損壞，修繕費用 $600,000。有財產險全額理賠。',
    requiredInsurance: 'hasPropertyInsurance',
    baseCost: 600_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 0,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  // --- 壽險 / 極端事故類（需壽險，可觸發死亡）---
  {
    id: 'cr-007',
    title: '嚴重交通意外',
    description: '發生嚴重車禍，後續醫療與訴訟費用極高。無壽險且現金嚴重不足時將觸發死亡判定。',
    requiredInsurance: 'hasLifeInsurance',
    baseCost: 900_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 3,
    turnsLostWithInsurance: 0,
    canCauseDeath: true,
  },
  {
    id: 'cr-008',
    title: '罕見疾病長期治療',
    description: '確診罕見疾病，需長期高額治療費用 $675,000。有壽險保障家人。',
    requiredInsurance: 'hasLifeInsurance',
    baseCost: 675_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 2,
    turnsLostWithInsurance: 0,
    canCauseDeath: true,
  },
];

// ============================================================
// 棋盤工具函數
// ============================================================

/**
 * 外圈「疾病危機」格專用危機牌（僅需醫療險，費用較內圈高）。
 * 2 張 canCauseDeath: true，適合外圈高風險情境。
 */
export const DISEASE_CRISIS_EVENTS: CrisisCard[] = [
  {
    id: 'dc-001',
    title: '急性心肌梗塞',
    description: '突發心肌梗塞緊急送加護病房，手術及後續復健費用高達 $3,000,000。無醫療險且現金不足者將觸發死亡判定。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 3_000_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 3,
    turnsLostWithInsurance: 0,
    canCauseDeath: true,
  },
  {
    id: 'dc-002',
    title: '重大器官手術',
    description: '需要重大器官手術，醫療費用 $1,800,000，術後需長期休養。無醫療險且現金不足者將觸發死亡判定。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 1_800_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 2,
    turnsLostWithInsurance: 0,
    canCauseDeath: true,
  },
  {
    id: 'dc-003',
    title: '慢性病住院',
    description: '慢性病急性發作需住院治療，醫療費用 $900,000，需休養一個發薪週期。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 900_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 1,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
  {
    id: 'dc-004',
    title: '輕症就醫',
    description: '輕微病症就醫，門診與用藥費用 $300,000，不影響工作。',
    requiredInsurance: 'hasMedicalInsurance',
    baseCost: 300_000,
    insuredCost: 0,
    turnsLostWithoutInsurance: 0,
    turnsLostWithInsurance: 0,
    canCauseDeath: false,
  },
];

/**
 * 查詢棋盤上特定位置的格子類型。
 * @param position 玩家當前位置（0-23）
 */
// ============================================================
// 外圈棋盤（FastTrack，16 格）
// ============================================================

export enum FastTrackSquareType {
  PaydayBonus      = 'PaydayBonus',      // 發薪+紅利
  BigRealEstate    = 'BigRealEstate',    // 大型房地產
  BusinessDeal     = 'BusinessDeal',     // 事業擴張
  StockOpportunity = 'StockOpportunity', // 股市大機會
  Charity          = 'Charity',          // 慈善格
  NetworkSummit    = 'NetworkSummit',    // 人脈峰會
  TaxPlanning      = 'TaxPlanning',      // 稅務規劃
  TechStartup      = 'TechStartup',      // 科技新創
  GlobalWave       = 'GlobalWave',       // 時代浪潮（全員事件）
  Partnership      = 'Partnership',      // 合夥機會
  Crisis           = 'Crisis',           // 危機考驗
  LifeJourney      = 'LifeJourney',      // 生命歷練（旅遊格）
  Relationship     = 'Relationship',     // 人際格
  AssetLeverage    = 'AssetLeverage',    // 資產槓桿
  DiseaseCrisis    = 'DiseaseCrisis',    // 疾病危機
}

export interface FastTrackSquare {
  index: number;
  type: FastTrackSquareType;
  label: string;
}

/**
 * FastTrack 外圈棋盤（17 格）。
 * 玩家脫出老鼠賽跑後切換到此棋盤循環行走。
 */
export const FAST_TRACK_BOARD: readonly FastTrackSquare[] = [
  { index: 0,  type: FastTrackSquareType.PaydayBonus,       label: '發薪+紅利'  },
  { index: 1,  type: FastTrackSquareType.BigRealEstate,     label: '大型房地產' },
  { index: 2,  type: FastTrackSquareType.StockOpportunity,  label: '股市大機會' },
  { index: 3,  type: FastTrackSquareType.NetworkSummit,     label: '人脈峰會'  },
  { index: 4,  type: FastTrackSquareType.Charity,           label: '慈善格'    },
  { index: 5,  type: FastTrackSquareType.BusinessDeal,      label: '事業擴張'  },
  { index: 6,  type: FastTrackSquareType.PaydayBonus,       label: '發薪+紅利'  },
  { index: 7,  type: FastTrackSquareType.TaxPlanning,       label: '稅務規劃'  },
  { index: 8,  type: FastTrackSquareType.TechStartup,       label: '科技新創'  },
  { index: 9,  type: FastTrackSquareType.GlobalWave,        label: '時代浪潮'  },
  { index: 10, type: FastTrackSquareType.Partnership,       label: '合夥機會'  },
  { index: 11, type: FastTrackSquareType.Crisis,            label: '危機考驗'  },
  { index: 12, type: FastTrackSquareType.PaydayBonus,       label: '發薪+紅利'  },
  { index: 13, type: FastTrackSquareType.LifeJourney,       label: '生命歷練'  },
  { index: 14, type: FastTrackSquareType.Relationship,      label: '人際關係'  },
  { index: 15, type: FastTrackSquareType.AssetLeverage,     label: '資產槓桿'  },
  { index: 16, type: FastTrackSquareType.DiseaseCrisis,     label: '疾病危機'  },
];

/** 外圈發薪格索引 */
export const FAST_TRACK_PAYDAY_LOCATIONS = [0, 6, 12];

export function getFastTrackSquareType(position: number): FastTrackSquareType {
  const square = FAST_TRACK_BOARD[position % FAST_TRACK_BOARD.length];
  return square?.type ?? FastTrackSquareType.PaydayBonus;
}

export function getSquareType(position: number): SquareType {
  const square = BOARD[position % BOARD.length];
  return square.type;
}

/**
 * 根據格子類型回傳應使用的牌組名稱。
 * 回傳 null 表示此格不需要抽牌（如 Payday、Baby 等由特定邏輯處理）。
 */
export function getDeckForSquare(
  squareType: SquareType
): 'small' | 'big' | 'doodad' | 'crisis' | 'market' | null {
  switch (squareType) {
    case SquareType.SmallDeal:  return 'small';
    case SquareType.BigDeal:    return 'big';
    case SquareType.Doodad:     return 'doodad';
    case SquareType.Crisis:     return 'crisis';
    case SquareType.Market:     return 'market';
    default:                    return null;
  }
}

// ============================================================
// 婚姻卡
// ============================================================

/** 婚姻事件卡（由 handleLandingSquare 依年齡機率觸發，非棋盤格抽牌） */
export interface MarriageCard {
  id: string;
  title: string;
  description: string;
  /** 結婚後每月帶來的收入加成（$）*/
  monthlyBonus: number;
  /** 觸發此婚姻卡的生命體驗值加分 */
  lifeExpGain: number;
}

export const MARRIAGE_CARDS: MarriageCard[] = [
  {
    id: 'marry-001',
    title: '幸福結婚',
    description: '你們攜手步入禮堂！雙薪家庭，每月多了 $12,000 的生活收入加成。',
    monthlyBonus: 12_000,
    lifeExpGain: 15,
  },
  {
    id: 'marry-002',
    title: '閃婚',
    description: '認識不久便決定在一起，衝動也是一種勇氣！每月收入加成 $7,500，但初期有些磨合。',
    monthlyBonus: 7_500,
    lifeExpGain: 12,
  },
  {
    id: 'marry-003',
    title: '老來得配',
    description: '緣分在 50 歲後到來，相識恨晚！每月收入加成 $9,000，且健康值互相支持 +10。',
    monthlyBonus: 9_000,
    lifeExpGain: 18,
  },
];

// ============================================================
// 人際關係事件卡
// ============================================================

/**
 * 人際關係事件卡介面。
 * 停在 Relationship 格時從 RELATIONSHIP_EVENTS 池中隨機抽取。
 */
export interface RelationshipCard {
  id: string;
  title: string;
  description: string;
  /** 事件分類：positive=正面、negative=負面、opportunity=機遇型（需玩家決策）*/
  eventCategory: 'positive' | 'negative' | 'opportunity';
  effect: {
    /** NT 人脈值變化（正負均可）*/
    networkDelta?: number;
    /** 生命體驗值增加 */
    lifeExpGain?: number;
    /** 立即現金損失（正數代表扣錢）*/
    cashCost?: number;
    /** 永久月現金流變化（正數加、負數減）*/
    monthlyCashflowDelta?: number;
    /**
     * 薪資乘數（暫時，持續 turnsAffected 個發薪日）。
     * 例如 0.9 代表薪資降為 90%。
     */
    salaryMultiplier?: number;
    /** salaryMultiplier 持續的發薪日回合數 */
    turnsAffected?: number;
    /** 是否觸發婚姻視窗（玩家可選擇是否接受相親）*/
    triggerMarriageWindow?: boolean;
    /** 是否觸發額外 SmallDeal 抽牌 */
    triggerSmallDeal?: boolean;
    /**
     * 擲骰賭注型效果。
     * 玩家擲骰 ≥ threshold 視為成功。
     */
    gambleSuccess?: {
      threshold: number;
      /** 成功時增加的月被動收入（$）*/
      successCashflow: number;
      /** 失敗時扣除的現金（$）*/
      failureCashLoss: number;
    };
  };
}

export const RELATIONSHIP_EVENTS: RelationshipCard[] = [
  // ── 正面事件（4 張）──
  {
    id: 'rel-001',
    title: '貴人相助',
    description: '人生中遇到一位重要導師，給予你無價的指引與建議。NT +1，體驗值 +15。',
    eventCategory: 'positive',
    effect: { networkDelta: 1, lifeExpGain: 15 },
  },
  {
    id: 'rel-002',
    title: '同學會重聚',
    description: '久違的老同學帶來一個投資情報，讓你搶先一步。NT +1，可加抽一張小交易牌。',
    eventCategory: 'positive',
    effect: { networkDelta: 1, lifeExpGain: 8, triggerSmallDeal: true },
  },
  {
    id: 'rel-003',
    title: '社群影響力爆發',
    description: '你的個人品牌在社群網路上意外爆紅，人脈急速擴張。NT +2，體驗值 +20。',
    eventCategory: 'positive',
    effect: { networkDelta: 2, lifeExpGain: 20 },
  },
  {
    id: 'rel-004',
    title: '朋友創業邀請',
    description: '好友邀你共同創業，需先投入 $150,000 作為啟動資金。擲骰 ≥ 4 成功：月被動收入 +$12,000；失敗：現金 -$150,000。',
    eventCategory: 'opportunity',
    effect: {
      gambleSuccess: {
        threshold: 4,
        successCashflow: 12_000,
        failureCashLoss: 150_000,
      },
    },
  },
  // ── 負面事件（4 張）──
  {
    id: 'rel-005',
    title: '友情破裂',
    description: '與多年摯友發生嚴重衝突，關係決裂。NT -1，但這段教訓讓你成長：體驗值 +5。',
    eventCategory: 'negative',
    effect: { networkDelta: -1, lifeExpGain: 5 },
  },
  {
    id: 'rel-006',
    title: '借錢給朋友血本無歸',
    description: '朋友向你借錢後失聯，這筆錢再也回不來了。現金 -$75,000。',
    eventCategory: 'negative',
    effect: { cashCost: 75_000 },
  },
  {
    id: 'rel-007',
    title: '職場霸凌',
    description: '主管無故打壓，工作壓力爆表，嚴重影響你的工作表現。薪資 -10%，持續 2 個發薪日。',
    eventCategory: 'negative',
    effect: { salaryMultiplier: 0.9, turnsAffected: 2 },
  },
  {
    id: 'rel-008',
    title: '詐騙受害',
    description: '熟識的人以投資名義詐騙你，錢財兩失，人脈信任也大受打擊。現金 -$120,000，NT -1。',
    eventCategory: 'negative',
    effect: { cashCost: 120_000, networkDelta: -1 },
  },
  // ── 機遇型事件（4 張）──
  {
    id: 'rel-009',
    title: '相親機會',
    description: '長輩熱心安排相親，緣分說不定就在轉角。若你尚未結婚且 HP ≥ 30，可選擇開啟婚姻視窗。',
    eventCategory: 'opportunity',
    effect: { triggerMarriageWindow: true, lifeExpGain: 5 },
  },
  {
    id: 'rel-010',
    title: '職場升遷機會',
    description: '因人脈介紹獲得一份薪水更高的跳槽邀約。可選擇接受：薪資 +20%（下一個發薪日生效），體驗值 +10。',
    eventCategory: 'opportunity',
    effect: { salaryMultiplier: 1.2, turnsAffected: 1, lifeExpGain: 10 },
  },
  {
    id: 'rel-011',
    title: '慈善募款受邀',
    description: '你被邀請主辦社區慈善活動，付出金錢卻贏得口碑與人脈。現金 -$30,000，NT +2，體驗值 +10。',
    eventCategory: 'opportunity',
    effect: { cashCost: 30_000, networkDelta: 2, lifeExpGain: 10 },
  },
  {
    id: 'rel-012',
    title: '家族糾紛調解',
    description: '家族財產糾紛需要你出面協調，費時費力但維繫了家族關係。現金 -$45,000，子女月支出 -$3,000（家庭關係改善）。',
    eventCategory: 'opportunity',
    effect: { cashCost: 45_000, monthlyCashflowDelta: 3_000 },
  },
];

// ============================================================
// 依人生階段分層的危機卡池
// ============================================================

/**
 * 各人生階段對應的危機卡 ID 池。
 * handleLandingSquare 在抽危機卡時，從對應階段的 ID 池中過濾 CRISIS_EVENTS，
 * 使年輕時遇輕症、年老時遇重症，反映真實人生風險曲線。
 */
export const CRISIS_POOL_BY_STAGE: Readonly<Record<LifeStage, string[]>> = {
  // 打拼期（20–34）：輕微意外 + 財產損失，不含死亡判定
  [LifeStage.Youth]: [
    'cr-001', // 輕微車禍（醫療險）
    'cr-004', // 機器設備故障（財產險）
    'cr-005', // 商業訴訟（財產險）
    'cr-006', // 天然災害損失（財產險）
  ],
  // 成家期（35–49）：增加中等疾病，仍無致死事件
  [LifeStage.Family]: [
    'cr-001',
    'cr-002', // 住院手術（醫療險）
    'cr-004',
    'cr-005',
    'cr-006',
  ],
  // 轉型期（50–64）：重症加入，首次出現死亡判定
  [LifeStage.Transition]: [
    'cr-002',
    'cr-003', // 重大疾病長期療養（醫療險，可死亡）
    'cr-005',
    'cr-006',
    'cr-007', // 嚴重交通意外（壽險，可死亡）
  ],
  // 退休期（65–79）：重症為主，輕症移除
  [LifeStage.Retirement]: [
    'cr-003',
    'cr-006',
    'cr-007',
    'cr-008', // 罕見疾病（壽險，可死亡）
  ],
  // 傳承期（80–100）：全為高危事件
  [LifeStage.Legacy]: [
    'cr-003',
    'cr-007',
    'cr-008',
  ],
};
