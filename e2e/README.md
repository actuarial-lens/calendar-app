# 實測腳本

用 Playwright 在手機尺寸的 Chrome 上實際操作 App。需要：Python 3、`pip install playwright`、系統有 `/usr/bin/google-chrome`。

- `editscope.py`（重複事項改內容問範圍）、`alerts.py`（重要未結＋截止提示框）、`heat.py`（週列／月曆深淺）：印 OK／FAIL，最後一行 `FAILS: []` 代表全過。
- `capsule_center.py`：量測所有膠囊／按鈕的文字是否上下置中（截圖比對字的墨跡中心與膠囊中心，誤差 ≤ 1px 算置中；`-v` 印出每一顆）。改了任何按鈕、膠囊的 padding 或字級後要跑。
- `e2e.py`、`e2e3.py`、`anim.py`：先 `npm run build && npx vite preview --port 4173`，再 `python3 e2e/e2e.py`
- `offline.py`：用子路徑建置後在 4174 埠提供：
  `npx vite build --base=/calendar-app/ --outDir /tmp/sub/calendar-app && (cd /tmp/sub && python3 -m http.server 4174)`，再 `python3 e2e/offline.py`

注意：App 預設沒有範例資料。腳本都用網址 `?demo=1` 開啟，這樣資料庫是空的時候會放一份範例資料給測試用。
