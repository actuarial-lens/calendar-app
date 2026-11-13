"""雲端還原「回到那一天」與「復原這次還原」（0.32.0）：
伺服器上放兩天的備份（昨天 = 甲、乙；今天 = 手機上誤刪乙、改錯甲、新增丙之後又備份的樣子）
→ 選昨天＋「回到那一天」→ 確認視窗 → 刪的回來、改的換回、新增的保留 → 「復原這次還原」→ 回到還原前。
另測：「合併」仍是預設、合併的確認文字不變、面板關閉後沒有復原按鈕、還原後約 30 秒自動上傳、
新按鈕（還原／回到那一天／復原這次還原／完成）文字上下置中（±1px）。
伺服器用 Playwright 的 route 在記憶體裡模擬（內容是真的加密過的）。
先 npm run build 並 npx vite preview --port 4173，再 python3 e2e/cloud_revert.py"""
import datetime, io, json, time
from urllib.parse import urlparse
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173/'
SERVER = 'https://w.example.com'
SCALE = 4
fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra, flush=True)
    if not ok: fails.append(name)

store = {}   # id -> {day: {blob, t}}
puts = []
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS'}

def handler(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    if req.headers.get('authorization') != 'Bearer pw':
        return route.fulfill(status=401, headers=CORS, body='{"error":"unauthorized"}', content_type='application/json')
    body = json.loads(req.post_data or '{}'); path = urlparse(req.url).path; now = int(time.time() * 1000)
    def ok(obj): route.fulfill(status=200, headers=CORS, body=json.dumps(obj), content_type='application/json')
    if path == '/backup/put':
        store.setdefault(body['id'], {})[body['day']] = {'blob': body['blob'], 't': now}
        puts.append((time.time(), body['id'], body['day'])); return ok({'ok': True})
    if path == '/backup/list':
        m = store.get(body['id'], {})
        return ok({'items': [{'day': d, 'updatedAt': v['t'], 'size': len(v['blob'])} for d, v in sorted(m.items(), reverse=True)]})
    if path == '/backup/get':
        v = store.get(body['id'], {}).get(body['day'])
        return ok({'blob': v['blob']}) if v else route.fulfill(status=404, headers=CORS, body='{}', content_type='application/json')
    if path == '/backup/delete':
        store.pop(body['id'], None); return ok({'ok': True})
    route.fulfill(status=404, headers=CORS, body='{}', content_type='application/json')

ALL = """async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.map(x=>({id:x.id,title:x.title,deleted:!!x.deletedAt,updatedAt:x.updatedAt})))}})}"""
SOFT_DELETE = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');const s=tx.objectStore('tasks');const g=s.getAll();g.onsuccess=()=>{const x=g.result.find(t=>t.title===title);x.deletedAt=Date.now();x.updatedAt=Date.now();s.put(x)};tx.oncomplete=()=>res(true)}})}"""
RENAME = """async([from,to])=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');const s=tx.objectStore('tasks');const g=s.getAll();g.onsuccess=()=>{const x=g.result.find(t=>t.title===from);x.title=to;x.updatedAt=Date.now();s.put(x)};tx.oncomplete=()=>res(true)}})}"""

def ink_offset(png, clip_y, box, inset):
    """墨跡中心 − 膠囊中心（px，正 = 字偏下）；和 capsule_center.py 同一個量法"""
    a = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)
    top = (box['y'] - clip_y) * SCALE; hgt = box['height'] * SCALE
    ys0 = int(round(top + inset * SCALE)); ys1 = int(round(top + hgt - inset * SCALE))
    xr = int(min(box['height'] / 2, box['width'] * 0.3) * SCALE)
    x0 = int(round((box['x'] - int(box['x'])) * SCALE)) + xr; x1 = x0 + int(box['width'] * SCALE) - 2 * xr
    reg = a[ys0:ys1, x0:x1]
    vals, counts = np.unique(reg.reshape(-1, 3), axis=0, return_counts=True)
    bg = vals[counts.argmax()]
    rows = np.nonzero((np.abs(reg - bg).sum(axis=2) > 90).any(axis=1))[0]
    if not len(rows): return None
    ink_c = ((rows[0] + ys0) + (rows[-1] + 1 + ys0)) / 2 / SCALE + clip_y
    return ink_c - (box['y'] + box['height'] / 2)

def measure(page, label, sel):
    import math
    el = page.locator(sel).first
    el.evaluate("e=>e.scrollIntoView({block:'center',inline:'nearest'})"); page.wait_for_timeout(150)
    box = el.bounding_box()
    cx, cy = math.floor(box['x']), math.floor(box['y'])
    png = page.screenshot(clip={'x': cx, 'y': cy, 'width': math.ceil(box['width']) + 2, 'height': math.ceil(box['height']) + 2})
    off = ink_offset(png, cy, box, 2.5)
    check(f'置中：{label}', off is not None and abs(off) <= 1.0, f'{off if off is None else round(off, 2)}px 高 {round(box["height"], 1)}px')

