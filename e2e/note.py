"""備註欄位（0.29.0）：新增、卡片顯示（保留換行、最多 3 行）、編輯保留、重複事項問範圍。
先 npm run build 並 npx vite preview --port 4173，再 python3 e2e/note.py"""
import asyncio
from playwright.async_api import async_playwright

DB = """async(title)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('tasks').objectStore('tasks').getAll();t.onsuccess=()=>res(t.result.filter(x=>x.title.startsWith(title)&&!x.deletedAt).sort((a,b)=>a.date<b.date?-1:1).map(x=>[x.date,x.title,x.note]))}})}"""

fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')

        async def new_sheet():
            await page.locator('.btn-new').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        async def open_card(title):
            await page.locator('.card', has_text=title).first.click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(500)
        async def save():
            await page.locator('.btn-primary').click(); await page.wait_for_timeout(600)
        async def area():
            return await page.evaluate("(()=>{const e=document.getElementById('ed-note');const c=getComputedStyle(e);return {h:e.getBoundingClientRect().height,lh:parseFloat(c.lineHeight),fs:parseFloat(c.fontSize),ph:e.placeholder,max:e.maxLength,rows:e.rows,sh:e.scrollHeight,ch:e.clientHeight,oy:c.overflowY,bw:parseFloat(c.borderTopWidth)}})()")

        # 1. 備註欄位：位置、placeholder、預設 2 行、maxLength
        await new_sheet()
        labels = await page.locator('.field-label').all_inner_texts()
        check('「備註」在「事項」下面', labels[:2] == ['事項', '備註'], str(labels[:3]))
        a = await area()
        check('placeholder', a['ph'] == '地點、要帶的東西…（選填）', a['ph'])
        check('maxLength 1000', a['max'] == 1000)
        two = a['lh'] * 2 + 22 + 2
        check('預設 2 行高', abs(a['h'] - two) <= 1, f"h={a['h']:.1f} 期望≈{two:.1f}")
        title_h = await page.evaluate("document.getElementById('ed-title').getBoundingClientRect().height")
        sty = await page.evaluate("(()=>{const f=(id)=>{const c=getComputedStyle(document.getElementById(id));return [c.borderTopColor,c.borderRadius,c.backgroundColor,c.fontSize,c.paddingLeft].join('|')};return [f('ed-title'),f('ed-note')]})()")
        check('樣式和「事項」輸入框一致', sty[0] == sty[1], str(sty))

        # 2. 長高：4 行比 2 行高；超過 6 行固定在 6 行高並可捲動
        await page.fill('#ed-note', 'a\nb\nc\nd')
        await page.wait_for_timeout(100)
        a4 = await area()
        check('4 行時長高', abs(a4['h'] - (a4['lh'] * 4 + 24)) <= 1.5, f"h={a4['h']:.1f}")
        await page.fill('#ed-note', '\n'.join(str(i) for i in range(10)))
        await page.wait_for_timeout(100)
        a10 = await area()
        six = a10['lh'] * 6 + 24
        check('超過 6 行固定在 6 行高', abs(a10['h'] - six) <= 1.5, f"h={a10['h']:.1f} 期望≈{six:.1f}")
        check('超過 6 行可捲動', a10['sh'] > a10['ch'] and a10['oy'] in ('auto', 'scroll'))
        await page.fill('#ed-note', 'x')
        await page.wait_for_timeout(100)
        a1 = await area()
        check('縮回 2 行高', abs(a1['h'] - two) <= 1, f"h={a1['h']:.1f}")

        # 3. 新增帶兩行備註的事項，卡片顯示、保留換行
        await page.fill('#ed-title', '備註測試一')
        await page.fill('#ed-note', '  三樓會議室\n帶筆電  ')
        await save()
        card = page.locator('.card', has_text='備註測試一').first
        txt = await card.locator('.note').inner_text()
        check('卡片顯示備註（兩行、去頭尾空白）', txt == '三樓會議室\n帶筆電', repr(txt))
        st = await card.locator('.note').evaluate("e=>{const c=getComputedStyle(e);return {ws:c.whiteSpace,clamp:c.webkitLineClamp,h:e.getBoundingClientRect().height,lh:parseFloat(c.lineHeight)}}")
        check('卡片備註 pre-wrap', st['ws'] == 'pre-wrap', st['ws'])
        check('卡片備註兩行高', abs(st['h'] - st['lh'] * 2) <= 1.5, f"h={st['h']:.1f}")
        rows = await page.evaluate(DB, '備註測試一')
        check('資料存的是去頭尾空白、保留換行', rows[0][2] == '三樓會議室\n帶筆電', repr(rows[0][2]))

        # 4. 很長的備註：卡片最多 3 行，超過用「…」截斷（line-clamp）
        await new_sheet()
        await page.fill('#ed-title', '備註測試長')
        await page.fill('#ed-note', '第一行\n第二行\n第三行\n第四行\n第五行')
        await save()
        card = page.locator('.card', has_text='備註測試長').first
        st = await card.locator('.note').evaluate("e=>{const c=getComputedStyle(e);return {clamp:c.webkitLineClamp,h:e.getBoundingClientRect().height,sh:e.scrollHeight,lh:parseFloat(c.lineHeight),oy:c.overflow}}")
        check('5 行備註卡片只顯示 3 行', abs(st['h'] - st['lh'] * 3) <= 1.5 and st['sh'] > st['h'], str(st))
        check('line-clamp 3', st['clamp'] == '3', st['clamp'])
        # 一行很長沒有換行符號也要截斷
        await new_sheet()
        await page.fill('#ed-title', '備註測試長句')
        await page.fill('#ed-note', '很長的一行備註 ' * 40)
        await save()
        card = page.locator('.card', has_text='備註測試長句').first
        st = await card.locator('.note').evaluate("e=>({h:e.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(e).lineHeight),w:e.scrollWidth,cw:e.clientWidth})")
        check('長句也最多 3 行、不橫向溢出', abs(st['h'] - st['lh'] * 3) <= 1.5 and st['w'] <= st['cw'] + 1, str(st))

        # 5. 沒有備註的卡片沒有 .note 元素
        check('沒備註的卡片沒有備註區', await page.locator('.card', has_text='備註測試一').first.locator('.note').count() == 1 and await page.locator('.card').evaluate_all("els=>els.filter(e=>!e.textContent.includes('備註測試')).every(e=>!e.querySelector('.note')||e.querySelector('.note').textContent!=='')"))

        # 6. 編輯：帶入原本備註（含換行）、改了保留、清空後卡片沒有備註
        await open_card('備註測試一')
        v = await page.input_value('#ed-note')
        check('編輯面板帶入備註（含換行）', v == '三樓會議室\n帶筆電', repr(v))
        await page.fill('#ed-note', '改成別的\n第二行\n第三行')
        await save()
        rows = await page.evaluate(DB, '備註測試一')
        check('編輯後備註更新', rows[0][2] == '改成別的\n第二行\n第三行', repr(rows[0][2]))
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(500)
        txt = await page.locator('.card', has_text='備註測試一').first.locator('.note').inner_text()
        check('重新整理後仍在', txt == '改成別的\n第二行\n第三行', repr(txt))
        await open_card('備註測試一')
        await page.fill('#ed-note', '')
        await save()
        check('清空後卡片沒有備註區', await page.locator('.card', has_text='備註測試一').first.locator('.note').count() == 0)

        # 7. 重複事項：改備註要問範圍；僅限這次只改這一筆；未來每一次改這筆以後
        await new_sheet()
        await page.fill('#ed-title', '備註例會')
        await page.fill('#ed-note', 'A 室')
        await page.locator('.chip', has_text='每週').click()
        await save(); await page.wait_for_timeout(300)
        rows = await page.evaluate(DB, '備註例會')
        check('重複事項排出多筆、都有備註', len(rows) >= 8 and all(r[2] == 'A 室' for r in rows), str(len(rows)))
        await open_card('備註例會')
        await page.fill('#ed-note', 'B 室')
        await save()
        check('只改備註也會問範圍', await page.locator('#scope-title').count() == 1 and await page.locator('#scope-title').inner_text() == '修改重複事項')
        hint = await page.locator('.sheet .field-hint').last.inner_text()
        check('說明文字有「備註」', '備註' in hint, hint)
        await page.locator('.del-actions button', has_text='僅限這次').click(); await page.wait_for_timeout(700)
        rows = await page.evaluate(DB, '備註例會')
        check('僅限這次只改一筆', [r[2] for r in rows].count('B 室') == 1 and rows[0][2] == 'B 室', str([r[2] for r in rows][:4]))
        # 下一週那筆選未來每一次
        nxt = rows[1][0]
        await page.locator('.btn-cal').click(); await page.wait_for_selector('.cal-day'); await page.wait_for_timeout(400)
        m, d = int(nxt[5:7]), int(nxt[8:])
        cell = page.locator(f'.cal-day[aria-label^="{m}月{d}日"]')
        if await cell.count() == 0:
            await page.locator('.cal-nav[aria-label="下個月"]').click(); await page.wait_for_timeout(300)
        await cell.click(); await page.wait_for_timeout(600)
        await open_card('備註例會')
        await page.fill('#ed-note', 'C 室')
        await save(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(400)
        await page.locator('.del-actions button', has_text='未來每一次').click(); await page.wait_for_timeout(700)
        rows = await page.evaluate(DB, '備註例會')
        notes = [r[2] for r in rows]
        check('未來每一次：這筆以後都改，之前的不變', notes[0] == 'B 室' and all(x == 'C 室' for x in notes[1:]), str(notes))
        await page.reload(); await page.wait_for_selector('.app'); await page.wait_for_timeout(800)
        rows2 = await page.evaluate(DB, '備註例會')
        check('重新整理後補排的也是新備註', all(r[2] == 'C 室' for r in rows2[1:]), str(len(rows2)))

        check('沒有頁面錯誤', not errs, str(errs))
        await b.close()
    print('FAILS:', fails)

asyncio.run(main())
