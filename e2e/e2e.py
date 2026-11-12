import re
import asyncio, json
from playwright.async_api import async_playwright

URL='http://localhost:4173/?demo=1'
async def touch(cdp, pts):
    # pts: list of (x,y) ; first=start, last=end
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':pts[0][0],'y':pts[0][1]}]})
    for x,y in pts[1:]:
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y}]})
        await asyncio.sleep(0.016)
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    await asyncio.sleep(0.4)

def line(a,b,n=12):
    return [(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(n+1)]

async def center(page, sel, nth=0):
    box = await page.locator(sel).nth(nth).bounding_box()
    return box['x']+box['width']/2, box['y']+box['height']/2, box

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page()
        errs=[]
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        cdp = await ctx.new_cdp_session(page)
        await page.goto(URL); await page.wait_for_selector('.card')
        titles = lambda: page.eval_on_selector_all('.card .title','els=>els.map(e=>e.textContent)')
        print('初始', await titles())

        # 1. 垂直捲動不會誤觸左滑
        x,y,_ = await center(page,'.card',0)
        sy = await page.evaluate("document.querySelector('.main').scrollTop")
        await touch(cdp, line((x,y),(x+2,y-150)))
        sy2 = await page.evaluate("document.querySelector('.main').scrollTop")
        tx = await page.evaluate("document.querySelector('.card').style.transform")
        print('垂直滑動：scrollTop', sy,'->',sy2,'| card transform', tx, '| editor open?', await page.locator('.sheet').count())
        await page.evaluate("document.querySelector('.main').scrollTop=0")

        # 2. 左滑 >一半 → 打開；<一半 → 彈回
        x,y,box = await center(page,'.card',0)
        await touch(cdp, line((x+60,y),(x-120,y+3)))   # 180px > 96 (一半 of 192)
        print('左滑 180px 後 transform:', await page.evaluate("document.querySelector('.card').style.transform"))
        await page.screenshot(path='/tmp/shots/swipe-open.png')
        # 點別處收合
        await touch(cdp, [(200,40)])
        print('點別處後:', await page.evaluate("document.querySelector('.card').style.transform"))
        await touch(cdp, line((x+60,y),(x+10,y+2)))     # 50px < 96 → 彈回
        print('左滑 50px 後:', await page.evaluate("document.querySelector('.card').style.transform"))

        # 3. 同時只有一列打開
        await touch(cdp, line((x+60,y),(x-120,y)))
        x2,y2,_ = await center(page,'.card',1)
        await touch(cdp, line((x2+60,y2),(x2-120,y2)))
        opened = await page.eval_on_selector_all('.card','els=>els.map(e=>e.style.transform)')
        print('第二列打開後各卡 transform:', opened)
        await touch(cdp, [(200,40)])

        # 4. 完成 → toast → 復原
        x,y,_ = await center(page,'.card',0)
        await touch(cdp, line((x+60,y),(x-120,y)))
        btns = await page.eval_on_selector_all('.card-wrap:nth-child(1) .swipe-actions button','els=>els.map(e=>e.textContent)')
        print('未完成卡按鈕順序:', btns)
        await page.locator('.card-wrap').nth(0).locator('.swipe-actions button', has_text='完成').click()
        await page.wait_for_selector('.toast')
        print('完成後:', await page.inner_text('.toast'), await titles())
        await page.screenshot(path='/tmp/shots/toast.png')
        await page.click('.toast button')
        await page.wait_for_timeout(300)
        print('復原後:', await titles(), 'toast gone:', await page.locator('.toast').count()==0)

        # 5. 延後
        await touch(cdp, line((x+60,y),(x-120,y)))
        await page.locator('.card-wrap').nth(0).locator('.swipe-actions button', has_text='延後').click()
        await page.wait_for_selector('.toast')
        print('延後:', await page.inner_text('.toast'), '| 今天剩', await titles())
        await page.click('.toast button'); await page.wait_for_timeout(300)

        # 6. 刪除在最右邊、軟刪除、復原
        lastbtn = await page.eval_on_selector('.card-wrap:nth-child(1) .swipe-actions button:last-child','e=>e.textContent')
        print('最右邊按鈕:', lastbtn)
        await touch(cdp, line((x+60,y),(x-120,y)))
        await page.locator('.card-wrap').nth(0).locator('.swipe-actions button', has_text='刪除').click()
        await page.wait_for_selector('.toast')
        n_after = len(await titles())
        await page.click('.toast button'); await page.wait_for_timeout(300)
        print('刪除後張數', n_after, '復原後', len(await titles()))

        # 7. 點卡片 → 編輯 → 儲存改日期（明天）
        x,y,_ = await center(page,'.card',0)
        await touch(cdp, [(x,y)])
        print('點卡片開編輯:', await page.locator('.sheet').count()==1, '標題欄:', await page.input_value('#ed-title'))
        await page.screenshot(path='/tmp/shots/edit.png')
        await page.click('.chip:has-text("明天")')
        await page.fill('#ed-title','廠商報價（改）')
        await page.click('.btn-primary')
        await page.wait_for_selector('.toast')
        print('改日期:', await page.inner_text('.toast'), '| 今天剩', await titles())
        await page.click('.toast button'); await page.wait_for_timeout(300)
        print('復原:', await titles())

        # 8. 新增（空白不能存）
        await page.click('.btn-new')
        dis = await page.eval_on_selector('.btn-primary','e=>e.disabled')
        print('新增面板:', await page.inner_text('.sheet-title'), '空白時儲存鈕 disabled =', dis, '按鈕字:', await page.inner_text('.btn-primary'))
        await page.fill('#ed-title','寄合約')
        await page.click('.chip:has-text("指定")')
        for col, text in ((0,'上午'),(1,'10'),(2,'30')):
            await page.locator('.wheel-col').nth(col).locator('.wheel-item', has_text=re.compile('^'+text+'$')).click()
            await page.wait_for_timeout(700)
        await page.click('.chip:has-text("私人")')
        await page.click('.chip:has-text("後天")')
        await page.screenshot(path='/tmp/shots/new.png')
        await page.click('.btn-primary')
        await page.wait_for_selector('.toast')
        print('新增:', await page.inner_text('.toast'))
        await page.click('.toast button'); await page.wait_for_timeout(300)

        # 9. 隨手記 轉待辦
        notes0 = await page.locator('.note-row').count()
        nx,ny,_ = await center(page,'.note-row',0)
        await page.evaluate("document.querySelector('.note-row').scrollIntoView({block:'center'})")
        nx,ny,_ = await center(page,'.note-row',0)
        await touch(cdp, line((nx+80,ny),(nx-150,ny)))
        nb = await page.eval_on_selector_all('.note-wrap:nth-of-type(1) .swipe-actions button','els=>els.map(e=>e.textContent)')
        print('隨手記按鈕:', nb)
        await page.locator('.note-wrap').nth(0).locator('.swipe-actions button', has_text='轉待辦').click()
        await page.wait_for_selector('.toast')
        print('轉待辦:', await page.inner_text('.toast'), '| 隨手記', notes0,'->', await page.locator('.note-row').count(), '| 事項', await titles())
        await page.click('.toast button'); await page.wait_for_timeout(300)
        print('復原後: 隨手記', await page.locator('.note-row').count(), '| 事項', await titles())

        # 10. 月曆
        await page.click('.btn-cal')
        print('月曆標題:', await page.inner_text('.cal-sheet h2'))
        await page.screenshot(path='/tmp/shots/cal.png')
        await page.click('.cal-nav[aria-label="下個月"]')
        print('下個月:', await page.inner_text('.cal-sheet h2'))
        await page.click('.cal-day:has-text("20")')
        print('選 12/20 後頂部:', await page.inner_text('.range'), '月曆關閉:', await page.locator('.cal-sheet').count()==0)
        await page.click('.btn-cal'); await page.click('.cal-today')
        print('回到今天:', await page.inner_text('.range'), '選中日:', await page.inner_text('.day[aria-pressed=true] .n'))

        print('錯誤訊息:', errs)
        await b.close()
asyncio.run(main())
