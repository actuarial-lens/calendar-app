import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page()
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        n0 = await page.locator('.card-wrap').count()
        await page.locator('.card').first.click()
        await page.wait_for_selector('.sheet')
        await page.wait_for_timeout(500)
        await page.locator('.scrim').click(position={'x':10,'y':10})
        await page.wait_for_timeout(100)
        print('closing 中 overlay:', await page.locator('.overlay.closing').count())
        await page.wait_for_timeout(500)
        print('關閉後 overlay:', await page.locator('.overlay').count())
        # 完成一張 -> 切到未完成分類
        await page.locator('.card').first.evaluate("e=>e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:300,clientY:100,pointerId:1}))")
        await page.wait_for_timeout(50)
        print('pressed class:', await page.locator('.card.pressed').count())
        await page.locator('.card').first.evaluate("e=>e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:300,clientY:100,pointerId:1}))")
        print('卡片數', n0, '錯誤', errs)
        await b.close()
asyncio.run(main())
