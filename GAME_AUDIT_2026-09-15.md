# 百歲人生｜整體遊戲檢測報告（2026-09-15）

受測提交：`94e7ea4`（工作區另有三份 RELEASE 文件未提交的修改，不影響程式）。

## 修復狀態（2026-09-15 晚間更新）

本報告列出的問題已全部修復，變更內容見 [RELEASE_2026-09-15.md](RELEASE_2026-09-15.md)。後端測試 31 項通過，前端型別檢查與 lint 無錯誤；已在本機以主持人＋兩位玩家＋大螢幕重跑開局、落格說明、自動放行、跳過回合與被接手提示。低嚴重度與設計取捨項目已於同日第二、三批處理（詐騙卡改為比例扣款、危機加入自救階段、外圈疾病費用改為淨值比例、槓桿利率與大交易現金流調整），詳見發行說明。

## 結論

**現有自動測試與靜態檢查全部通過，但實機流程與程式審查找出 9 個會讓一場活動卡住或明顯不公平的問題，建議先修再辦下一場。** 最嚴重的是：離線且未選職業的玩家會被帶進遊戲並卡住輪次、人際關係「機遇型」卡在手機上沒有任何介面、「這次不旅行／略過」按鈕會被伺服器當成格式錯誤、臥床玩家輪到時無法擲骰、青年期危機池裡混進致死卡、大螢幕發薪小卡永遠不會自己關閉。

| 範圍 | 結果 | 說明 |
|---|---|---|
| 後端測試 `npm test` | 通過 | 22 項通過、0 失敗 |
| 前端 `tsc --noEmit` 與 `eslint` | 通過 | 無錯誤 |
| 本機實測（1 主持人＋2 玩家＋大螢幕） | 發現問題 | 建房、投胎、配點、進修、選職業、開局、擲骰、大交易、競標、人際關係各走一次 |
| 六路程式審查 | 發現問題 | 回合流程、金流、卡牌資料、玩家端、主持端、前後端事件契約 |

本次沒有修改任何遊戲程式，只新增本報告與 `.claude/launch.json`（本機啟動設定）。

---

## 一、實機重現的問題（本機瀏覽器操作）

### R1｜P0｜離線且沒選完職業的玩家會被直接帶進遊戲，然後卡住全場
位置：[socketServer.ts:4463](socketServer.ts:4463)。

`startGame` 的未就緒檢查刻意排除 `isDisconnected` 的玩家，註解寫「他們重連會自動恢復」，但 `playerRejoin`（[socketServer.ts:5603](socketServer.ts:5603)）只在 Pre20 階段才補送設定流程。實測：小明在配點階段斷線，主持人按「開始」沒有任何警告，遊戲直接開始，第一輪就輪到小明，大螢幕顯示「輪到小明」、職業「待選擇」、月現金流 $0，其他人只能等；主持人唯一的出路是「移除玩家」。

修法：`startGame` 對所有 `!pre20Done` 的玩家都跑 `autoCompletePre20`（不分線上／離線），或直接拒絕開始並列出名字。

### R2｜P1｜同一身分在別處連線後，舊頁面被踢但畫面毫無提示
位置：[socketServer.ts:5590](socketServer.ts:5590)、[PlayerPage.tsx:149](frontend/src/pages/PlayerPage.tsx:149)。

伺服器對舊 socket 呼叫 `disconnect(true)`；socket.io 客戶端遇到伺服器主動斷線不會自動重連，前端只把 `connected` 設成 false，而這個狀態只在「加入」畫面顯示。實測舊頁面停在配點畫面，按「確認分配」完全沒反應，也沒有任何文字說明。手機在通知列重新開一次連結、或家長借用手機再掃一次 QR 都會踩到。

修法：遊戲中所有畫面顯示連線狀態橫幅；收到伺服器斷線時提示「此身分已在其他裝置繼續」並提供重新連線按鈕。

### R3｜P1｜遊戲進行中伺服器的錯誤訊息完全看不到
位置：[PlayerPage.tsx:150](frontend/src/pages/PlayerPage.tsx:150)，`error` 只在第 663、795、951 行（加入與 Pre-20 畫面）渲染。

