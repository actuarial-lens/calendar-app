import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        # 新增每週重複
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title','重複測試')
        await page.locator('.chip', has_text='每週').click()
        print('提示:', await page.locator('.field-hint').inner_text())
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        print('今天看到:', await page.locator('.card .title').all_inner_texts(), '| 標記:', await page.locator('.rep').all_inner_texts())
        # 看一下 7 天後是否有
        counts = await page.evaluate("""async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title==='重複測試').map(x=>x.date).sort())}})}""")
        print('排出的日期:', counts)
        # 左滑刪除 -> 問
        await page.locator('.card', has_text='重複測試').first.evaluate("e=>e.closest('.card-wrap').querySelector('.swipe-actions')&&0")
        btn = page.locator('.card-wrap', has_text='重複測試').locator('.swipe-actions button', has_text='刪除')
        await btn.dispatch_event('click'); await page.wait_for_selector('.del-actions'); await page.wait_for_timeout(500)
        print('刪除詢問:', await page.locator('.sheet-title').inner_text(), await page.locator('.del-actions button').all_inner_texts())
        await page.locator('.btn-ghost', has_text='只刪這一次').click(); await page.wait_for_timeout(700)
        c2 = await page.evaluate("""async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title==='重複測試'&&!x.deletedAt).length)}})}""")
        print('只刪這一次後剩:', c2, '| toast:', await page.locator('.toast').inner_text())
        await page.wait_for_timeout(300)
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(500)
        c3 = await page.evaluate("""async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title==='重複測試'&&!x.deletedAt).length)}})}""")
        print('重新整理後仍是:', c3, '(沒有把刪掉的排回來)')
        # 週列切到下週五，點開編輯，刪全部
        await page.locator('.day').nth(4).click()
        await page.evaluate("0")
        await page.locator('button.range').click(); await page.wait_for_timeout(200)
        await page.locator('.btn-cal').click(); await page.wait_for_selector('.cal-day'); await page.wait_for_timeout(400)
        await page.locator('.scrim').click(position={'x':10,'y':10}); await page.wait_for_timeout(500)
        # 直接用資料找第一個還在的日期並切過去
        d = await page.evaluate("""async()=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title==='重複測試'&&!x.deletedAt).map(x=>x.date).sort()[0])}})}""")
        print('第一筆剩下的日期', d)
        await b.close()
asyncio.run(main())
