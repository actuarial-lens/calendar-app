"""週列與月曆：依當天未完成件數顯示深淺（取代小點；隨手記不算）"""
import asyncio
from playwright.async_api import async_playwright

PUT = """async([store,rows])=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction(store,'readwrite');const s=tx.objectStore(store);s.clear();for(const x of rows)s.put(x);tx.oncomplete=()=>res(true)}})}"""

fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        # 這一週的日期
        week = await page.evaluate("""()=>{const d=new Date();const i=(d.getDay()+6)%7;return [...Array(7)].map((_,k)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-i+k);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')})}""")
        # 週一 0 件、週二 1 件（另有已完成與刪除的）、週三 3 件、週四 5 件、週五只有隨手記、週六 2 件
        t = lambda i, d, **k: {'id': i, 'date': d, 'time': '', 'category': '待辦', 'title': i, 'note': '', 'done': False, 'delayDays': 0, 'createdAt': 1, 'updatedAt': 1, **k}
        rows = [t('m-done', week[0], done=True), t('t1', week[1]), t('t-del', week[1], deletedAt=1)]
        rows += [t(f'w{k}', week[2]) for k in range(3)] + [t(f'h{k}', week[3]) for k in range(5)] + [t('s1', week[5]), t('s2', week[5])]
        await page.evaluate(PUT, ['tasks', rows])
        await page.evaluate(PUT, ['notes', [{'id': 'n1', 'date': week[4], 'text': '隨手記', 'createdAt': 1, 'updatedAt': 1}]])
        await page.reload(); await page.wait_for_selector('.week .day'); await page.wait_for_timeout(500)
        # 選到週日（沒有任何事項）那天，讓週一到週六都不是選中狀態
        await page.locator('.week .day').nth(6).click(); await page.wait_for_timeout(400)
        cls = await page.evaluate("""()=>[...document.querySelectorAll('.week .day')].map(b=>b.className)""")
        check('週列分級', cls[:6] == ['day lv0', 'day lv1', 'day lv2', 'day lv3', 'day lv0', 'day lv1'], str(cls))
        check('沒有小點', await page.locator('.dot').count() == 0)
        bgs = await page.evaluate("""()=>[...document.querySelectorAll('.week .day')].slice(0,4).map(b=>getComputedStyle(b).backgroundColor)""")
        check('由淺到深', bgs[0] == 'rgba(0, 0, 0, 0)' and len(set(bgs)) == 4, str(bgs))
        await page.locator('.week .day').nth(3).click(); await page.wait_for_timeout(400)
        check('選中的那天維持深藍', await page.locator('.week .day').nth(3).evaluate("e=>getComputedStyle(e).backgroundColor") == 'rgb(46, 74, 107)')

        # 完成一件 → 週三從 3 件變 2 件（lv2 → lv1）
        await page.locator('.week .day').nth(2).click(); await page.wait_for_timeout(500)
        await page.locator('.card-wrap', has_text='w0').get_by_role('button', name='完成').dispatch_event('click'); await page.wait_for_timeout(600)
        await page.locator('.week .day').nth(6).click(); await page.wait_for_timeout(400)
        check('完成後變淺（確認）', await page.locator('.week .day').nth(2).get_attribute('class') == 'day lv1')

        # 月曆
        await page.locator('.btn-cal').click(); await page.wait_for_selector('.cal-day'); await page.wait_for_timeout(500)
        def lab(iso): return f'{int(iso[5:7])}月{int(iso[8:])}日'
        cc = []
        for iso in week[:6]:
            cell = page.locator(f'.cal-day[aria-label^="{lab(iso)}"]')
            cc.append(await cell.get_attribute('class') if await cell.count() else 'other-month')
        print('月曆:', cc)
        expect = ['lv0', 'lv1', 'lv1', 'lv3', 'lv0', 'lv1']
        check('月曆分級', all(c == 'other-month' or e in c.split() for c, e in zip(cc, expect)))
        check('沒有錯誤', not errs, str(errs))
        await page.screenshot(path='/tmp/heat.png')
        await b.close()
    print('FAILS:', fails)

asyncio.run(main())
