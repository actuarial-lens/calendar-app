import asyncio
from playwright.async_api import async_playwright

DB = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title===title&&!x.deletedAt).sort((a,b)=>a.date<b.date?-1:1).map(x=>[x.date,!!x.important,!!(x.repeat&&x.repeat.important)]))}})}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        imp = page.locator('.chip', has_text='高度重要性')

        # 1. 一般事項：直接切換，不跳框
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title','一般重要')
        await imp.click(); await page.wait_for_timeout(200)
        print('一般：跳框?', await page.locator('#scope-title').count(), '| 按下?', await imp.get_attribute('aria-pressed'))
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        card = page.locator('.card', has_text='一般重要')
        print('卡片:', await card.locator('.row1 .left').inner_text(), '| 顏色:', await card.locator('.imp').evaluate("e=>getComputedStyle(e).color"))

        # 2. 新增每週重複（不重要）
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title','週會')
        await page.locator('.chip', has_text='每週').click()
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        print('排出:', await page.evaluate(DB, '週會'))

        # 3. 打開，點重要 -> 跳框；按取消 -> 維持原狀
        await page.locator('.card', has_text='週會').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        await imp.click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        print('詢問框:', await page.locator('#scope-title').inner_text(), await page.locator('.del-actions button').all_inner_texts())
        await page.locator('.del-actions .btn-text', has_text='取消').click(); await page.wait_for_timeout(500)
        print('取消後 按下?', await imp.get_attribute('aria-pressed'), '| 編輯面板還在?', await page.locator('#ed-title').count())

        # 4. 點重要 -> 未來每一次，但編輯面板按取消 -> 不生效
        await imp.click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions button', has_text='未來每一次').click(); await page.wait_for_timeout(500)
        print('選完 按下?', await imp.get_attribute('aria-pressed'))
        await page.locator('.sheet-actions .btn-ghost', has_text='取消').click(); await page.wait_for_timeout(600)
        print('面板取消後資料:', await page.evaluate(DB, '週會'))

        # 5. 再來一次，未來每一次 + 儲存
        await page.locator('.card', has_text='週會').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        await imp.click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions button', has_text='未來每一次').click(); await page.wait_for_timeout(500)
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        print('未來每一次:', await page.evaluate(DB, '週會'))
        print('卡片:', await page.locator('.card', has_text='週會').locator('.row1 .left').inner_text())

        # 6. 取消重要 -> 僅限這次
        await page.locator('.card', has_text='週會').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        await imp.click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        print('詢問框:', await page.locator('#scope-title').inner_text())
        await page.locator('.del-actions button', has_text='僅限這次').click(); await page.wait_for_timeout(500)
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        print('僅限這次取消:', await page.evaluate(DB, '週會'))
        print('卡片有重要?', await page.locator('.card', has_text='週會').locator('.imp').count())
        print('errors:', errs)
        await b.close()
asyncio.run(main())