def phone(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=SCALE, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
    ctx.route(SERVER + '/**', handler)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE); page.wait_for_selector('.btn-new')
    return ctx, page, errs

def open_settings(page):
    page.click('.gear'); page.wait_for_selector('#push-url'); page.wait_for_timeout(450)

def add_task(page, title):
    page.locator('.btn-new').click(); page.wait_for_selector('#ed-title'); page.wait_for_timeout(450)
    page.fill('#ed-title', title); page.locator('.btn-primary').click(); page.wait_for_timeout(600)

def titles(page):
    return {r['title']: r['deleted'] for r in page.evaluate(ALL)}

def day_label(iso):
    d = datetime.date.fromisoformat(iso)
    return f"{d.month}/{d.day}（{'日一二三四五六'[(d.weekday() + 1) % 7]}）"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx, A, errs = phone(b)

    # ===== 準備：甲、乙 → 開啟雲端備份（第一份 = 昨天的樣子）=====
    add_task(A, '甲'); add_task(A, '乙')
    open_settings(A)
    A.fill('#push-url', SERVER); A.fill('#push-secret', 'pw'); A.wait_for_timeout(400)
    A.click('#cloud-enable'); A.wait_for_selector('#recovery-code'); A.wait_for_timeout(450)
    code = A.get_attribute('#recovery-code', 'data-code')
    A.click('#code-saved'); A.wait_for_selector('#cloud-status'); A.wait_for_timeout(1500)
    check('第一份備份已上傳', len(puts) == 1 and len(store) == 1)
    cid = next(iter(store)); today = next(iter(store[cid]))
    yday = (datetime.date.fromisoformat(today) - datetime.timedelta(days=1)).isoformat()
    store[cid][yday] = dict(store[cid][today])   # 這一份當作「昨天」的備份

    # ===== 今天的誤操作：刪乙、甲改成「改錯了」、新增丙，再備份（今天的備份被蓋成壞的樣子）=====
    A.click('.back'); A.wait_for_timeout(500)
    A.evaluate(SOFT_DELETE, '乙'); A.evaluate(RENAME, ['甲', '改錯了'])
    A.reload(); A.wait_for_selector('.btn-new'); A.wait_for_timeout(500)
    add_task(A, '丙')
    open_settings(A); A.click('#cloud-now'); A.wait_for_timeout(1500)
    check('今天的備份已被蓋成誤操作後的樣子', store[cid][today]['blob'] != store[cid][yday]['blob'])
    bad = titles(A)
    check('誤操作後：乙已刪除、甲改名、丙存在', bad == {'改錯了': False, '乙': True, '丙': False}, str(bad))

    # ===== 還原面板：預設「合併」、說明文字、合併的確認文字不變 =====
    A.click('#cloud-restore'); A.wait_for_selector('#restore-code'); A.wait_for_timeout(450)
    A.click('#restore-lookup'); A.wait_for_selector('.restore-mode'); A.wait_for_timeout(300)
    check('列出兩天的備份', A.locator('.restore-item[data-day]').count() == 2)
    check('還原方式有兩個選項，預設「合併」', A.locator('.restore-mode').count() == 2 and A.locator('.restore-mode[data-mode="merge"]').get_attribute('aria-checked') == 'true' and A.locator('.restore-mode[data-mode="revert"]').get_attribute('aria-checked') == 'false')
    check('合併的說明文字', A.get_by_text('保留這支手機上較新的修改，只補回手機上沒有的。換新手機時用這個。').count() == 1)
    check('回到那一天的說明文字', A.get_by_text('把備份裡的每一筆換回那天的樣子：之後刪掉的會回來、之後改的會換回去；那天之後才新增的會保留。').count() == 1)
    A.screenshot(path='/tmp/shots/cloud_revert_options.png')
    measure(A, '還原按鈕', '#restore-go')
    A.click(f'.restore-item[data-day="{yday}"]'); A.wait_for_timeout(200)
    A.click('#restore-go'); A.wait_for_selector('#restore-confirm')
    ctext = A.inner_text('#restore-confirm')
    check('合併：已有資料先確認，文字不變', ctext.startswith('這支手機已有 ') and ctext.endswith('筆資料。還原會合併進來，不會刪除現有資料；同一筆以較新的修改為準。'), ctext)
    check('合併的確認按鈕叫「確定還原」', A.locator('#restore-confirm-go').inner_text() == '確定還原')
    A.locator('.btn-text', has_text='返回').click(); A.wait_for_timeout(300)
    check('返回後資料沒動', titles(A) == bad)

    # ===== 回到那一天 =====
    A.locator('.restore-mode[data-mode="revert"]').click(); A.wait_for_timeout(200)
    check('選了「回到那一天」', A.locator('.restore-mode[data-mode="revert"]').get_attribute('aria-checked') == 'true' and A.locator('.restore-mode[data-mode="merge"]').get_attribute('aria-checked') == 'false')
    A.click('#restore-go'); A.wait_for_selector('#restore-confirm'); A.wait_for_timeout(300)
    ctext = A.inner_text('#restore-confirm')
    check('回到那一天：確認文字', ctext == f'要把資料回到 {day_label(yday)}的狀態嗎？備份裡有的事項與隨手記會換回那天的內容；那天之後新增的會保留。', ctext)
    check('確認按鈕「回到那一天」「返回」', A.locator('#restore-confirm-go').inner_text() == '回到那一天' and A.locator('.btn-text', has_text='返回').count() == 1)
    A.screenshot(path='/tmp/shots/cloud_revert_confirm.png')
    measure(A, '確認按鈕「回到那一天」', '#restore-confirm-go')
    A.locator('.btn-text', has_text='返回').click(); A.wait_for_timeout(300)
    check('返回後回到清單、資料沒動', A.locator('#restore-go').count() == 1 and titles(A) == bad)
    A.click('#restore-go'); A.wait_for_selector('#restore-confirm-go'); A.click('#restore-confirm-go'); A.wait_for_selector('#restore-result', timeout=15000); A.wait_for_timeout(500)
    res = A.inner_text('#restore-result')
    check('結果文字', res == f'已回到 {day_label(yday)}：換回事項 2、隨手記 0；保留之後新增的事項 1、隨手記 0。', res)
    after = titles(A)
    check('刪掉的乙回來了', after.get('乙') is False)
    check('改錯的標題換回「甲」', after.get('甲') is False and '改錯了' not in after)
    check('今天新增的丙保留', after.get('丙') is False)
    check('還原後只有甲、乙、丙', after == {'甲': False, '乙': False, '丙': False}, str(after))
    check('有「復原這次還原」與「完成」', A.locator('#restore-undo').count() == 1 and A.locator('#restore-done').count() == 1)
    A.screenshot(path='/tmp/shots/cloud_revert_done.png')
    measure(A, '復原這次還原', '#restore-undo')
    measure(A, '完成', '#restore-done')

    # ===== 復原這次還原 =====
    A.click('#restore-undo'); A.wait_for_function("document.querySelector('#restore-result')?.textContent==='已復原到還原之前的狀態。'", timeout=8000); A.wait_for_timeout(300)
    check('復原：訊息正確、復原按鈕消失', A.locator('#restore-undo').count() == 0 and A.locator('#restore-done').count() == 1)
    check('復原：資料回到還原前', titles(A) == bad, str(titles(A)))
    A.click('#restore-done'); A.wait_for_selector('#cloud-message'); A.wait_for_timeout(600)
    check('完成後面板關閉、設定頁顯示訊息', A.locator('#restore-result').count() == 0 and A.inner_text('#cloud-message') == '已復原到還原之前的狀態。')

    # ===== 再還原一次，這次直接關面板：復原按鈕消失，重開面板是全新的 =====
    A.click('#cloud-restore'); A.wait_for_selector('#restore-code'); A.wait_for_timeout(450)
    A.click('#restore-lookup'); A.wait_for_selector('.restore-mode')
    check('重開面板：預設又是「合併」', A.locator('.restore-mode[data-mode="merge"]').get_attribute('aria-checked') == 'true')
    A.click(f'.restore-item[data-day="{yday}"]'); A.locator('.restore-mode[data-mode="revert"]').click()
    n0 = len(puts); t0 = time.time()
    A.click('#restore-go'); A.wait_for_selector('#restore-confirm-go'); A.click('#restore-confirm-go'); A.wait_for_selector('#restore-undo', timeout=15000)
    A.click('#restore-done'); A.wait_for_selector('#cloud-message'); A.wait_for_timeout(600)
    check('完成：訊息留在設定頁', A.inner_text('#cloud-message').startswith('已回到 '))
    A.click('#cloud-restore'); A.wait_for_selector('#restore-code'); A.wait_for_timeout(450)
    check('面板關閉後沒有復原按鈕', A.locator('#restore-undo').count() == 0 and A.locator('#restore-result').count() == 0)
    A.get_by_role('button', name='取消').click(); A.wait_for_timeout(500)
    for _ in range(50):
        if len(puts) > n0: break
        A.wait_for_timeout(1000)
    dt = puts[-1][0] - t0 if len(puts) > n0 else 999
    check('還原後約 30 秒自動上傳', len(puts) == n0 + 1 and 25 <= dt <= 45, f'{dt:.1f}s')

    check('沒有頁面錯誤', not errs, str(errs[:2]))
    b.close()
print('FAILS:', fails)
