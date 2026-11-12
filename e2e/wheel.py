import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); cdp = await ctx.new_cdp_session(page); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        # 編輯「與設計組對稿」(14:00)
        await page.locator('.card', has_text='與設計組對稿').click(); await page.wait_for_selector('.wheel'); await page.wait_for_timeout(600)
        sel = lambda: page.evaluate("[...document.querySelectorAll('.wheel-item.on')].map(e=>e.textContent)")
        print('開啟時選中:', await sel())
        # 觸控往上滑分鐘欄（手指往上 = 選到更大的值）
        box = await page.locator('.wheel-col').nth(2).bounding_box()
        x=box['x']+box['width']/2; y=box['y']+box['height']/2
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for i in range(1,9): await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y-i*10}]})
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        await page.wait_for_timeout(900)
        print('滑動分鐘欄後:', await sel(), '| 面板仍開著(沒被當成下拉關閉):', await page.locator('.sheet').count())
        # 點選上午
        await page.locator('.wheel-col').nth(0).locator('.wheel-item', has_text='上午').click(); await page.wait_for_timeout(900)
        print('點上午後:', await sel())
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        print('儲存後卡片時間:', await page.locator('.card', has_text='與設計組對稿').locator('.time').inner_text())
        # 重新開啟確認帶入
        await page.locator('.card', has_text='與設計組對稿').click(); await page.wait_for_selector('.wheel'); await page.wait_for_timeout(600)
        print('重開帶入:', await sel(), '錯誤', errs)
        await b.close()
asyncio.run(main())
