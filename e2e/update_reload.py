"""新版部署後，App 不再中途重新整理（0.28.0）。

用法：先在 repo 外建兩份只差 sw.js 內容的建置，再執行：
  npx vite build --outDir /tmp/work/b1 --emptyOutDir
  cp -r /tmp/work/b1 /tmp/work/b2 && printf '\\n// build 2\\n' >> /tmp/work/b2/sw.js
  python3 e2e/update_reload.py [b1目錄 b2目錄]
"""
import asyncio, http.server, socketserver, sys, threading, functools, datetime
from playwright.async_api import async_playwright

B1 = sys.argv[1] if len(sys.argv) > 1 else '/tmp/work/b1'
B2 = sys.argv[2] if len(sys.argv) > 2 else '/tmp/work/b2'
PORT = 4181
ROOT = {'dir': B1}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT['dir'], **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

FAILS = []
def check(name, ok, info=''):
    print(('OK   ' if ok else 'FAIL ') + name + (f'  {info}' if info else ''))
    if not ok: FAILS.append(name)

SEED = """async () => {
  const now = Date.now();
  const d = new Date(now - 10 * 60000);
  const p = (n) => String(n).padStart(2, '0');
  const iso = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('blue-week'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(['kv', 'tasks'], 'readwrite');
    tx.objectStore('kv').put({ key: 'settings', value: { notificationsEnabled: true } });
    tx.objectStore('kv').put({ key: 'lastSeenAt', value: now - 3600000 });
    tx.objectStore('tasks').put({ id: 'missed-1', date: iso, time: p(d.getHours()) + ':' + p(d.getMinutes()), category: '會議', title: '錯過的會議', note: '', done: false, leadMinutes: 30, delayDays: 0, createdAt: now, updatedAt: now });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}"""

HIDE = """() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}"""

async def main():
    srv = S(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    target = (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        base = f'http://localhost:{PORT}/'

        # 1. 舊版（b1）：讓 Service Worker 安裝，寫入「錯過的提醒」資料
        ROOT['dir'] = B1
        page = await ctx.new_page()
        await page.goto(base + '?demo=1')
        await page.wait_for_selector('.card')
        await page.evaluate('navigator.serviceWorker.ready.then(() => 1)')
        await page.wait_for_timeout(1000)
        await page.evaluate(SEED)
        await page.close()

        # 2. 換成新版（b2），用 ?date= 重新打開
        ROOT['dir'] = B2
        page = await ctx.new_page()
        loads = []
        page.on('load', lambda: loads.append(1))
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(base + f'?date={target}')
        await page.wait_for_selector('.header')
        await page.wait_for_selector('.missed')
        range_before = await page.inner_text('.range')
        missed_before = await page.inner_text('.missed')
        check('開啟時顯示錯過的提醒', '錯過的會議' in missed_before, missed_before.replace('\n', ' | '))
        await page.click('.btn-new')
        await page.wait_for_selector('#ed-title')
        await page.fill('#ed-title', '打到一半的事項')
        await page.wait_for_timeout(6000)
        check('等 6 秒後頁面只載入 1 次', len(loads) == 1, f'loads={len(loads)}')
        check('新增面板還在', await page.locator('#ed-title').count() == 1)
        check('輸入的字還在', await page.input_value('#ed-title') == '打到一半的事項')
        check('錯過的提醒還在', await page.locator('.missed').count() == 1)
        check('日期還在 ?date= 那週', await page.inner_text('.range') == range_before, range_before)

        # 3. 關掉面板、模擬切到背景 → 重新整理一次，狀態接回來
        await page.keyboard.press('Escape')
        await page.evaluate(HIDE)
        await page.wait_for_timeout(2500)
        check('切到背景後重新整理（載入第 2 次）', len(loads) == 2, f'loads={len(loads)}')
        await page.wait_for_selector('.header')
        await page.wait_for_timeout(500)
        check('重新整理後日期仍是 ?date= 那週', await page.inner_text('.range') == range_before, await page.inner_text('.range'))
        n = await page.locator('.missed').count()
        check('重新整理後錯過的提醒仍在', n == 1 and '錯過的會議' in await page.inner_text('.missed'))
        check('網址已拿掉 ?date=', '?' not in page.url, page.url)
        key = await page.evaluate("sessionStorage.getItem('reloadState')")
        check('sessionStorage 的暫存已刪除', key is None, str(key))

        # 4. 按「關閉」後再切背景：不再帶回
        await page.click('.missed-head button:nth-of-type(2)')
        await page.wait_for_timeout(500)
        check('按關閉後 sessionStorage 沒有暫存', await page.evaluate("sessionStorage.getItem('reloadState')") is None)
        check('沒有頁面錯誤', not errs, str(errs))
        await b.close()
    srv.shutdown()
    print('FAILS:', FAILS)

asyncio.run(main())