實測競標時空白出價、以及出價 $1,350,000 但現金只有 $93,000，按「出價」都沒有任何反應；伺服器其實回了錯誤，但遊戲畫面不顯示。所有「現金不足」「目前不是自由操作時間」「此決策已結束」等提示都一樣消失。

修法：遊戲畫面加一個會自動消失的錯誤 toast，或把 `error` 走 `addNotification`。

### R4｜P2｜成長點數沒分配完也能確認，剩餘點數直接消失
實測只分配 7／20 點就按確認，伺服器接受，畫面變成「已分配／總點數 7 / 0」，13 點無聲蒸發。

修法：前端未分配完時停用按鈕並提示；伺服器也應拒絕或自動補滿。

### R5｜P2｜進修後的職業承諾與實際不符
[PlayerPage.tsx:831](frontend/src/pages/PlayerPage.tsx:831) 寫「已解鎖高階職業（保證分配，不會抽到初階）：IT工程師、醫生、店長、公職人員」，但 `E_PROFESSION_POOLS.advanced`（[gameConfig.ts:1142](gameConfig.ts:1142)）還含工程師與會計師。實測進修後抽到會計師，玩家會覺得被騙。

### R6｜P2｜開局第一格就遇到「大交易」時整段流程是空轉
22 歲、現金 $61,000、可借 $450,000，抽到頭期款 $1,350,000 的民宿，只能按「拒絕」；接著自動開放全場競標，另一位玩家現金 $93,000 也不可能出價；主持人為此按了三次「繼續／揭曉」。建議大交易依年齡或淨值過濾牌池，或流標時不開競標。

### R7｜P2｜人際關係負面卡把全部現金扣光，手機上看不到金額
「詐騙受害」（[gameCards.ts:1369](gameCards.ts:1369)）現金 -$120,000。實測小華 25 歲第一次行動就從 $93,000 變成 $0；手機通知只寫「人際關係格子：詐騙受害」，大螢幕最新動態也沒有這一筆。至少要把金額與 NT 變化顯示出來。

### R8｜P2｜每落一格主持人要按 2 到 3 次「繼續」
落格說明一次、格子事件一次、決策揭曉一次，這是 `94e7ea4` 刻意的設計。以 6 人 20 輪估算約 300 到 400 次點擊。建議把「落格說明」與「格子事件」合併成一次，或讓主持人設定某些格子自動放行。

### R9｜P2｜大螢幕在每次決策時都顯示「遊戲暫停」
[DisplayScreen.tsx:598](frontend/src/pages/DisplayScreen.tsx:598) 以 `isPaused` 判斷，而 `beginHostDecisionPhase` 每次都會暫停時鐘，所以大交易、落格說明、競標時大螢幕標題都是「遊戲暫停 · 由主持人決定何時繼續」。主持人後台與手機控場也同時顯示「已暫停」。建議伺服器序列化 `pauseReason`，前端只在手動暫停時顯示。

### 其他實測小問題
- 社會階層在配點畫面顯示英文 `Rich`，其他階層顯示中文（[PlayerPage.tsx](frontend/src/pages/PlayerPage.tsx) 讀 `socialClass` 原始值）。
- 「強制開始」的確認文字說會分配「中等社會階層」，但 `autoCompletePre20` 是隨機投胎。
- 22 歲起步的玩家第一輪結束後直接變 24 歲（年齡取全域年齡與起始年齡的較大值），與「每輪 +4」的說法不一致。
- 同一個瀏覽器開兩個玩家分頁會互相覆蓋 `localStorage['baisuiGame']`，重新整理後會變成另一位玩家。實際手機各自獨立，但示範或測試時會困惑。

---

## 二、程式審查確認的問題

### 高嚴重度

**H1｜青年期危機池含致死卡。** [gameCards.ts:1416](gameCards.ts:1416) `CRISIS_POOL_BY_STAGE.Youth` 註解寫「輕微車禍」，實際 `cr-001` 是心臟病突發、$750,000、`canCauseDeath: true`。20 到 34 歲踩到危機格有四分之一機率抽到，現金不足者直接死亡。`cr-003` 註解寫「可死亡」，實際是 $225k 非致死卡。整份 ID 與註解錯位，需重新對照。

