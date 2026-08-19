// ============================================================
// boardConfig.ts — 棋盤格子資料層
// innerCircleConfig: 老鼠賽跑內圈 24 格
// outerCircleConfig: FastTrack 外圈 17 格
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
  /** 格子說明文字（可選），顯示於玩家手機格子卡片下方 */
  description?: string;
  /**
   * 絕對定位座標（僅外圈使用），以百分比表示相對 board-wrapper 的位置。
   * [left%, top%]
   */
  pos?: [number, number];
}

// ── 內圈色彩常數 ─────────────────────────────────────────────
const C = {
  smallDeal:    { color: '#1e3a5f', borderColor: '#3b82f6' },
  bigDeal:      { color: '#1e1b4b', borderColor: '#818cf8' },
  doodad:       { color: '#7c2d12', borderColor: '#f97316' },
  crisis:       { color: '#450a0a', borderColor: '#ef4444' },
  market:       { color: '#78350f', borderColor: '#f59e0b' },
  charity:      { color: '#4a1d96', borderColor: '#a855f7' },
  baby:         { color: '#831843', borderColor: '#ec4899' },
  relationship: { color: '#1e1b4b', borderColor: '#818cf8' },
  downsizing:   { color: '#1c1917', borderColor: '#78716c' },
  secondLife:   { color: '#713f12', borderColor: '#facc15' },
} as const;

// ── 外圈色彩常數（金色系） ───────────────────────────────────
const G = {
  realestate:{ color: '#92400e', borderColor: '#f59e0b' },
  stock:     { color: '#78350f', borderColor: '#fde68a' },
  network:   { color: '#7c2d12', borderColor: '#fb923c' },
  charity:   { color: '#881337', borderColor: '#fb7185' },
  business:  { color: '#7c2d12', borderColor: '#f97316' },
  tax:       { color: '#44403c', borderColor: '#a8a29e' },
  wave:      { color: '#1e3a5f', borderColor: '#38bdf8' },
  partner:   { color: '#064e3b', borderColor: '#34d399' },
  crisis:    { color: '#450a0a', borderColor: '#ef4444' },
  travel:    { color: '#2e1065', borderColor: '#a78bfa' },
  relation:  { color: '#831843', borderColor: '#f472b6' },
  startup:   { color: '#1e3a5f', borderColor: '#60a5fa' },
  leverage:  { color: '#064e3b', borderColor: '#6ee7b7' },
  disease:   { color: '#4a044e', borderColor: '#e879f9' },
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
  { id: 'inner-0',  type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal },
  { id: 'inner-1',  type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad },
  { id: 'inner-2',  type: 'relationship', name: '人際關係', icon: '🤝', ...C.relationship },
  { id: 'inner-3',  type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal },
  { id: 'inner-4',  type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis },
  { id: 'inner-5',  type: 'charity',      name: '慈善捐款', icon: '❤️', ...C.charity },
  { id: 'inner-6',  type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal },
  { id: 'inner-7',  type: 'market',       name: '市場行情', icon: '📈', ...C.market },
  { id: 'inner-8',  type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad },
  { id: 'inner-9',  type: 'baby',         name: '家庭事件', icon: '👶', ...C.baby },
  { id: 'inner-10', type: 'relationship', name: '人際關係', icon: '🤝', ...C.relationship },
  { id: 'inner-11', type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal },
  { id: 'inner-12', type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis },
  { id: 'inner-13', type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal },
  { id: 'inner-14', type: 'market',       name: '市場行情', icon: '📈', ...C.market },
  { id: 'inner-15', type: 'doodad',       name: '意外支出', icon: '💸', ...C.doodad },
  { id: 'inner-16', type: 'downsizing',   name: '職涯轉折', icon: '📉', ...C.downsizing },
  { id: 'inner-17', type: 'relationship', name: '人際關係', icon: '🤝', ...C.relationship },
  { id: 'inner-18', type: 'bigDeal',      name: '大交易',   icon: '🏢', ...C.bigDeal },
  { id: 'inner-19', type: 'charity',      name: '慈善捐款', icon: '❤️', ...C.charity },
  { id: 'inner-20', type: 'smallDeal',    name: '小交易',   icon: '📋', ...C.smallDeal },
  { id: 'inner-21', type: 'crisis',       name: '危機事件', icon: '⚡', ...C.crisis },
  { id: 'inner-22', type: 'market',       name: '市場行情', icon: '📈', ...C.market },
  { id: 'inner-23', type: 'secondLife',   name: '第二人生', icon: '🌟', ...C.secondLife },
];

// ============================================================
// 外圈 17 格（FastTrack，順時針，格 0 = 上方起點）
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
  // ── 外圈 17 格；實際位置由 GameBoard 與棋子共用的橢圓座標函式產生。
  // x = 50 + 37*sin(angle),  y = 49 - 34*cos(angle)
  { id: 'outer-0',  type: 'ftWave',       name: '時代浪潮', icon: '🌊', ...G.wave,       pos: [50.0, 15.0] },
  { id: 'outer-1',  type: 'ftRealEstate', name: '大型房地產', icon: '🏰', ...G.realestate, pos: [64.2, 17.6] },
  { id: 'outer-2',  type: 'ftStock',      name: '股市大機會', icon: '📊', ...G.stock,      pos: [76.2, 25.0] },
  { id: 'outer-3',  type: 'ftNetwork',    name: '人脈峰會',   icon: '🌐', ...G.network,    pos: [84.2, 36.0] },
  { id: 'outer-4',  type: 'ftCharity',    name: '慈善格',     icon: '❤️', ...G.charity,    pos: [87.0, 49.0] },
  { id: 'outer-5',  type: 'ftBusiness',   name: '事業擴張',   icon: '🏗️', ...G.business,   pos: [84.2, 62.0] },
  { id: 'outer-6',  type: 'ftRealEstate', name: '大型房地產', icon: '🏰', ...G.realestate, pos: [76.2, 73.0] },
  { id: 'outer-7',  type: 'ftTax',        name: '稅務規劃',   icon: '📑', ...G.tax,        pos: [64.2, 80.4] },
  { id: 'outer-8',  type: 'ftStartup',    name: '科技新創',   icon: '💡', ...G.startup,    pos: [50.0, 83.0] },
  { id: 'outer-9',  type: 'ftWave',       name: '時代浪潮',   icon: '🌊', ...G.wave,       pos: [35.8, 80.4] },
  { id: 'outer-10', type: 'ftPartner',    name: '合夥機會',   icon: '🤲', ...G.partner,    pos: [23.8, 73.0] },
  { id: 'outer-11', type: 'ftCrisis',     name: '危機考驗',   icon: '⚡', ...G.crisis,     pos: [15.8, 62.0] },
  { id: 'outer-12', type: 'ftTravel',     name: '生命歷練', icon: '✈️', ...G.travel,     pos: [13.0, 49.0] },
  { id: 'outer-13', type: 'ftTravel',     name: '生命歷練',   icon: '✈️', ...G.travel,    pos: [15.8, 36.0] },
  { id: 'outer-14', type: 'ftRelation',   name: '人際關係',   icon: '💫', ...G.relation,   pos: [23.8, 25.0] },
  { id: 'outer-15', type: 'ftLeverage',   name: '資產槓桿',   icon: '🚀', ...G.leverage,   pos: [35.8, 17.6] },
  { id: 'outer-16', type: 'ftDisease',    name: '疾病危機',   icon: '🏥', ...G.disease,    pos: [42.9, 15.3] },
];
