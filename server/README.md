# 背景提醒伺服器（Cloudflare Workers，免費額度內）

App 關著、手機鎖屏時也要準時跳通知，就需要這個小伺服器。**可以不設定**：不設定時 App 照樣可用，只是通知只在打開 App 時補列「錯過的提醒」。

伺服器只存兩樣東西：每支手機的「推播地址」與「接下來 7 天的提醒時間、標題」。**不存你的事項與備忘本身**，也沒有資料庫帳號。建議 5 人以內共用（上限預設 10，可用 `MAX_USERS` 調整）。

## 步驟（全部在網頁上做，不用裝東西）

1. **產生金鑰**：在電腦執行 `node server/generate-keys.mjs`（沒有 Node 的話請 Claude 幫你產生）。會印出三行：`VAPID_PUBLIC`、`VAPID_PRIVATE`、`APP_SECRET`。每個人各用一組自己的？不用，**大家共用同一組**即可。請自己保管，別貼到公開的地方。
2. 登入 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**，名稱填 `calendar-push` → Deploy → **Edit code**，把 `server/worker.js` 整份貼上取代 → **Deploy**。
3. **建立 KV**：左側 **Storage & Databases → KV → Create**，名稱 `calendar-push-kv`。回到 Worker → **Settings → Bindings → Add → KV namespace**，變數名稱填 **`PUSH_KV`**，選剛建立的 KV。
4. **設定變數**：Worker → **Settings → Variables and Secrets**，新增（Secret 類型較安全）：
   - `VAPID_PUBLIC`、`VAPID_PRIVATE`、`APP_SECRET`：貼步驟 1 的值
   - `VAPID_SUBJECT`：`mailto:你的信箱`（iPhone 的推播服務要求有效聯絡方式）
   - 選填 `ALLOWED_ORIGIN`：App 的網址，例如 `https://actuarial-lens.github.io`（不要結尾斜線）
   - 選填 `MAX_USERS`：人數上限
5. **每分鐘排程**：Worker → **Settings → Trigger Events → Add → Cron Triggers**，填 `* * * * *`。
6. 記下 Worker 網址（`https://calendar-push.<帳號>.workers.dev`）。
7. **每支手機**：用主畫面圖示開 Calendar → 設定 → 按「開啟通知」允許 → 在「背景提醒」填 **伺服器網址、公鑰（VAPID_PUBLIC）、密碼（APP_SECRET）** → 按「測試伺服器推播」，幾秒內應收到通知。

## 注意

- iPhone 只有「加入主畫面」的 App 才收得到背景推播。
- 事項有變動，App 會在打開時自動把排程同步到伺服器；一次同步 7 天份，所以至少每週打開一次。
- 超過預定時間 30 分鐘才送到的提醒不會補發（避免過期通知）。
- 手機取消通知權限或移除 App 後，伺服器收到 404/410 會自動清掉那支手機的資料。
- 免費額度：Workers 每天 10 萬次請求；KV 每天 1,000 次寫入。5 人使用遠低於上限。
- 換密碼：改 `APP_SECRET` 後，每支手機也要改。

## 測試

`npx vitest run server`：含 RFC 8291 官方測試資料的逐位元組比對、VAPID 簽章驗證、授權、人數上限、到點只送一次、410 清除等。實際與 Apple 推播服務的互通無法在這裡驗證，請用步驟 7 的「測試伺服器推播」確認。