**H2｜人際關係機遇型卡沒有手機介面。** 伺服器在 [socketServer.ts:6528](socketServer.ts:6528) 送 `relationshipCardDrawn` 並等待決策，前端沒有任何地方監聽這個事件。玩家只看到「請在手機完成私人決策」卻沒有卡片；主持人只能「略過本次決策」，而略過的 fallback 會被當成「接受」（第 6533 行），賭博類卡會自動執行。

**H3｜「這次不旅行」「略過」會被驗證擋下。** [EventCard.tsx:256](frontend/src/components/game/EventCard.tsx:256) 與第 283 行送 `{ destinationId: null }`、`{ targetPlayerId: null }`；[socketValidation.ts:41](socketValidation.ts:41) 對所有 `*Id` 欄位要求非空字串。玩家按下去只會收到「資料格式不正確」（而且依 R3 看不到），決策永遠不會送出。修法：改送 `{}`，或驗證器允許 `null`。

**H4｜臥床玩家輪到時整場卡住。** [DiceRoller.tsx:20](frontend/src/components/game/DiceRoller.tsx:20) 臥床時不顯示任何按鈕，但伺服器的臥床跳過與死亡判定寫在 `playerRoll` 處理器裡（[socketServer.ts:2797](socketServer.ts:2797)），沒有人送 `playerRoll` 就沒有人推進；主持端也沒有「跳過本回合」的控制。修法：臥床時顯示「跳過本回合」按鈕，或伺服器在 `advanceTurn` 自動跳過臥床玩家。

**H5｜大螢幕的發薪小卡永遠不會自己關閉，之後所有演出都被擋住。** [DisplayScreen.tsx:285](frontend/src/pages/DisplayScreen.tsx:285) 每收到 `paydayPlanResult` 就打開 overlay，`paydayDismissTimer` 只有清除從未設定，`gameResumed` 刻意不關閉。轉場效果（第 465 行）在 overlay 開著時直接 return，導致後續玩家的發薪轉場、骰子動畫、棋子移動、落格說明面板全部不播；只有在投影機那台電腦上按 Enter 或點畫面才能解除。修法：自動關閉並在 `globalPaydayPlayerTurn`／`decisionPhaseStarted` 時清掉；轉場邏輯不要被這個 overlay 阻塞。

**H6｜現金為負時，扣款變成退款。** [cardSystem.ts:85](cardSystem.ts:85)、247、298、486 都用 `Math.min(cost, player.cash)`；年度稅（[taxSystem.ts:164](taxSystem.ts:164)）與連續負現金流可讓現金變負，此時 `cash -= 負數` 會把現金拉回 0，慈善捐款還會讓 `charityTotal` 變負卻照樣送加骰。危機卡在現金為負時 `cash < cost` 恆真，任何可致死卡都直接判死。修法：`Math.min(cost, Math.max(0, cash))`，並明確定義負現金下的危機處理。

**H7｜競標漏洞。** [socketServer.ts:4341](socketServer.ts:4341) `bidDeal` 不檢查出價者是否就是放棄交易的人；結標時得標金付給放棄者（第 6390 行），所以自己放棄再自己出底價等於白拿資產，兩人串通也能把頭期款轉給對方。修法：拒絕 `triggeredBy` 出價，得標金收歸銀行。

**H8｜$1 還款刷信用分。** `repayLoan` 每次固定 +15 信用（`CREDIT_CHANGE_REPAY`），沒有最低金額、沒有頻率限制；連還 10 次 $1 就從 600 升到 750，解鎖 $1.2M 額度與槓桿借款。修法：每季最多加一次，或依還款佔債務比例計分。

**H9｜「職場升遷 +20%」實際是減薪 30%。** [socketServer.ts:6546](socketServer.ts:6546) 用 `player.salary *= 1.2` 再設 `travelPenaltyRemaining = 1`；但 `triggerPayday`（[gameLogic.ts:180](gameLogic.ts:180)）每月從職業重算薪資，再乘旅遊懲罰 0.7。rel-007 減薪卡則走負面自動分支，`salaryMultiplier` 完全沒被讀取。修法：在 Player 上加「薪資倍率／剩餘月數」欄位，由 `triggerPayday` 消耗。

