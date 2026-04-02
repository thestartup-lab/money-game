# 百歲人生 — 部署指南

## 架構說明

```
[玩家手機 / 電腦]
        │
        ▼
game.cjlead.com.tw  ←── Vercel（前端 React）
        │ WebSocket
        ▼
*.railway.app       ←── Railway（後端 Socket.io）
```

---

## 第一步：部署後端到 Railway

### 1-1 建立 Railway 帳號 & 新專案

1. 前往 [railway.app](https://railway.app) → 用 GitHub 登入
2. 點 **New Project** → **Deploy from GitHub repo**
3. 選擇包含這個專案的 repo（根目錄，不是 `frontend` 子資料夾）
4. Railway 會自動偵測 `railway.toml` 並執行 `npm run build && npm start`

### 1-2 取得後端網址

部署成功後：
- 進入 Railway 專案 → 點你的 Service → **Settings → Networking**
- 點 **Generate Domain** 產生公開網址
- 格式類似：`https://money-game-server-production.up.railway.app`
- **把這個網址複製起來，下一步要用**

---

## 第二步：設定前端後端 URL

打開 `frontend/.env.production`，把 URL 換成你的 Railway 網址：

```env
VITE_SERVER_URL=https://money-game-server-production.up.railway.app
```

---

## 第三步：部署前端到 Vercel

### 3-1 在 Vercel 建立新專案

1. 前往 [vercel.com](https://vercel.com) → **Add New Project**
2. 選擇同一個 GitHub repo
3. **重要設定：**
   - **Root Directory（根目錄）**：設定為 `frontend`
   - Framework：Vite（Vercel 會自動偵測）

### 3-2 設定環境變數

在 Vercel 專案設定 → **Environment Variables** 加入：

| Name | Value |
|------|-------|
| `VITE_SERVER_URL` | `https://你的railway網址.railway.app` |

### 3-3 設定自訂網域

1. Vercel 專案 → **Settings → Domains**
2. 加入 `game.cjlead.com.tw`
3. Vercel 會顯示一筆 DNS 記錄，到你的 DNS 管理介面新增：
   - 類型：`CNAME`
   - 名稱：`game`
   - 值：`cname.vercel-dns.com`

---

## 本地開發

```bash
# 後端（根目錄）
npm install
npm run dev

# 前端（另開終端）
cd frontend
npm install
npm run dev
```

前端預設連線 `http://localhost:3001`（已設定 fallback）。

---

## 遊戲網址說明

| 網址 | 用途 |
|------|------|
| `game.cjlead.com.tw/` | 玩家頁面 |
| `game.cjlead.com.tw/?admin` | 主持人後台 |
| `game.cjlead.com.tw/?display` | 大螢幕顯示 |
| `game.cjlead.com.tw/?board` | 棋盤預覽 |
