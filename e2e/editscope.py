"""重複事項改標題／時間／分類／提前提醒時，按「儲存」會問「僅限這次／未來每一次／取消」（錯誤 7）。"""
import asyncio
from playwright.async_api import async_playwright

DB = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title.startsWith(title)&&!x.deletedAt).sort((a,b)=>a.date<b.date?-1:1).map(x=>[x.date,x.title,x.time,x.repeat&&x.repeat.tpl&&x.repeat.tpl.time]))}})}"""

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

        async def open_card(title):
            await page.locator('.card', has_text=title).first.click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        async def save():
            await page.locator('.btn-primary').click(); await page.wait_for_timeout(500)

        # 新增每週重複、指定 10:00
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title', '例會')
        await page.locator('.chip', has_text='每週').click()
        await save(); await page.wait_for_timeout(300)
        rows = await page.evaluate(DB, '例會')
        check('排出多筆', len(rows) >= 8, str(len(rows)))

        # 1. 只改日期：不問，直接存
        await open_card('例會')
        await page.locator('.chip', has_text='明天').click()
        await save()
        check('只改日期不問', await page.locator('#scope-title').count() == 0 and await page.locator('#ed-title').count() == 0)
        await page.locator('.toast button').click(); await page.wait_for_timeout(600)  # 復原

        # 2. 改標題 → 問 → 取消：回到編輯面板，沒存
        await open_card('例會')
        await page.fill('#ed-title', '例會A')
        await save()
        check('改標題會問', await page.locator('#scope-title').inner_text() == '修改重複事項')
        check('三個按鈕', await page.locator('.del-actions button').all_inner_texts() == ['僅限這次', '未來每一次', '取消'])
        await page.locator('.del-actions .btn-text', has_text='取消').click(); await page.wait_for_timeout(500)
        check('取消後還在編輯面板', await page.locator('#ed-title').count() == 1)
        check('取消後沒存', all(r[1] == '例會' for r in await page.evaluate(DB, '例會')))

        # 3. 僅限這次
        await save(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions button', has_text='僅限這次').click(); await page.wait_for_timeout(700)
        rows = await page.evaluate(DB, '例會')
        check('僅限這次只改一筆', [r[1] for r in rows].count('例會A') == 1 and rows[0][1] == '例會A', str(rows[:3]))

        # 4. 未來每一次：改下一筆（下週）的時間為 15:00 → 這筆以後都改，今天那筆不變
        nxt = rows[1][0]
        await page.locator('.btn-cal').click(); await page.wait_for_selector('.cal-day'); await page.wait_for_timeout(400)
        m, d = int(nxt[5:7]), int(nxt[8:])
        cell = page.locator(f'.cal-day[aria-label^="{m}月{d}日"]')
        if await cell.count() == 0:
            await page.locator('.cal-nav[aria-label="下個月"]').click(); await page.wait_for_timeout(300)
        await cell.click(); await page.wait_for_timeout(600)
        await open_card('例會')
        await page.locator('.chip', has_text='指定').click(); await page.wait_for_timeout(300)
        # 時間改成「指定」（預設 09:00），標題也改
        await page.fill('#ed-title', '例會B')
        await save(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions button', has_text='未來每一次').click(); await page.wait_for_timeout(700)
        rows = await page.evaluate(DB, '例會')
        titles = [r[1] for r in rows]
        check('未來每一次：之前那筆不變', titles[0] == '例會A', str(titles))
        check('未來每一次：這筆以後全改', all(t == '例會B' for t in titles[1:]), str(titles))
        times = [r[2] for r in rows]
        check('時間跟著改成指定（09:00）', all(t == '09:00' for t in times[1:]) and times[0] == '', str(times))
        check('整組範本也改', all(r[3] == '09:00' for r in rows[1:]))
        check('toast', await page.locator('.toast').inner_text() != '')

        # 5. 重新整理後補排的也是新內容
        await page.reload(); await page.wait_for_selector('.app'); await page.wait_for_timeout(800)
        rows2 = await page.evaluate(DB, '例會')
        check('重新整理後一致', rows2 == rows)
        check('沒有錯誤', not errs, str(errs))
        await b.close()
    print('FAILS:', fails)

asyncio.run(main())
