// ============================================================
// boardConfig.ts — 棋盤格子資料層
// innerCircleConfig: 老鼠賽跑內圈 24 格
// outerCircleConfig: FastTrack 外圈 16 格
// ============================================================

export interface SquareConfig {
  /** 唯一識別碼，例如 "inner-0"、"outer-3" */
  id: string;
  /** 格子類型，供 CSS class 與邏輯判斷使用 */
  type: string;
  /** 格子中文名稱 */
  name: string;
  /** 代表 Emoji */
  icon: string;
  /** 格子主背景色 */
  color: string;
  /** 格子邊框色 */
  borderColor: string;
  /**
   * 絕對定位座標（僅外圈使用），以百分比表示相對 board-wrapper 的位置。
   * [left%, top%]
   */
  pos?: [number, number];
}

// ── 內圈色彩常數 ─────────────────────────────────────────────
const C = {
  payday:       { color: '#064e3b', borderColor: '#10b981' },
  smallDeal:    { color: '#1e3a5f', borderColor: '#3b82f6' },
  bigDeal:      { color: '#1e1b4b', borderColor: '#818cf8' },
  doodad:       { color: '#7c2d12', borderColor: '#f97316' },
  crisis:       { color: '#450a0a', borderColor: '#ef4444' },
  market:       { color: '#78350f', borderColor: '#f59e0b' },
  charity:      { color: '#4a1d96', borderColor: '#a855f7' },
  baby:         { color: '#831843', borderColor: '#ec4899' },
  relationship: { color: '#1e1b4b', borderColor: '#818cf8' },
  downsizing:   { color: '#1c1917', borderColor: '#78716c' },
} as const;

// ── 外圈色彩常數（金色系） ───────────────────────────────────
const G = {
  paydays:   { color: '#78350f', borderColor: '#fbbf24' },
  realestate:{ color: '#92400e', borderColor: '#f59e0b' },
  stock:     { color: '#78350f', borderColor: '#fde68a' },
  network:   { color: '#7c2d12', borderColor: '#fb923c' },
  charity:   { color: '#881337', borderColor: '#fb7185' },
  business:  { color: '#7c2d12', borderColor: '#f97316' },
  tax:       { color: '#44403c', borderColor: '#a8a29e' },
  legacy:    { color: '#78350f', borderColor: '#d97706' },
  wave:      { color: '#1e3a5f', borderColor: '#38bdf8' },
  partner:   { color: '#064e3b', borderColor: '#34d399' },
  crisis:    { color: '#450a0a', borderColor: '#ef4444' },
  travel:    { color: '#2e1065', borderColor: '#a78bfa' },
  relation:  { color: '#831843', borderColor: '#f472b6' },
  inherit:   { color: '#78350f', borderColor: '#fbbf24' },
} as const;

// ============================================================
// 內圈 24 格（順時針，格 0 = 起點/左上角）
// 7×7 Grid 周圍佈局：
//   上排 col 0-6 (row 0)：格 0-6
//   右排 row 1-6 (col 6)：格 7-12
//   下排 col 5-0 (row 6)：格 13-18
//   左排 row 5-1 (col 0)：格 19-23
// ============================================================
export const innerCircleConfig: SquareConfig[] = [
  // ── 內圈 24 格（圓形極座標，半徑 37%，起始頂部，順時針每格 15°）
  // x = 50 + 37*sin(angle),  y = 50 - 37*cos(angle)
  { id: 'inner-0',  type: 'payday',       name: '發薪日',   icon: '💰', ...C.payday,       pos: [50, 13] },
  { id: 'inner-1',  type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal,    pos: [60, 14] },
  { id: 'inner-2',  type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad,       pos: [69, 18] },
  { id: 'inner-3',  type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal,    pos: [76, 24] },
  { id: 'inner-4',  type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal,      pos: [82, 31] },
  { id: 'inner-5',  type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis,       pos: [86, 40] },
  { id: 'inner-6',  type: 'payday',       name: '發薪日',   icon: '💰', ...C.payday,       pos: [87, 50] },
  { id: 'inner-7',  type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal,    pos: [86, 60] },
  { id: 'inner-8',  type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad,       pos: [82, 69] },
  { id: 'inner-9',  type: 'baby',         name: '添丁',     icon: '👶', ...C.baby,         pos: [76, 76] },
  { id: 'inner-10', type: 'relationship', name: '人際關係', icon: '🤝', ...C.relationship, pos: [69, 82] },
  { id: 'inner-11', type: 'charity',      name: '慈善捐款', icon: '❤️', ...C.charity,      pos: [60, 86] },
  { id: 'inner-12', type: 'payday',       name: '發薪日',   icon: '💰', ...C.payday,       pos: [50, 87] },
  { id: 'inner-13', type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad,       pos: [40, 86] },
  { id: 'inner-14', type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal,      pos: [31, 82] },
  { id: 'inner-15', type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal,    pos: [24, 76] },
  { id: 'inner-16', type: 'market',       name: '市場行情', icon: '📈', ...C.market,       pos: [18, 69] },
  { id: 'inner-17', type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis,       pos: [14, 60] },
  { id: 'inner-18', type: 'payday',       name: '發薪日',   icon: '💰', ...C.payday,       pos: [13, 50] },
  { id: 'inner-19', type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal,    pos: [14, 40] },
  { id: 'inner-20', type: 'relationship', name: '人際關係', icon: '🤝', ...C.relationship, pos: [18, 31] },
  { id: 'inner-21', type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal,      pos: [24, 24] },
  { id: 'inner-22', type: 'downsizing',   name: '裁員',     icon: '📉', ...C.downsizing,   pos: [31, 18] },
  { id: 'inner-23', type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis,       pos: [40, 14] },
];

