import asyncio, datetime, json
from playwright.async_api import async_playwright
TZ = datetime.timezone(datetime.timedelta(hours=8))
URL='http://localhost:4173/?demo=1'

IDB_PUT = """async ([store, rows]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('blue-week'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  await new Promise((res, rej) => { const tx = db.transaction(store,'readwrite'); const s = tx.objectStore(store); rows.forEach(r=>s.put(r)); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  db.close();
}"""

async def new_ctx(b, grant=True):
    ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
    if grant: await ctx.grant_permissions(['notifications'], origin='http://localhost:4173')
    return ctx

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

        # ---- A. 設定頁、空的推播設定 ----
        ctx = await new_ctx(b)
        page = await ctx.new_page()
        errs=[]; reqs=[]
        page.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
        page.on('request', lambda r: reqs.append(r.url) if not r.url.startswith('http://localhost:4173') else None)
        await page.goto(URL); await page.wait_for_selector('.card')
        await page.click('.gear')
        await page.wait_for_selector('.settings')
        txt = await page.inner_text('.settings')
        print('A 設定頁:', [k for k in ['已從主畫面開啟','通知權限','開啟通知','發送測試通知','早上提醒時間','提前提醒','背景提醒：尚未設定','版本 0.3.0','最近刪除'] if k in txt], '| 不該出現的「最近刪除」:', '最近刪除' in txt)
        print('A 預設 早上', await page.input_value('#morning'), '| 提前', await page.eval_on_selector('.chip[aria-pressed=true]','e=>e.textContent'))
        await page.screenshot(path='/tmp/shots/settings.png')
        # 權限不是自動跳的：還沒按之前是 granted（模擬）但設定上沒開
        print('A 權限列:', await page.inner_text('.group .row:nth-child(2)'))
        await page.click('text=發送測試通知')
        await page.wait_for_selector('.row.note')
        print('A 測試通知回應:', await page.inner_text('.row.note'))
        n = await page.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(l=>l.map(x=>x.title))")
        print('A 系統通知:', n)
        await page.click('text=開啟通知')
        await page.wait_for_selector('text=通知已開啟')
        print('A 開啟後:', await page.inner_text('.row.note'), '| 按鈕:', await page.inner_text('.row.buttons button:first-child'))
        # 改設定
        await page.fill('#morning','09:15'); await page.click('.chip:has-text("30")')
        await page.wait_for_timeout(300)
        await page.reload(); await page.wait_for_selector('.card')
        await page.click('.gear'); await page.wait_for_selector('.settings')
        print('A 重開後 早上', await page.input_value('#morning'), '| 提前', await page.eval_on_selector('.chip[aria-pressed=true]','e=>e.textContent'))
        await page.click('.back'); 
        await page.wait_for_timeout(500)
        print('A 外部請求（推播留空應為空）:', reqs, '| 錯誤:', [e for e in errs if 'favicon' not in e])
        await ctx.close()

        # ---- B. 錯過的提醒（關閉 App 期間） ----
        ctx = await new_ctx(b)
        page = await ctx.new_page()
        await page.goto(URL); await page.wait_for_selector('.card')
        now = datetime.datetime.now(TZ)
        today = now.strftime('%Y-%m-%d'); yest=(now-datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        ms = lambda dt: int(dt.timestamp()*1000)
        t_at = lambda h,m: now.replace(hour=h,minute=m,second=0,microsecond=0)
        base = dict(note='', done=False, delayDays=0, createdAt=1, updatedAt=1, category='會議')
        await page.evaluate(IDB_PUT, ['tasks', [
            dict(base, id='miss1', date=today, time='08:00', title='早上的會議'),
            dict(base, id='miss2', date=yest, time='16:00', title='昨天沒做完的事'),
            dict(base, id='future', date=today, time='23:30', title='晚上的事'),
        ]])
        await page.evaluate(IDB_PUT, ['kv', [
            dict(key='settings', value=dict(morningTime='08:30', leadMinutes=10, notificationsEnabled=True, push=dict(endpoint='', vapidPublicKey=''))),
            dict(key='lastSeenAt', value=ms(now - datetime.timedelta(days=1, hours=2))),
        ]])
        await page.reload(); await page.wait_for_selector('.card')
        await page.wait_for_selector('.missed')
        print('B 錯過的提醒:', (await page.inner_text('.missed')).replace('\n',' | '))
        await page.screenshot(path='/tmp/shots/missed.png')
        await page.click('.missed-head button:first-of-type')
        print('B 收合後清單數:', await page.locator('.missed li').count())
        await page.click('.missed-head button:first-of-type')
        # 昨天沒做完 → 已經延到今天
        titles = await page.eval_on_selector_all('.card .title','els=>els.map(e=>e.textContent)')
        print('B 今天事項（昨天的已延到今天）:', titles, '| 延:', await page.eval_on_selector_all('.card .delay','els=>els.map(e=>e.textContent)'))
        await page.click('.missed-head button:nth-of-type(2)')
        print('B 關閉後:', await page.locator('.missed').count())
        # 重新整理不會再出現（已記成已發送）
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(400)
        print('B 重新整理後再出現?', await page.locator('.missed').count())
        await ctx.close()

        # ---- C. App 開著、時間到：跳通知＋App 內顯示，且不重複 ----
        ctx = await new_ctx(b)
        page = await ctx.new_page()
        await page.clock.install(time=datetime.datetime(2026,11,10,13,49,30,tzinfo=TZ))
        await page.goto(URL); await page.wait_for_selector('.card')
        await page.click('.gear'); await page.click('text=開啟通知'); await page.wait_for_selector('text=通知已開啟'); await page.click('.back')
        await page.clock.run_for(25_000)   # 13:49:55
        print('C 13:49:55 banner?', await page.locator('.banner').count())
        await page.clock.run_for(30_000)   # 13:50:25
        await page.wait_for_selector('.banner')
        print('C 13:50 banner:', (await page.inner_text('.banner')).replace('\n',' | '))
        await page.screenshot(path='/tmp/shots/banner.png')
        n = await page.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(l=>l.map(x=>x.title+'|'+x.body))")
        print('C 系統通知:', n)
        await page.click('.banner button')
        await page.clock.run_for(120_000)
        n2 = await page.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(l=>l.length)")
        print('C 再過 2 分鐘 通知數(不應增加):', n2, '| banner:', await page.locator('.banner').count())
        # 完成該事項後，改時間 → 提醒跟著重算
        await ctx.close()

        # ---- D. 點通知跳到那一天 ----
        ctx = await new_ctx(b)
        page = await ctx.new_page()
        await page.goto(URL + '&date=2026-11-12'); await page.wait_for_selector('.card, .empty')
        print('D ?date=2026-11-12 →', await page.inner_text('.day[aria-pressed=true] .n'), '| 網址:', page.url)
        await page.evaluate("navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'open-date',date:'2026-11-13'}}))")
        await page.wait_for_timeout(200)
        print('D 已開著時收到通知點擊 →', await page.inner_text('.day[aria-pressed=true] .n'))
        # 推播 push 事件 → SW 跳通知
        cdp = await ctx.new_cdp_session(page)
        regs=[]
        cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: regs.extend(e.get('registrations',[])))
        await cdp.send('ServiceWorker.enable'); await asyncio.sleep(0.5)
        if regs:
            await cdp.send('ServiceWorker.deliverPushMessage', {'origin':'http://localhost:4173','registrationId':regs[0]['registrationId'],'data':json.dumps({'title':'推播測試','body':'來自伺服器','date':'2026-11-12','id':'x1'})})
            await asyncio.sleep(0.8)
            n = await page.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(l=>l.map(x=>x.title+'|'+x.body+'|'+JSON.stringify(x.data)))")
            print('D 推播事件 →', n)
        else:
            print('D 推播事件: 沒取得 SW registration，略過')
        await ctx.close()
        await b.close()
asyncio.run(main())
