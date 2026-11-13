"""雲端備份（0.31.0；0.33.0 加換機提醒與「只在一支手機上開啟」小字）：開啟（先顯示還原碼、按「我已存好」才開啟）、30 秒後自動上傳、重新開啟 App 時補傳、
切到背景立即上傳、換新手機用還原碼還原（含刪除過的、設定）、已有資料時先確認、錯誤訊息、關閉並刪除雲端。
伺服器用 Playwright 的 route 在記憶體裡模擬（內容是真的加密過的）。
先 npm run build 並 npx vite preview --port 4173，再 python3 e2e/cloud_backup.py"""
import json, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173/'
SERVER = 'https://w.example.com'
fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

store = {}   # id -> {day: {blob, t}}
puts = []    # (time, id, day)
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

ALL = """async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.map(x=>({id:x.id,title:x.title,deleted:!!x.deletedAt})))}})}"""
SOFT_DELETE = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');const s=tx.objectStore('tasks');const g=s.getAll();g.onsuccess=()=>{const x=g.result.find(t=>t.title===title);x.deletedAt=Date.now();x.updatedAt=Date.now();s.put(x)};tx.oncomplete=()=>res(true)}})}"""
HIDDEN = "Object.defineProperty(document,'visibilityState',{get:()=>'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'))"

def phone(b, demo):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
    ctx.route(SERVER + '/**', handler)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + ('?demo=1' if demo else '')); page.wait_for_selector('.btn-new')
    if demo: page.wait_for_selector('.card')
    return ctx, page, errs

def open_settings(page):
    page.click('.gear'); page.wait_for_selector('#push-url'); page.wait_for_timeout(450)

def fill_server(page, secret='pw'):
    page.fill('#push-url', SERVER); page.fill('#push-secret', secret)

