import asyncio
from playwright.async_api import async_playwright
URL='http://localhost:4174/calendar-app/?demo=1'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page()
        bad=[]; page.on('response', lambda r: bad.append((r.status, r.url)) if r.status>=400 else None)
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.card')
        reg = await page.evaluate("navigator.serviceWorker.ready.then(r=>({scope:r.scope, active:!!r.active, script:r.active&&r.active.scriptURL}))")
        print('子路徑 SW:', reg)
        man = await page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r=>r.json())")
        print('manifest:', man['name'], man['start_url'], man['scope'], man['display'], [i['src'] for i in man['icons']])
        await page.wait_for_timeout(1500)
        keys = await page.evaluate("caches.keys().then(async ks=>{let n=0;for(const k of ks){n+=(await (await caches.open(k)).keys()).length};return [ks,n]})")
        print('快取:', keys)
        # 重新整理一次讓 SW 控制頁面，再斷網
        await page.reload(); await page.wait_for_selector('.card')
        print('被 SW 控制:', await page.evaluate("!!navigator.serviceWorker.controller"))
        # 新增一筆資料
        await page.fill('#note','離線前記的'); await page.click('.note-input button')
        await page.wait_for_timeout(300)
        await ctx.set_offline(True)
        await page.reload(); await page.wait_for_selector('.card', timeout=10000)
        titles = await page.eval_on_selector_all('.card .title','els=>els.map(e=>e.textContent)')
        notes = await page.eval_on_selector_all('.note-row p','els=>els.map(e=>e.textContent)')
        fonts = await page.evaluate("document.fonts.ready.then(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight))")
        print('離線重新整理後 事項:', titles[:2], '… 隨手記含離線前的:', '離線前記的' in notes)
        print('離線字型已載入:', sorted(set(fonts)))
        # 離線下操作
        await page.fill('#note','離線中記的'); await page.click('.note-input button')
        await page.wait_for_timeout(300)
        print('離線中新增隨手記:', '離線中記的' in await page.eval_on_selector_all('.note-row p','els=>els.map(e=>e.textContent)'))
        await page.screenshot(path='/tmp/shots/offline.png')
        await ctx.set_offline(False)
        print('4xx/5xx 請求:', bad, '| 錯誤:', errs)
        await b.close()
asyncio.run(main())