### 中嚴重度

- **M1｜移除當前回合玩家會讓輪次回到第一位。** [socketServer.ts:4436](socketServer.ts:4436) 先 `removePlayer` 再 `advanceTurn`，`indexOf` 得到 -1，下一位變成 index 0，且不加輪數。應先算出下一位再移除。
- **M2｜主持人沒有「跳過此玩家回合」的控制。** 玩家離線或發呆時唯一出路是移除，而移除會抹掉復盤資料，且有 P2P 借貸時會被拒絕。
- **M3｜重連時不補送兩種決策。** `replayEvents`（[socketServer.ts:2394](socketServer.ts:2394)）漏了 `crisisNTSkipAvailable` 與 `fastTrackPartnershipInvitation`；競標狀態也不在 `serializeGameState`，重新整理後無法出價。`charityCardDrawn` 在名單裡但從未發送。
- **M4｜旅遊與社交失敗沒有任何回饋。** 伺服器只送 `travelResult`／`socialEventResult`（[socketServer.ts:1784](socketServer.ts:1784)），前端沒有監聽；「HP 不足」「已婚」等拒絕原因玩家看不到，季度發薪選的旅遊也會無聲失敗。
- **M5｜結果卡被無關的決策階段清掉。** [PlayerPage.tsx:390](frontend/src/pages/PlayerPage.tsx:390) 收到任何 `decisionPhaseEnded` 都清 `activeEvent`，且 reading 階段會隱藏卡片，所以「你損失 $X」常常在玩家看到之前就消失。
- **M6｜自動續玩忽略網址上的房間。** 每次連線都用 `localStorage` 的舊身分 `playerRejoin`，掃了新房間 QR 仍會被拉回舊房；伺服器重啟後新玩家一進來就看到「無法驗證續玩身分」。
- **M7｜臥床狀態只有 `applyHPChange` 會解除。** 發薪日健康投資、全域事件、舞台事件、婚姻卡都直接改 `stats.health`，臥床玩家買再多 HP 也繼續每回合 30% 死亡判定。
- **M8｜人生評分財富維度沒有隨數值放大 15 倍更新，也不算現金。** [gameLogic.ts:935](gameLogic.ts:935) 淨值不含現金，第 958 行除以 1,000／500；$5M 現金得 0 分，一張小交易就 75 分。
- **M9｜B／I 職業開局就符合第二人生資格。** 健康門檻 50 低於最低起始 HP，天使投資人覆蓋率 1.34 開局即達標，一圈後直接進外圈。
- **M10｜P2P 借貸把利息算成被動收入。** 兩人互借可各自製造 +$45k 被動收入，湊出第二人生資格。應排除 `p2p-*` 資產。
- **M11｜加入時帶 `professionId` 可白拿 FQ。** `createPlayer` 接受客戶端指定職業，`selectQuadrant` 清資產但保留 `Math.max` 後的 FQ；帶 `angel_investor` 進房即 FQ 5。
- **M12｜學貸吃掉全部信用額度。** $450,000 無擔保學貸等於 600 分的上限，進修玩家在信用升到 650 前完全不能借任何錢。
- **M13｜主持人後台三個回饋問題。** 伺服器錯誤只寫進最下方的活動日誌；「刪除房間」在伺服器回覆前就登出並清掉房號；舞台事件進行中仍顯示「▶ 繼續」但伺服器會拒絕；轉職舞台在玩家確認前就能按揭曉。
- **M14｜決策回聲的「+$1,000/月」是一次性的。** [socketServer.ts:1395](socketServer.ts:1395) 直接加 `player.salary`，下個月被重算覆蓋。
- **M15｜已故玩家仍參與市場卡與最終評分重算。** `applyMarketCard` 不過濾 `isAlive`，`finishGame` 用死後狀態重算分數，排名可能與死亡時公布的不同。
- **M16｜`buyFranchise` 可重複購買且繞過轉職流程。** 沒有已是加盟主的檢查，每次扣 $750k 再注入 $600k 貸款。
- **M17｜`startGame` 沒有階段防護。** 遊戲中收到就把輪數歸零、年齡回 20。前端雖隱藏按鈕，舊分頁或腳本仍可觸發。
- **M18｜大螢幕 overlay 在 720p 會裁掉上緣。** `FacilitatorSceneOverlay` 與 reading 容器用 `items-center + overflow-y-auto`，內容高於視窗時最上面看不到也捲不到。
- **M19｜`mk-008` 賣出機會卡與 rel-002 `bonusSmallDeal` 都沒有實作。** 前者 `applyMarketCard` 直接 return，後者伺服器發事件但無人處理。
- **M20｜`globalPaydayFailed` 沒有人監聽。** 季度發薪失敗時主持人只看到狀態突然變化。

