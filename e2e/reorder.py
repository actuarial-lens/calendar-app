import asyncio
from playwright.async_api import async_playwright
URL='http://localhost:4173/?demo=1'
ORDER = "()=>[...document.querySelectorAll('.collapse:not(.exit) .card .title')].map(e=>e.innerText)"

async def long_drag(cdp, page, x, y0, y1, steps=12, shot=None):
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y0}]})
    await page.wait_for_timeout(650)  # 長按
    for i in range(1, steps+1):
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y0+(y1-y0)*i/steps}]})
        await page.wait_for_timeout(16)
    if shot: await page.screenshot(path=shot)
    lifted = await page.locator('.collapse.lifted').count()
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    await page.wait_for_timeout(700)
    return lifted

async def center(page, title):
    bx = await page.locator('.card', has_text=title).bounding_box()
    return bx['x']+bx['width']/2, bx['y']+bx['height']/2

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); cdp = await ctx.new_cdp_session(page)
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.card')
        print('原本:', await page.evaluate(ORDER))

        # 下午組：把最後一張拖到最上面
        x, y = await center(page, '幫家人訂週末餐廳')
        x0, top = await center(page, '廠商報價')
        lifted = await long_drag(cdp, page, x, y, top - 20, shot='/tmp/drag.png')
        print('拖動中有拿起來:', lifted)
        print('拖到最上:', await page.evaluate(ORDER), '| 編輯面板?', await page.locator('.sheet').count(), '| toast:', await page.locator('.toast').count())

        # 新增上午事項
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title','早上任務'); await page.locator('.chip', has_text='上午').click()
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(800)
        print('加上午後:', await page.evaluate(ORDER))

        # 上午那張往下拖很遠：不能跨到下午組
        x, y = await center(page, '早上任務')
        await long_drag(cdp, page, x, y, y + 400)
        print('上午往下拖:', await page.evaluate(ORDER))

        # 下午組內：第一張拖到第三張的位置
        x, y = await center(page, '幫家人訂週末餐廳')
        _, y3 = await center(page, '與設計組對稿')
        await long_drag(cdp, page, x, y, y3 + 10)
        print('往下兩格:', await page.evaluate(ORDER))

        # 重新整理還在
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(500)
        print('重新整理後:', await page.evaluate(ORDER))

        # 沒有長按、直接上下滑：不會拿起來，順序不變
        before = await page.evaluate(ORDER)
        x, y = await center(page, '廠商報價')
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        lifted = 0
        for i in range(1, 9):
            await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y+25*i}]})
            await page.wait_for_timeout(100)
            lifted += await page.locator('.collapse.lifted').count()
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]}); await page.wait_for_timeout(500)
        print('直接滑動不會拿起:', lifted == 0, '| 順序不變:', before == await page.evaluate(ORDER))

        # 一般點一下還是打開編輯
        await page.locator('.card', has_text='廠商報價').click(); await page.wait_for_timeout(500)
        print('點一下開編輯:', await page.locator('#ed-title').count())
        print('errors:', errs)
        await b.close()
asyncio.run(main())
