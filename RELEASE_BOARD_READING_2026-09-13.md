# 落格閱讀部署紀錄

## Deploy Result

- URL：https://game.cjlead.com.tw
- Deployment：https://money-game-lkxf5ejk2-cjleads-projects.vercel.app
- Target：production
- Status：READY
- Commit：94e7ea4ad4d00fee1902712cb421221ee3e16b57
- Framework：React / Vite；後端 Node.js / Socket.IO（Railway）
- Build Duration：Vercel build 5 秒，Vite 833 毫秒。
- 完成時間：2026-09-13 20:01（Asia/Taipei）。

## 本次內容

落格與後續事件由主持人逐張按「看完了，繼續」，不再自動消失；閱讀完成才開始私人決策倒數。保留骰子與移動動畫，內外圈及重新連線均支援。

## 驗證

- 部署前 22 項測試全數通過，前端 lint / build 通過。
- 正式前端已取得新版 BoardReadingPanel-BS9yrSRb.js，包含主持人繼續按鈕。
- 正式後端 /health 回報 ok，revision 與上述 commit 相同。
- 正式 Socket 連線與 listRooms 查詢通過；房間為空。
- 此次部署後未建立完整真人遊戲；互動流程沿用先前本機瀏覽器驗證及本次重跑的自動測試。
- 使用者確認可中斷舊房間後才推送；舊房間進度未在本次保存，重啟後無法由記憶體恢復。

## Post-Deploy Observability

- Error scan：vercel logs --level error --since 10m 回報 No logs found；不代表已涵蓋 Railway 或瀏覽器錯誤。
- Drains：未檢查。
- Monitoring：僅本次健康、靜態資源與 Socket 檢查；未新增持續監控。
- 已有非阻斷建置警告：Browserslist 資料較舊、圖表 chunk 超過 500 kB。
- 手動 Vercel 部署回報 Not authorized，未重試或變更權限；既有 Git 自動部署成功，部署日誌確認使用正確 commit。
