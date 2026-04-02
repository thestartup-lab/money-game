import { AssetType } from './gameDataModels';

// ============================================================
// 全局事件效果介面
// ============================================================

/**
 * 全局事件的效果類型：
 * - AssetValueChange: 特定資產類型的市場估值乘以倍數
 * - CashflowChange:   特定資產類型的每月現金流乘以倍數
 * - ExpenseChange:    所有玩家的 otherExpenses 增加固定金額
 */
export type GlobalEventEffectType =
  | 'AssetValueChange'
  | 'CashflowChange'
  | 'ExpenseChange';

export interface GlobalEventEffect {
  type: GlobalEventEffectType;
  /** AssetValueChange / CashflowChange 時必填：指定受影響的資產類型 */
  targetAssetType?: AssetType;
  /** 乘數倍數（AssetValueChange / CashflowChange 用）。0.5 = 腰斬，2 = 翻倍 */
  multiplier?: number;
  /** 固定增減金額（ExpenseChange 用）。正值增加支出，負值減少支出 */
  flatAmount?: number;
}

export interface AdminGlobalEvent {
  id: string;
  title: string;
  description: string;
  /** 一個事件可同時產生多種效果（例如股災同時影響市值與現金流） */
  effects: GlobalEventEffect[];
}

// ============================================================
// 預設全局事件清單（8 個）
// ============================================================

export const ADMIN_GLOBAL_EVENTS: AdminGlobalEvent[] = [
  {
    id: 'stock_crash',
    title: '股市大崩盤',
    description: '全球股市恐慌性拋售，股票資產市值腰斬，每月股息也大幅縮水。',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.Stock, multiplier: 0.5 },
      { type: 'CashflowChange',   targetAssetType: AssetType.Stock, multiplier: 0.7 },
    ],
  },
  {
    id: 'stock_boom',
    title: '股市大漲',
    description: '科技革命帶動牛市行情，持有股票的投資者資產翻倍！',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.Stock, multiplier: 2 },
    ],
  },
  {
    id: 'realestate_crash',
    title: '房市崩盤',
    description: '利率暴漲引發房市泡沫破裂，房產估值大跌，租金收入也受到影響。',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.RealEstate, multiplier: 0.6 },
      { type: 'CashflowChange',   targetAssetType: AssetType.RealEstate, multiplier: 0.8 },
    ],
  },
  {
    id: 'realestate_boom',
    title: '房市大漲',
    description: '都市化浪潮與低利率雙重驅動，房地產估值飆升 80%！',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.RealEstate, multiplier: 1.8 },
    ],
  },
  {
    id: 'inflation',
    title: '通貨膨脹',
    description: '物價全面上漲，每位玩家每月生活支出增加 $300。',
    effects: [
      { type: 'ExpenseChange', flatAmount: 300 },
    ],
  },
  {
    id: 'business_collapse',
    title: '企業倒閉潮',
    description: '經濟衰退引發連鎖倒閉，商業資產市值與現金流雙雙腰斬。',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.Business, multiplier: 0.5 },
      { type: 'CashflowChange',   targetAssetType: AssetType.Business, multiplier: 0.5 },
    ],
  },
  {
    id: 'natural_disaster',
    title: '大型自然災害',
    description: '強震重創城市，房產估值大跌，重建費用也讓所有人每月多支出 $500。',
    effects: [
      { type: 'AssetValueChange', targetAssetType: AssetType.RealEstate, multiplier: 0.7 },
      { type: 'ExpenseChange', flatAmount: 500 },
    ],
  },
  {
    id: 'pandemic',
    title: '全球疫情爆發',
    description: '封城措施重創實體商業，企業現金流大幅萎縮，全民醫療支出也大增。',
    effects: [
      { type: 'CashflowChange', targetAssetType: AssetType.Business, multiplier: 0.4 },
      { type: 'ExpenseChange', flatAmount: 400 },
    ],
  },
];

/**
 * 以事件 ID 快速查詢預設全局事件。
 * 找不到時回傳 undefined。
 */
export const ADMIN_GLOBAL_EVENT_MAP: ReadonlyMap<string, AdminGlobalEvent> = new Map(
  ADMIN_GLOBAL_EVENTS.map((e) => [e.id, e])
);
