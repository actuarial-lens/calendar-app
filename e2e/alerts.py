"""上方提示框：過去的重要未結＋截止日（同一個框，深琥珀色）"""
import asyncio
from playwright.async_api import async_playwright

PUT = """async(rows)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');const s=tx.objectStore('tasks');for(const x of rows)s.put(x);tx.oncomplete=()=>res(true)}})}"""
GET = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title===title))}})}"""
KV = """async([k,v])=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('kv','readwrite');tx.objectStore('kv').put({key:k,value:v});tx.oncomplete=()=>res(true)}})}"""

fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

def task(id, date, title, **kw):
    t = {'id': id, 'date': date, 'time': '15:00', 'category': '待辦', 'title': title, 'note': '', 'done': False, 'delayDays': 0, 'createdAt': 1, 'updatedAt': 1}
    t.update(kw); return t

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
        today = await page.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")
        check('一開始沒有提示框（示範資料沒有重要／截止）', await page.locator('.alerts').count() == 0)

        def add(n):
            return page.evaluate("([d,n])=>{const [y,m,dd]=d.split('-').map(Number);const x=new Date(y,m-1,dd+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')}", [today, n])
        d_3, d_2, d_20, d2, d9 = await add(-3), await add(-2), await add(-20), await add(2), await add(9)
        await page.evaluate(PUT, [
            task('A', d_3, '過去重要A', important=True),
            task('B', d_2, '過去重要B', important=True, time='上午'),
            task('C', d2, '截止C', deadline=True),
            task('D', d_20, '截止過期D', deadline=True),
            task('E', d9, '太遠的截止E', deadline=True),
            task('F', d_2, '過去普通F'),
        ])
        await page.reload(); await page.wait_for_selector('.alerts'); await page.wait_for_timeout(400)
        summary = await page.locator('.alerts-sum').inner_text()
        check('摘要', summary.startswith('過去 2 件重要未結 · 7 天內 1 件截止 · 1 件已過期'), summary)
        color = await page.locator('.alerts-sum').evaluate("e=>getComputedStyle(e).color")
        check('深琥珀色', color == 'rgb(154, 88, 0)', color)
        check('預設收合', await page.locator('.alerts-sum').get_attribute('aria-expanded') == 'false')

        await page.locator('.alerts-sum').click(); await page.wait_for_timeout(400)
        secs = await page.locator('.alerts-sec').all_inner_texts()
        check('兩段', len(secs) == 2 and '過去重要A' in secs[0] and '過去重要B' in secs[0] and '過去普通F' not in secs[0], str(secs))
        dl = await page.locator('.alerts-sec').nth(1).locator('li').all_inner_texts()
        check('截止：已過期在最上面、太遠的不列', len(dl) == 2 and '已過期' in dl[0] and '截止過期D' in dl[0] and '截止C' in dl[1], str(dl))

        # 截止事項的「已完成」
        await page.locator('.alerts li', has_text='截止C').locator('.alerts-done').click(); await page.wait_for_timeout(500)
        c = (await page.evaluate(GET, '截止C'))[0]
        check('已完成', c['done'] is True and await page.locator('.alerts li', has_text='截止C').count() == 0)

        # 全部移至本日：先確認；取消不動
        await page.locator('.alerts-btn', has_text='全部移至本日').click(); await page.wait_for_selector('#confirm-title'); await page.wait_for_timeout(400)
        check('確認視窗', '2 件' in await page.locator('.del-text').inner_text())
        await page.locator('.del-actions .btn-text').click(); await page.wait_for_timeout(500)
        check('取消後沒移', (await page.evaluate(GET, '過去重要A'))[0]['date'] == d_3)
        await page.locator('.alerts-btn', has_text='全部移至本日').click(); await page.wait_for_selector('#confirm-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions .btn-ghost').click(); await page.wait_for_timeout(700)
        a = (await page.evaluate(GET, '過去重要A'))[0]; bb = (await page.evaluate(GET, '過去重要B'))[0]
        check('移到今天、時間不變、延 N 天', a['date'] == today and a['time'] == '15:00' and a['delayDays'] == 3 and bb['time'] == '上午' and bb['delayDays'] == 2)
        check('今天看得到', await page.locator('.card', has_text='過去重要A').locator('.delay').inner_text() == '延 3 天')
        check('重要未結那段消失', await page.locator('.alerts-sec').count() == 1)
        check('toast', '已將 2 件移至今天' in await page.locator('.toast').inner_text())

        # 用「恢復」回原日期 → 又出現在提示框
        card = page.locator('.card-wrap', has_text='過去重要A')
        await page.wait_for_timeout(4500)  # 等 toast 消失
        await card.scroll_into_view_if_needed(); await page.wait_for_timeout(300)
        box = await card.bounding_box(); y = box['y'] + box['height']/2
        await swipe(cdp, box['x']+40, box['x']+260, y); await page.wait_for_timeout(500)
        await card.get_by_role('button', name='恢復').click(); await page.wait_for_timeout(700)
        check('恢復回原日期', (await page.evaluate(GET, '過去重要A'))[0]['date'] == d_3)
        check('又列在重要未結', '過去 1 件重要未結' in await page.locator('.alerts-sum').inner_text())

        # 不再通知
        await page.locator('.alerts-btn', has_text='不再通知').click(); await page.wait_for_timeout(600)
        check('不再通知', (await page.evaluate(GET, '過去重要A'))[0].get('muteOverdue') is True and '重要未結' not in await page.locator('.alerts-sum').inner_text())

        # 已確認：今天收起來、重新整理也不出現；明天（模擬：確認日期改成昨天）再出現
        await page.locator('.alerts-ack').click(); await page.wait_for_timeout(600)
        check('已確認後收起', await page.locator('.alerts').count() == 0)
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(600)
        check('重新整理後仍收起', await page.locator('.alerts').count() == 0)
        await page.evaluate(KV, ['alertsAck', await add(-1)])
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(600)
        check('隔天再出現', await page.locator('.alerts').count() == 1)

        # 編輯面板：截止日切換、卡片字樣
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title', '交報告')
        dlchip = page.locator('.chip', has_text='截止日')
        await dlchip.click(); await page.wait_for_timeout(200)
        check('一般事項直接切換', await dlchip.get_attribute('aria-pressed') == 'true' and await page.locator('#scope-title').count() == 0)
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        tag = page.locator('.card', has_text='交報告').locator('.dl')
        check('卡片「截止」', await tag.inner_text() == '截止' and await tag.evaluate("e=>getComputedStyle(e).color") == 'rgb(154, 88, 0)')
        check('提示框列入', '交報告' in await page.locator('.alerts').inner_text() or '7 天內 1 件截止' in await page.locator('.alerts-sum').inner_text())

        # 重複事項：問範圍
        await page.locator('.btn-new').click(); await page.wait_for_selector('.sheet'); await page.wait_for_timeout(500)
        await page.fill('#ed-title', '月報')
        await page.locator('.chip', has_text='每月').click()
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        await page.locator('.card', has_text='月報').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        await dlchip.click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        check('詢問框', await page.locator('#scope-title').inner_text() == '設為截止日')
        await page.locator('.del-actions button', has_text='未來每一次').click(); await page.wait_for_timeout(400)
        await page.locator('.btn-primary').click(); await page.wait_for_timeout(700)
        rows = [x for x in await page.evaluate(GET, '月報') if not x.get('deletedAt')]
        check('未來每一次都標', len(rows) >= 2 and all(x.get('deadline') and x['repeat'].get('deadline') for x in rows), str(len(rows)))
        check('沒有錯誤', not errs, str(errs))
        await b.close()
    print('FAILS:', fails)

asyncio.run(main())
