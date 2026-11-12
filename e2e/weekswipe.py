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
        info = lambda: page.evaluate("[document.querySelector('.range').textContent, document.querySelector('.day[aria-pressed=true] .wk').textContent+document.querySelector('.day[aria-pressed=true] .n').textContent]")
        y = (await page.locator('.week').bounding_box())['y']+30
        print('起始:', await info())
        await swipe(cdp, 300, 120, y); await page.wait_for_timeout(500)
        print('向左滑(下一週):', await info())
        await swipe(cdp, 100, 300, y); await page.wait_for_timeout(500)
        await swipe(cdp, 100, 300, y); await page.wait_for_timeout(500)
        print('向右滑兩次(上上週):', await info())
        await swipe(cdp, 200, 215, y, 3); await page.wait_for_timeout(400)
        print('只滑 15px 不換週:', await info())
        # 點選日期仍可用
        await page.locator('.day').nth(2).click(); await page.wait_for_timeout(300)
        print('點週三:', await info())
        # 剛滑完不該把放開當成點選
        await swipe(cdp, 300, 120, y); await page.wait_for_timeout(500)
        print('再向左滑，選中日應是下週三:', await info(), '| 錯誤', errs)
        await b.close()
asyncio.run(main())
