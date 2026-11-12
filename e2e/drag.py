import asyncio
from playwright.async_api import async_playwright
URL='http://localhost:4173/?demo=1'
async def drag(cdp, x, y0, y1, steps=8):
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y0}]})
    for i in range(1, steps+1):
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y0+(y1-y0)*i/steps}]})
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); cdp = await ctx.new_cdp_session(page)
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.card')
        for name, opener in [('新增', '.btn-new'), ('月曆', '.btn-cal'), ('編輯', '.card')]:
            await page.locator(opener).first.click()
            await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
            box = await page.locator('.sheet').bounding_box()
            # 從面板中間偏上（標題旁空白處）往下拖
            await drag(cdp, 330, box['y']+40, box['y']+40+60)
            await page.wait_for_timeout(450)
            print(name, '拖 60px 後仍開著:', await page.locator('.sheet').count())
            box = await page.locator('.sheet').bounding_box()
            await drag(cdp, 330, box['y']+40, box['y']+40+200)
            await page.wait_for_timeout(600)
            print(name, '拖 200px 後關閉:', await page.locator('.sheet').count() == 0)
        # 膠囊文字偏移
        await page.locator('.btn-new').click(); await page.wait_for_selector('.chip'); await page.wait_for_timeout(500)
        r = await page.evaluate("""()=>[...document.querySelectorAll('.chip, .tag')].slice(0,3).map(el=>{const rg=document.createRange();rg.selectNodeContents(el);const a=rg.getBoundingClientRect(),c=el.getBoundingClientRect();return +(((a.top+a.bottom)/2)-((c.top+c.bottom)/2)).toFixed(2)})""")
        print('文字中心偏移(px, 負=偏上):', r, '錯誤', errs)
        await b.close()
asyncio.run(main())
