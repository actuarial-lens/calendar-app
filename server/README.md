# 背景提醒伺服器（Cloudflare Workers，免費額度內）

App 關著、手機鎖屏時也要準時跳通知，就需要這個小伺服器。**可以不設定**：不設定時 App 照樣可用，只是通知只在打開 App 時補列「錯過的提醒」。

推播功能只存兩樣東西：每支手機的「推播地址」與「接下來 7 天的提醒時間、標題」，**不存你的事項與備忘本身**。建議 5 人以內共用（上限預設 10，可用 `MAX_USERS` 調整）。

另外有一個**選用**的「雲端備份」（見下方〈雲端備份（選用）〉）：會把加密後的資料放進 D1。伺服器只看得到一堆加密過的內容，沒有還原碼就無法解開，看不到你的事項與備忘。不建立 D1 的話，這個功能就不能用，其他功能不受影響。

## 步驟（全部在網頁上做，不用裝東西）

1. **產生金鑰**：在電腦執行 `node server/generate-keys.mjs`（沒有 Node 的話請 Claude 幫你產生）。會印出三行：`VAPID_PUBLIC`、`VAPID_PRIVATE`、`APP_SECRET`。每個人各用一組自己的？不用，**大家共用同一組**即可。請自己保管，別貼到公開的地方。
2. 登入 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**，名稱填 `calendar-app-notification` → Deploy → **Edit code**，把 `server/worker.js` 整份貼上取代 → **Deploy**。
3. **建立 KV**：左側 **Storage & Databases → KV → Create**，名稱 `calendar-app-notification-kv`。回到 Worker → **Settings → Bindings → Add → KV namespace**，變數名稱填 **`PUSH_KV`**，選剛建立的 KV。
4. **設定變數**：Worker → **Settings → Variables and Secrets**，新增（Secret 類型較安全）：
   - `VAPID_PUBLIC`、`VAPID_PRIVATE`、`APP_SECRET`：貼步驟 1 的值
   - `VAPID_SUBJECT`：`mailto:你的信箱`（iPhone 的推播服務要求有效聯絡方式）
   - 選填 `ALLOWED_ORIGIN`：App 的網址，例如 `https://actuarial-lens.github.io`（不要結尾斜線）
   - 選填 `MAX_USERS`：人數上限
5. **每分鐘排程**：Worker → **Settings → Trigger Events → Add → Cron Triggers**，填 `* * * * *`。
6. 記下 Worker 網址（`https://calendar-app-notification.<帳號>.workers.dev`）。
7. **每支手機**：用主畫面圖示開 Calendar → 設定 → 按「開啟通知」允許 → 在「背景提醒」填 **伺服器網址、公鑰（VAPID_PUBLIC）、密碼（APP_SECRET）** → 按「測試伺服器推播」，幾秒內應收到通知。

## 雲端備份（選用）

換手機時，用「還原碼」從伺服器取回資料。資料在手機上用還原碼加密後才送出（AES-256-GCM），伺服器收到的是加密後的內容。

1. **建立 D1**：Cloudflare 左側 **Storage & Databases → D1 SQL database → Create database**，名稱填 `calendar-app-backup`。
2. **綁定**：Worker `calendar-app-notification` → **Settings → Bindings → Add → D1 database**，變數名稱填 **`BACKUP_DB`**，選剛建立的資料庫 → 儲存。
3. **更新程式**：Worker → **Edit code**，把新的 `server/worker.js` 整份貼上取代 → **Deploy**。
4. 不需要新增任何密碼或變數；備份用的是原本的 `APP_SECRET`。選填 `MAX_BACKUPS`：伺服器最多存幾組備份（預設 20 組，一個還原碼算一組）。
5. 手機：設定 → 在「背景提醒」填好伺服器網址與密碼 → 「雲端備份」按「開啟雲端備份」，**把顯示的還原碼存到密碼管理器**，再按「我已存好」。

- 表格 `backups` 會在第一次使用時自動建立，不用手動建表。
- 每個還原碼保留最近 7 天，每天一份；更舊的會自動刪除。
- 單份備份上限約 1,000,000 字元（加密後）。
- **忘記還原碼就無法取回**。要換新碼：設定 → 雲端備份 → 更換還原碼（會刪掉舊碼的雲端備份）。
- 沒有綁定 `BACKUP_DB` 時，伺服器對備份請求回 501，App 會顯示「伺服器還沒設定雲端備份」。

## 注意

- iPhone 只有「加入主畫面」的 App 才收得到背景推播。
- 事項有變動，App 會在打開時自動把排程同步到伺服器；一次同步 7 天份，所以至少每週打開一次。
- 超過預定時間 30 分鐘才送到的提醒不會補發（避免過期通知）。
- 手機取消通知權限或移除 App 後，伺服器收到 404/410 會自動清掉那支手機的資料。
- 免費額度：Workers 每天 10 萬次請求；KV 每天 1,000 次寫入；D1 每天 10 萬次寫入。5 人使用遠低於上限。
- 換密碼：改 `APP_SECRET` 後，每支手機也要改。

## 測試

`npx vitest run server`：含 RFC 8291 官方測試資料的逐位元組比對、VAPID 簽章驗證、授權、人數上限、到點只送一次、410 清除等。實際與 Apple 推播服務的互通無法在這裡驗證，請用步驟 7 的「測試伺服器推播」確認。
