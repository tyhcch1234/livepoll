# LivePoll · 即時互動投票

像 Mentimeter 一樣的即時投票網頁：主持人投影一個 QR code，觀眾用手機掃碼作答，答案在投影畫面上即時出現。

純靜態網站（HTML + CSS + 原生 JS），可直接放在 GitHub Pages，**不需要伺服器、不需要資料庫、不需要帳號**。

## 功能

| 功能 | 說明 |
| --- | --- |
| 四種題型 | 文字雲、選擇題（2–8 選項）、開放回答、五星評分 |
| QR code 加入 | 自動依網址產生 QR；可點擊放大，方便投影 |
| 6 位加入代碼 | 無法掃碼時可手動輸入，例如 `K7M2Q9` |
| 即時同步 | WebSocket（MQTT over WSS），送出後即時更新，無需輪詢 |
| 觀眾端即時結果 | 主持人可一鍵開／關，決定手機上是否看到結果 |
| 修改答案 | 同一部手機重複作答會覆蓋舊答案，不會重複計票 |
| 匯出 CSV | 一鍵下載全部回應（時間、名字、答案） |
| 重置 | 清除本場全部回應，重新開始 |
| 延遲加入 | 後加入的人會立即取得目前題目與結果 |

## 使用流程

1. 開啟首頁，輸入問題、選題型（選擇題可自訂選項）。
2. 按「建立投票並取得 QR code」→ 進入投影畫面。
3. 把投影畫面（或 QR）給觀眾掃描。
4. 觀眾回答，投影畫面的結果即時變動。
5. 結束後按「匯出 CSV」帶走原始資料。

投影畫面右上角：`隱藏觀眾結果`、`匯出 CSV`、`清除回應`、`全螢幕`。

## 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "LivePoll: realtime QR polling site"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

然後在 GitHub repo → Settings → Pages → Source 選 `Deploy from a branch` → `main` / `root` → Save。
約一分鐘後網址為 `https://<帳號>.github.io/<repo>/`。

> 因為是專案頁面（子路徑），程式已使用相對路徑，放在 `/<repo>/` 下可直接運作。

## 技術架構

```
index.html   建立投票（存題目設定於 localStorage，產生 6 位代碼）
host.html    投影畫面：持有全場狀態，負責彙總與渲染
vote.html    手機作答頁：只送出、不寫狀態
assets/core.js   純邏輯（代碼、驗證、彙總、CSV）— 可在 Node 跑單元測試
assets/net.js    MQTT 連線、QR 繪製、UI 小工具
assets/vendor/   mqtt.js 5.10.1、qrcode-generator 1.4.4（本地內嵌，不依賴 CDN）
```

**同步方式**：MQTT over WebSocket，公共 broker `wss://broker.emqx.io:8084/mqtt`。

- 主題：`livedot/v1/<CODE>/resp`（觀眾 → 主持）、`livedot/v1/<CODE>/state`（主持 → 全場）
- `state` 使用 **retained message**：新加入或重新整理的人會立刻收到最新題目與結果。
- 主持畫面是唯一的狀態寫入者；重開頁面會先讀回 retained 狀態再繼續，不會遺失資料。

## 測試

```bash
node tests/core.test.js
```

涵蓋：代碼格式、投票彙總、重複作答覆蓋、非法選項拒絕、文字長度限制、狀態合併、CSV 輸出。

## 已知限制

- 資料存在**公開** MQTT broker 上，主題以 6 位隨機代碼區分。適合課堂／會議即時使用，**不要用來收集敏感或個人資料**。
- 沒有後端資料庫：主持人關閉頁面後資料仍在 broker 的 retained 訊息中，但 broker 若清理訊息就會消失。需要長期保存請即時匯出 CSV。
- 同時建立大量投票時，6 位代碼有極低機率撞號；重新整理即可換新代碼。
- 需要網絡連線；公共 broker 偶爾不穩時，頁面會顯示「重新連線中」並自動重試。

## 授權

站內程式碼可自由使用。第三方：mqtt.js（MIT）、qrcode-generator（MIT，Kazuhiko Arase）。
