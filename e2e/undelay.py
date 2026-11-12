"""延後事項：由左向右滑 → 「恢復」按鈕；不自動延後；早上提醒開關"""
import asyncio
from playwright.async_api import async_playwright
async def swipe(cdp, x0, x1, y, steps=8):
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x0,'y':y}]})
    for i in range(1, steps+1):
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x0+(x1-x0)*i/steps,'y':y}]})
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); cdp = await ctx.new_cdp_session(page); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        # 示範資料裡有一筆「延 1 天」的事項；先找到它
        card = page.locator('.card-wrap', has=page.locator('.delay')).first
        await card.scroll_into_view_if_needed()
        n_delay = await page.locator('.delay').count()
        print('延後事項數:', n_delay, '| 沒延後的卡片沒有「恢復」按鈕:', await page.locator('.card-wrap:not(:has(.delay)) .swipe-actions.start').count())
        box = await card.bounding_box(); y = box['y'] + box['height']/2
        title = await card.locator('.title').inner_text()
        # 右滑
        await swipe(cdp, box['x']+40, box['x']+260, y); await page.wait_for_timeout(500)
        tx = await card.locator('.card').evaluate("e => getComputedStyle(e).transform")
        print('右滑後位移:', tx)
        assert 'matrix(1, 0, 0, 1, 64' in tx, tx
        await card.get_by_role('button', name='恢復').click(); await page.wait_for_timeout(600)
        await page.wait_for_selector('text=已恢復到')
        print('提示:', await page.locator('.toast').inner_text())
        print('恢復後延後事項數:', await page.locator('.delay').count(), '(應少 1)')
        assert await page.locator('.delay').count() == n_delay - 1
        # 恢復後這一筆已不在今天（回到原本的那天）
        # 復原
        await page.locator('.toast button').click(); await page.wait_for_timeout(500)
        assert await page.locator('.delay').count() == n_delay
        print('復原後又回到延後狀態: OK')
        # 向左滑仍是原本的三個按鈕
        card = page.locator('.card-wrap', has=page.locator('.delay')).first
        box = await card.bounding_box(); y = box['y'] + box['height']/2
        await swipe(cdp, box['x']+300, box['x']+60, y); await page.wait_for_timeout(500)
        print('左滑按鈕:', await card.locator('.swipe-actions:not(.start) button').all_inner_texts())
        # 設定：早上提醒開關
        await page.locator('.gear').click(); await page.wait_for_selector('#morning')
        assert await page.locator('#morning').is_enabled()
        await page.get_by_role('button', name='關', exact=True).click(); await page.wait_for_timeout(300)
        assert await page.locator('#morning').is_disabled()
        await page.reload(); await page.locator('.gear').click(); await page.wait_for_selector('#morning')
        assert await page.locator('#morning').is_disabled(), '重開後仍是關'
        await page.get_by_role('button', name='開', exact=True).click(); await page.wait_for_timeout(300)
        assert await page.locator('#morning').is_enabled()
        print('早上提醒開關: OK | 錯誤', errs)
        await b.close()
asyncio.run(main())