### 低嚴重度與設計面
- 願望清單會抽到已達成的目標，下一次擲骰就免費領獎（[bucketList.ts:130](bucketList.ts:130)）。
- 慈善格以薪資 10% 計算，B／I 職業與 80 歲以上（薪資倍率 0）永遠捐 $0、拿不到加骰。
- 家庭維度要 5 個小孩才滿分，但 `MAX_CHILDREN = 3`。
- 管理員改 FQ 允許 0 到 100，0 會讓玩家永遠無法升級，>10 倍率變 1.0。
- 恭喜功能每次 NT +0.2，其他地方都把 NT 當整數。
- 大螢幕、棋盤、骰子動畫、發薪小卡各用不同的色盤與索引，同一玩家顏色不一致。
- `GameBoard.tsx` 迷你地圖內圈用 25 格（實際 24 格）。
- `useSocket.ts`、`useGameState.ts`、`boardConfig.ts` 沒有任何檔案引用；`useGameState` 用 `socket.id` 判斷「我」，重連後會錯。
- 前端還留著 `marriageWindowOpened`、`playerMarried`、`partnershipOpportunity`、`careerChangeAnnouncement`、`gameClock` 的監聽，伺服器已不再發送。
- 伺服器 `repayLoan`、`cancelInsurance`、`buyFranchise`、`proposeMarriage`、`buyArrangedMarriage` 沒有對應介面，玩家無法從手機還款或退保。
- 開局後 `PAYDAY_LOCATIONS` 與 `FAST_TRACK_PAYDAY_LOCATIONS` 都是空的，`socketServer.ts` 2880 到 3080 行的單格發薪流程是死碼。
- 危機卡「現金不足即死」沒有先賣資產或借款的機會；外圈疾病格兩張致死卡 $1.8M／$3M，資產多現金少的人會抱著 $9M 房產死掉。
- 小交易槓桿後年報酬 48% 到 80%，遠高於大交易與股票，最佳策略變成囤小交易。

---

## 三、GAME_MECHANICS.md 已明顯過時

文件仍是數值放大 15 倍之前的版本：職業薪資（醫生 $13,200 vs 程式 $198,000）、學貸（$30,000 vs $450,000）、投資與保險價格、貸款上限、稅級、加盟費都對不上；棋盤寫 25 格含發薪日格，程式是 24 格且沒有發薪日格，第二人生在 23 而非 24；「事件處理中」階段從未被指派；進修後 25 歲起步、未進修 22 歲起步也未記載。主持人照文件帶場會講錯數字，建議整份重新產生。

---

## 四、建議修復順序

1. **一天內可修、影響一場活動能否進行**：R1、H2、H3、H4、H5、R3、R2。
2. **公平性與數值**：H1、H6、H7、H8、H9、M8、M9、M10、M11、M12。
3. **主持人操作順暢度**：R8、R9、M1、M2、M13、M4、M5。
4. **重連完整性**：M3、M6。
5. 其餘低嚴重度與死碼清理，並重寫 GAME_MECHANICS.md。

修完第一批後，建議用 4 到 6 支真實手機加大螢幕完整跑 20 輪，特別驗證季度發薪、臥床、死亡、外圈與終局復盤，這些本次沒有實機跑到。
