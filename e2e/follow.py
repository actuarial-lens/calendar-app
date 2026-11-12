import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW')
        page = await ctx.new_page(); cdp = await ctx.new_cdp_session(page)
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(600)
        y = (await page.locator('.sheet').bounding_box())['y']
        t = lambda ty, yy=None: cdp.send('Input.dispatchTouchEvent', {'type':ty,'touchPoints':[{'x':330,'y':yy}] if yy is not None else []})
        await t('touchStart', y+40)
        for d in (10, 40, 80):
            await t('touchMove', y+40+d); await page.wait_for_timeout(60)
            print(f'手指下移 {d}px -> 面板下移', round((await page.locator('.sheet').bounding_box())['y']-y,1), '遮罩透明度', await page.locator('.scrim').evaluate('e=>getComputedStyle(e).opacity'))
        await t('touchEnd'); await page.wait_for_timeout(100)
        print('放開(80px，未過門檻90)後 sheet 數', await page.locator('.sheet').count())
        await page.wait_for_timeout(500)
        print('彈回位置差', round((await page.locator('.sheet').bounding_box())['y']-y,1))
        await b.close()
asyncio.run(main())