def add_task(page, title):
    page.locator('.btn-new').click(); page.wait_for_selector('#ed-title'); page.wait_for_timeout(450)
    page.fill('#ed-title', title); page.locator('.btn-primary').click(); page.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ===== A：舊手機 =====
    ctxA, A, errsA = phone(b, True)
    A.wait_for_timeout(500)
    open_settings(A)
    check('沒填伺服器：提示並停用按鈕', A.locator('#cloud-need-config').count() == 1 and A.locator('#cloud-enable').is_disabled() and A.locator('#cloud-restore').is_disabled())
    check('未開啟的說明文字', A.get_by_text('開啟後，資料會加密後自動備份到你的伺服器，換手機時用還原碼取回。').count() == 1)
    fill_server(A)
    A.wait_for_timeout(400)
    check('填好伺服器：提示消失、按鈕可按', A.locator('#cloud-need-config').count() == 0 and A.locator('#cloud-enable').is_enabled())
    A.fill('#morning', '07:10')
    A.wait_for_timeout(300)

    A.click('#cloud-enable'); A.wait_for_selector('#recovery-code'); A.wait_for_timeout(450)
    code = A.get_attribute('#recovery-code', 'data-code')
    shown = A.inner_text('#recovery-code')
    check('還原碼 20 碼、每 4 碼一組', len(code) == 20 and shown == '-'.join(code[i:i+4] for i in range(0, 20, 4)), shown)
    check('警告文字', A.get_by_text('請把還原碼存到密碼管理器或 iCloud 備忘錄。忘記還原碼，雲端備份就無法取回。').count() == 1)
    check('按「我已存好」之前還沒開啟、伺服器沒收到東西', len(puts) == 0 and len(store) == 0)
    A.get_by_role('button', name='取消').click(); A.wait_for_timeout(500)
    check('未開啟：沒有「只在一支手機上開啟」小字', A.locator('#cloud-one-phone').count() == 0)
    check('取消：沒開啟', A.locator('#cloud-enable').count() == 1 and A.locator('#cloud-status').count() == 0 and len(puts) == 0)
    A.click('#cloud-enable'); A.wait_for_selector('#recovery-code'); A.wait_for_timeout(450)
    code = A.get_attribute('#recovery-code', 'data-code')
    A.click('#code-saved'); A.wait_for_selector('#cloud-status'); A.wait_for_timeout(1500)
    check('按「我已存好」：立刻上傳第一份', len(puts) == 1, str(len(puts)))
    st = A.inner_text('#cloud-status')
    check('狀態：上次備份：今天 HH:MM', st.startswith('上次備份：今天 ') and len(st) == len('上次備份：今天 22:40'), st)
    blobs = json.dumps(store)
    check('伺服器上看不到還原碼與事項內容', code not in blobs and 'title' not in blobs and (len(store) == 1))
    check('已開啟：有「同一組還原碼只在一支手機上開啟。」小字', A.locator('#cloud-one-phone').count() == 1 and A.inner_text('#cloud-one-phone') == '同一組還原碼只在一支手機上開啟。')
    check('四個按鈕都在', all(A.locator(s).count() == 1 for s in ['#cloud-now', '#cloud-show', '#cloud-restore', '#cloud-rotate', '#cloud-disable']))
    A.click('#cloud-show'); A.wait_for_selector('#recovery-code'); A.wait_for_timeout(450)
    check('顯示還原碼：同一組', A.get_attribute('#recovery-code', 'data-code') == code)
    A.get_by_role('button', name='關閉', exact=True).last.click(); A.wait_for_timeout(500)
    A.screenshot(path='/tmp/shots/cloud_enabled.png')

    # 新增事項 → 30 秒後才上傳（連續修改合成一次）
    A.click('.back'); A.wait_for_timeout(500)
    n0 = len(puts); t0 = time.time()
    add_task(A, '雲端測試甲')
    A.wait_for_timeout(3000)
    check('修改後 3 秒內還沒上傳', len(puts) == n0)
    for _ in range(50):
        if len(puts) > n0: break
        A.wait_for_timeout(1000)
    dt = puts[-1][0] - t0 if len(puts) > n0 else 999
    check('約 30 秒後自動上傳', len(puts) == n0 + 1 and 27 <= dt <= 42, f'{dt:.1f}s')

    # 刪除過的事項要一起備份；重新開啟 App 時補傳（資料和上次不同）
    A.evaluate(SOFT_DELETE, '雲端測試甲')
    n1 = len(puts)
    A.reload(); A.wait_for_selector('.btn-new'); A.wait_for_timeout(2500)
    check('重新開啟 App：資料有變就立刻補傳', len(puts) == n1 + 1, f'{n1}→{len(puts)}')
    A.reload(); A.wait_for_selector('.btn-new'); A.wait_for_timeout(2500)
    check('重新開啟 App：資料沒變不重傳', len(puts) == n1 + 1)

    # 切到背景：有待上傳的修改就立刻上傳
    n2 = len(puts)
    add_task(A, '雲端測試乙')
    A.wait_for_timeout(500)
    A.evaluate(HIDDEN); A.wait_for_timeout(1500)
    check('切到背景：立刻上傳', len(puts) == n2 + 1, f'{n2}→{len(puts)}')
    A.screenshot(path='/tmp/shots/cloud_a.png')

    # ===== B：全新手機（沒有任何資料）=====
    ctxB, B, errsB = phone(b, False)
    open_settings(B)
    B.fill('#push-url', SERVER); B.fill('#push-secret', 'wrong'); B.wait_for_timeout(300)
    B.click('#cloud-restore'); B.wait_for_selector('#restore-code'); B.wait_for_timeout(450)
    check('還原：沒開啟時輸入框是空的', B.input_value('#restore-code') == '')
    check('空白時「查詢」停用', B.locator('#restore-lookup').is_disabled())
    B.fill('#restore-code', 'ABCD-EFGH'); B.click('#restore-lookup'); B.wait_for_selector('#restore-error')
    check('格式不對的訊息', B.inner_text('#restore-error') == '還原碼格式不對', B.inner_text('#restore-error'))
    B.fill('#restore-code', code); B.click('#restore-lookup'); B.wait_for_function("document.querySelector('#restore-error')?.textContent==='伺服器密碼不正確'", timeout=5000)
    check('密碼錯誤的訊息', B.inner_text('#restore-error') == '伺服器密碼不正確')
    B.get_by_role('button', name='取消').click(); B.wait_for_timeout(500)
    B.fill('#push-secret', 'pw'); B.wait_for_timeout(300)
    B.click('#cloud-restore'); B.wait_for_selector('#restore-code'); B.wait_for_timeout(450)
    other = ('0' if code[0] != '0' else '1') + code[1:]
    B.fill('#restore-code', other); B.click('#restore-lookup'); B.wait_for_selector('#restore-error')
    check('不存在的還原碼：找不到', B.inner_text('#restore-error') == '找不到這組還原碼的備份', B.inner_text('#restore-error'))
    B.fill('#restore-code', code.lower()); B.click('#restore-lookup'); B.wait_for_selector('.restore-item')
    items = B.locator('.restore-item')
    check('列出備份日期，預設選最新一筆', items.count() >= 1 and items.first.get_attribute('aria-checked') == 'true')
    B.screenshot(path='/tmp/shots/cloud_restore_list.png')
    B.click('#restore-go'); B.wait_for_selector('#cloud-message', timeout=15000); B.wait_for_timeout(800)
    msg = B.inner_text('#cloud-message')
    check('空手機直接還原（不用確認），顯示結果', msg.startswith('已還原：新增事項 ') and '這支手機已用這組還原碼開啟雲端備份' in msg, msg)
    rows = B.evaluate(ALL)
    titles = {r['title']: r['deleted'] for r in rows}
    check('空手機還原：結果最後有「關閉舊手機」的提醒（0.33.0）', msg.endswith('如果舊手機還在，請到舊手機的設定 → 雲端備份 →「關閉雲端備份」→ 選「只關閉」，以免它用舊資料蓋掉雲端上的備份。'), msg)
    check('新手機已開啟：設定頁有「同一組還原碼只在一支手機上開啟。」', B.locator('#cloud-one-phone').count() == 1 and B.inner_text('#cloud-one-phone') == '同一組還原碼只在一支手機上開啟。')
    check('事項回來了，含雲端測試乙', titles.get('雲端測試乙') is False, str(len(rows)))
    check('刪除過的事項帶回來但仍是已刪除（沒有復活）', titles.get('雲端測試甲') is True)
    B.get_by_text('每日提醒時間').scroll_into_view_if_needed()
    check('每日提醒時間設定回來了', B.input_value('#morning') == '07:10', B.input_value('#morning'))
    check('伺服器網址與密碼沒被動', B.input_value('#push-url') == SERVER and B.input_value('#push-secret') == 'pw')
    check('這支手機已開啟雲端備份', B.locator('#cloud-status').count() == 1 and B.locator('#cloud-disable').count() == 1)
    B.screenshot(path='/tmp/shots/cloud_b.png')
    B.click('.back'); B.wait_for_timeout(600)
    B.reload(); B.wait_for_selector('.btn-new'); B.wait_for_timeout(500)
    check('重新整理後雲端備份還是開啟', (open_settings(B) or True) and B.locator('#cloud-status').count() == 1)

    # ===== C：手機上已有資料（示範資料）=====
    ctxC, C, errsC = phone(b, True)
    open_settings(C); fill_server(C); C.wait_for_timeout(300)
    before = len([r for r in C.evaluate(ALL) if not r['deleted']])
    C.click('#cloud-restore'); C.wait_for_selector('#restore-code'); C.wait_for_timeout(450)
    C.fill('#restore-code', code); C.click('#restore-lookup'); C.wait_for_selector('.restore-item')
    C.click('#restore-go'); C.wait_for_selector('#restore-confirm')
    ctext = C.inner_text('#restore-confirm')
    check('已有資料：先確認，文字正確', ctext.startswith('這支手機已有 ') and ctext.endswith('筆資料。還原會合併進來，不會刪除現有資料；同一筆以較新的修改為準。'), ctext)
    C.locator('.btn-text', has_text='返回').click(); C.wait_for_timeout(300)
    check('返回後還在清單，資料沒動', C.locator('#restore-go').count() == 1 and len([r for r in C.evaluate(ALL) if not r['deleted']]) == before)
    C.click('#restore-go'); C.wait_for_selector('#restore-confirm-go'); C.click('#restore-confirm-go'); C.wait_for_selector('#cloud-message', timeout=15000)
    after = [r for r in C.evaluate(ALL) if not r['deleted']]
    check('合併：原有的都在，雲端的事項加進來', len(after) >= before and any(r['title'] == '雲端測試乙' for r in after), f'{before}→{len(after)}')

    # ===== 關閉 =====
    n3 = len(store)
    A.click('#cloud-disable') if A.locator('#cloud-disable').count() else (A.click('.gear'), A.wait_for_selector('#cloud-disable'))
    A.wait_for_timeout(450)
    A.click('#cloud-disable'); A.wait_for_selector('#cloud-disable-delete'); A.wait_for_timeout(450)
    A.screenshot(path='/tmp/shots/cloud_disable.png')
    A.click('#cloud-disable-delete'); A.wait_for_selector('#cloud-enable', timeout=8000); A.wait_for_timeout(600)
    check('關閉並刪除：雲端清空、回到未開啟', len(store) == n3 - 1 and A.locator('#cloud-status').count() == 0, f'{n3}→{len(store)}')
    check('關閉後訊息', '已關閉雲端備份，雲端上的備份已刪除。' in A.inner_text('#cloud-message'))

    errs = errsA + errsB + errsC
    check('沒有頁面錯誤', not errs, str(errs[:2]))
    b.close()
print('FAILS:', fails)
