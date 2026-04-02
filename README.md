# 百歲人生 (100-Year Life) — 數位工作坊遊戲

以財富流 (Cashflow) 為原型，加入人生階段、職業選擇、人際關係、健康系統的多人線上工作坊遊戲。

---

## 系統需求

- Node.js 18+
- npm 9+

---

## 快速啟動

### 1. 安裝後端依賴

```bash
cd /path/to/money-game
npm install
```

### 2. 啟動後端伺服器

```bash
# 開發模式（檔案變更自動重啟）
npm run dev

# 正式模式
npm start
```

伺服器預設監聽 **port 3001**。

### 3. 安裝並啟動前端

```bash
cd frontend
npm install
npm run dev
```

前端預設運行在 **http://localhost:5173**。

---

## 環境變數

### 後端（根目錄）

後端目前使用 `gameConfig.ts` 中的常數，建議正式部署時改為環境變數：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `ADMIN_PASSWORD` | `cashflow-admin-2024` | 主持人後台登入密碼（在 `gameConfig.ts` 中修改） |

### 前端（`frontend/` 目錄）

複製 `frontend/.env.example` 為 `frontend/.env.local` 並填入：

```env
VITE_SERVER_URL=http://localhost:3001
```

正式部署時改為實際的後端 URL。

---

## URL 說明

| URL | 用途 | 說明 |
|-----|------|------|
| `http://localhost:5173/` | 玩家頁面 | 玩家手機使用，加入遊戲並進行操作 |
| `http://localhost:5173/?admin` | 主持人後台 | 建立房間、控制遊戲時鐘、調整玩家數值、觸發全局事件 |
| `http://localhost:5173/?display` | 大螢幕展示 | 投影至大螢幕，顯示即時排行、時鐘與全場分析 |

---

## 遊戲流程

### 主持人操作步驟

1. 開啟 `/?admin`，輸入主持人密碼
2. 點擊「建立新房間並登入」，系統產生 6 碼房間代碼
3. 將房間代碼告知所有玩家
4. 等待所有玩家完成 Pre-20 設定（投胎、分配成長屬性、選擇職業）
5. 設定遊戲時長（預設 90 分鐘）後點擊「開始遊戲」
6. 遊戲中可隨時暫停、繼續、觸發全局事件、調整玩家數值

### 玩家操作步驟

1. 開啟 `/`，輸入名字與房間代碼
2. 完成 Pre-20 設定：
   - 擲骰投胎（決定社會階層）
   - 分配成長點數（學業、體能、社交、資源）
   - 選擇是否繼續進修（解鎖高階職業）
   - 選擇職業
3. 等待主持人啟動遊戲
4. 遊戲中：每輪擲骰移動，依落點格子行動，可主動旅遊或參加聯誼

---

## 多場次同時進行

- 每位主持人可各自建立獨立房間
- 房間之間資料完全隔離
- 最多支援同時多房間（依伺服器記憶體限制）

---

## 職業象限說明

| 象限 | 說明 | 時間自由度 |
|------|------|-----------|
| **E** — 僱員 | 固定薪資，穩定但成長有限 | 固定班表：每發薪日限 1 次活動 |
| **S** — 自僱者 | 收入依技能或人脈浮動 | 業務員自由；設計師、律師固定 |
| **B** — 企業主 | 擁有事業，被動收入高 | 自由行程：不限次數 |
| **I** — 投資者 | 靠資產配息，完全被動 | 自由行程：不限次數 |

---

## 技術架構

```
money-game/
├── socketServer.ts      # 主伺服器（Socket.io + 遊戲邏輯）
├── gameDataModels.ts    # 資料模型（Player, GameState 等）
├── gameLogic.ts         # 核心邏輯（移動、發薪、年齡計算）
├── gameCards.ts         # 棋盤與卡牌定義（含 RelationshipCard）
├── cardSystem.ts        # 卡牌效果套用
├── gameConfig.ts        # 遊戲常數與職業設定
├── statsSystem.ts       # 玩家數值系統（HP 衰減、FQ 升級）
├── adminEvents.ts       # 全局事件定義（股災、疫情等）
└── frontend/            # React + Vite 前端
    ├── src/pages/
    │   ├── PlayerPage.tsx    # 玩家手機介面
    │   ├── AdminPage.tsx     # 主持人後台
    │   ├── DisplayScreen.tsx # 大螢幕展示
    │   └── AnalysisPage.tsx  # 個人決策分析
    └── src/components/
        ├── game/             # 財報、骰子、行動面板
        └── analysis/         # 時間軸、雷達圖、決策卡
```