// ============================================================
// 外圈 16 格（FastTrack，順時針，格 0 = 左上角起點）
//
// 絕對定位佈局（相對 board-wrapper padding box）：
//   上排 6 格（格 0-5）：均勻分佈於頂部，y ≈ 0%
//   右側 2 格（格 6-7）：右側中間，x ≈ 100%
//   下排 6 格（格 8-13）：均勻分佈於底部，y ≈ 100%
//   左側 2 格（格 14-15）：左側中間，x ≈ 0%
//
// pos: [left%, top%]，格子自身 translate(-50%,-50%) 居中對齊錨點
// ============================================================
export const outerCircleConfig: SquareConfig[] = [
  // ── 外圈 16 格（圓形極座標，半徑 45%，起始頂部，順時針每格 22.5°）
  // x = 50 + 45*sin(angle),  y = 50 - 45*cos(angle)
  { id: 'outer-0',  type: 'ftPayday',     name: '發薪+紅利', icon: '💎', ...G.paydays,   pos: [50,  5]  },
  { id: 'outer-1',  type: 'ftRealEstate', name: '大型房地產', icon: '🏰', ...G.realestate,pos: [67,  8]  },
  { id: 'outer-2',  type: 'ftStock',      name: '股市大機會', icon: '📊', ...G.stock,    pos: [82, 18]  },
  { id: 'outer-3',  type: 'ftNetwork',    name: '人脈峰會',   icon: '🌐', ...G.network,  pos: [92, 33]  },
  { id: 'outer-4',  type: 'ftCharity',    name: '慈善格',     icon: '❤️', ...G.charity,  pos: [95, 50]  },
  { id: 'outer-5',  type: 'ftBusiness',   name: '事業投資',   icon: '🤝', ...G.business, pos: [92, 67]  },
  { id: 'outer-6',  type: 'ftPayday',     name: '發薪+紅利', icon: '💎', ...G.paydays,   pos: [82, 82]  },
  { id: 'outer-7',  type: 'ftTax',        name: '稅務規劃',   icon: '📑', ...G.tax,      pos: [67, 92]  },
  { id: 'outer-8',  type: 'ftLegacy',     name: '遺產佈局',   icon: '🏛️', ...G.legacy,  pos: [50, 95]  },
  { id: 'outer-9',  type: 'ftWave',       name: '時代浪潮',   icon: '🌊', ...G.wave,     pos: [33, 92]  },
  { id: 'outer-10', type: 'ftPartner',    name: '合夥機會',   icon: '🤲', ...G.partner,  pos: [18, 82]  },
  { id: 'outer-11', type: 'ftCrisis',     name: '危機考驗',   icon: '⚡', ...G.crisis,   pos: [ 8, 67]  },
  { id: 'outer-12', type: 'ftPayday',     name: '發薪+紅利', icon: '💎', ...G.paydays,   pos: [ 5, 50]  },
  { id: 'outer-13', type: 'ftTravel',     name: '生命歷練',   icon: '✈️', ...G.travel,  pos: [ 8, 33]  },
  { id: 'outer-14', type: 'ftRelation',   name: '人際關係',   icon: '💫', ...G.relation, pos: [18, 18]  },
  { id: 'outer-15', type: 'ftInherit',    name: '傳承決策',   icon: '👑', ...G.inherit,  pos: [33,  8]  },
];
