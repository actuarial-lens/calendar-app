"""搜尋（0.30.0）：放大鏡與齒輪左右對稱、搜尋得到備註、點結果跳到那天並標亮、已完成的切到「已完成」頁籤。
先 npm run build 並用 4173 埠提供 dist，再 python3 e2e/search.py"""
import asyncio, datetime
from playwright.async_api import async_playwright

fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

SEED = """async (rows) => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('blue-week'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(['tasks', 'notes'], 'readwrite');
    for (const t of rows.tasks) tx.objectStore('tasks').put(t);
    for (const n of rows.notes) tx.objectStore('notes').put(n);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}"""

async def main():
    today = datetime.date.today()
    iso = lambda n: (today + datetime.timedelta(days=n)).isoformat()
    now = int(datetime.datetime.now().timestamp() * 1000)
    def T(id, n, title, note='', time='', **kw):
        base = dict(id=id, date=iso(n), time=time, category='待辦', title=title, note=note, done=False, delayDays=0, createdAt=now, updatedAt=now)
        base.update(kw)
        return base
    tasks = [
        T('s-a', 10, '搜尋測試甲', '地點在三樓會議室', '04:30'),
        T('s-b', -3, '搜尋測試乙', '', '', done=True, doneAt=now),
        T('s-c', 1, 'ＡＢＣ報告', '', '09:00'),
        T('s-d', 10, '搜尋測試已刪', '', '', deletedAt=now),
        T('s-e', 4, '重複的事', '', '10:00', repeat=dict(seriesId='sr', freq='weekly', anchor=iso(4), occurrence=iso(4))),
    ] + [T(f's-f{i}', 10, f'填充事項{i}', '', f'0{i}:00') for i in range(1, 9)]
    notes = [
        dict(id='n-a', date=iso(2), text='隨手記 搜尋測試丙', createdAt=now, updatedAt=now),
        dict(id='n-b', date=iso(2), text='搜尋測試已刪的隨手記', createdAt=now, updatedAt=now, deletedAt=now),
    ] + [dict(id=f'n-f{i}', date=iso(2), text=f'填充隨手記{i}', createdAt=now + i, updatedAt=now + i) for i in range(1, 6)]
    tasks += [T(f's-g{i}', 2, f'二天後填充{i}', '', f'1{i}:00') for i in range(0, 8)]

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        await page.evaluate(SEED, dict(tasks=tasks, notes=notes))
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(500)

        # 1. 放大鏡與齒輪：左右對稱、同大小、對齊週列的「一」和「日」、垂直置中對齊日期區間
        box = lambda sel: page.evaluate("(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}}", sel)
        g, s, r = await box('.gear'), await box('.search-btn'), await box('.range')
        d1, d7 = await page.evaluate("(()=>{const ds=[...document.querySelectorAll('.week .day')].map(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2});return [ds[0],ds[6]]})()")
        W = 390
        check('齒輪在左、放大鏡在右', g['cx'] < s['cx'], f"gear cx={g['cx']:.1f} search cx={s['cx']:.1f}")
        check('點擊範圍都是 44×44', (g['w'], g['h'], s['w'], s['h']) == (44, 44, 44, 44), f"{g['w']}x{g['h']} {s['w']}x{s['h']}")
        check('齒輪中心對齊週列「一」', abs(g['cx'] - d1) <= 0.5, f"{g['cx']:.2f} vs {d1:.2f}")
        check('放大鏡中心對齊週列「日」', abs(s['cx'] - d7) <= 0.5, f"{s['cx']:.2f} vs {d7:.2f}")
        check('左右對稱', abs((g['cx']) - (W - s['cx'])) <= 0.5, f"{g['cx']:.2f} / {W - s['cx']:.2f}")
        check('垂直置中對齊日期區間', abs(g['cy'] - r['cy']) <= 0.5 and abs(s['cy'] - r['cy']) <= 0.5, f"{g['cy']:.1f} {s['cy']:.1f} {r['cy']:.1f}")
        check('日期區間仍置中', abs(r['cx'] - W / 2) <= 1, f"{r['cx']:.1f}")
        check('放大鏡 aria-label', await page.get_attribute('.search-btn', 'aria-label') == '搜尋')
        sv = await page.evaluate("(()=>{const f=s=>{const e=document.querySelector(s+' svg');return [e.getAttribute('width'),e.getAttribute('stroke-width'),getComputedStyle(document.querySelector(s)).color].join('|')};return [f('.gear'),f('.search-btn')]})()")
        check('圖示大小、線寬、顏色同風格', sv[0] == sv[1], str(sv))
        # 設定仍可用 .gear 打開
        await page.click('.gear'); await page.wait_for_selector('.settings'); await page.wait_for_timeout(500)
        await page.click('.settings .back'); await page.wait_for_timeout(500)

        # 2. 開啟搜尋頁：自動聚焦、空白提示
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(500)
        check('搜尋頁整頁（蓋滿畫面）', await page.evaluate("(()=>{const r=document.querySelector('.search-page').getBoundingClientRect();return r.x===0&&r.y===0&&Math.round(r.width)===innerWidth&&Math.round(r.height)===innerHeight})()"))
        check('自動聚焦輸入框', await page.evaluate("document.activeElement && document.activeElement.id") == 'search-input')
        check('空白提示', (await page.inner_text('.search-empty')) == '輸入關鍵字，搜尋事項與隨手記')
        rows = lambda: page.eval_on_selector_all('.search-row', "els=>els.map(e=>e.getAttribute('data-hit-id'))")
        check('空字串不列任何結果', await rows() == [])
        await page.fill('#search-input', '   '); await page.wait_for_timeout(100)
        check('只有空白也不搜', await rows() == [] and await page.locator('.search-empty').count() == 1)

        # 3. 搜尋備註裡的字；符合的字有標示
        await page.fill('#search-input', '三樓'); await page.wait_for_timeout(150)
        check('搜得到備註裡的字', await rows() == ['s-a'], str(await rows()))
        marks = await page.eval_on_selector_all('.search-row mark', 'els=>els.map(e=>e.textContent)')
        check('符合的字用 mark 標示', marks == ['三樓'], str(marks))
        note_line = await page.inner_text('.sr-note')
        check('下面一行灰字顯示備註', note_line == '地點在三樓會議室', note_line)
        # 多個詞、全形、大小寫
        await page.fill('#search-input', '搜尋測試 三樓'); await page.wait_for_timeout(150)
        check('多個詞都要出現', await rows() == ['s-a'])
        await page.fill('#search-input', 'abc'); await page.wait_for_timeout(150)
        check('小寫 abc 找得到全形ＡＢＣ', await rows() == ['s-c'], str(await rows()))
        await page.fill('#search-input', 'ＡＢＣ'); await page.wait_for_timeout(150)
        check('全形輸入也找得到', await rows() == ['s-c'])
        await page.fill('#search-input', 'zzzzqq'); await page.wait_for_timeout(150)
        check('找不到的提示', (await page.inner_text('.search-empty')) == '找不到符合的內容')

        # 4. 排序、標示、已刪除不列
        await page.fill('#search-input', '搜尋測試'); await page.wait_for_timeout(150)
        got = await rows()
        check('排序：今天以後近→遠，再過去；已刪除的不列', got == ['n-a', 's-a', 's-b'], str(got))
        marks = await page.eval_on_selector_all('.search-row', "els=>els.map(e=>(e.querySelector('.sr-marks')||{}).textContent||'')")
        check('標示：隨手記／（空）／已完成', marks == ['隨手記', '', '已完成'], str(marks))
        dates = await page.eval_on_selector_all('.sr-date', 'els=>els.map(e=>e.textContent)')
        import re
        check('日期格式 11/12（四）', all(re.fullmatch(r'\d{1,2}/\d{1,2}（[日一二三四五六]）', d) for d in dates), str(dates))
        times = await page.eval_on_selector_all('.sr-time', 'els=>els.map(e=>e.textContent)')
        check('事項顯示時間', times[1] == '04:30', str(times))
        await page.fill('#search-input', '重複'); await page.wait_for_timeout(150)
        mk = await page.inner_text('.sr-marks')
        check('重複事項標示 ↻ 每週', mk == '↻ 每週', mk)

        # 5. 點結果（今天以後的事項，在別的一週）：關閉搜尋頁、跳到那天、標亮、捲到中間
        await page.fill('#search-input', '搜尋測試'); await page.wait_for_timeout(150)
        await page.click('.search-row[data-hit-id="s-a"]')
        await page.wait_for_timeout(250)
        check('搜尋頁關閉中（滑出）', await page.evaluate("(()=>{const e=document.querySelector('.search-page');return !e||e.classList.contains('closing')})()"))
        flashed = await page.evaluate("!!document.querySelector('[data-task-id=\"s-a\"].flash')")
        check('卡片標亮 .flash', flashed)
        await page.wait_for_timeout(900)
        await page.wait_for_selector('.search-page', state='detached', timeout=3000)
        want = await page.evaluate("(d)=>{const t=new Date(d+'T00:00:00');const day=(t.getDay()+6)%7;const s=new Date(t);s.setDate(t.getDate()-day);const e=new Date(s);e.setDate(s.getDate()+6);const f=x=>x.getFullYear()+'.'+String(x.getMonth()+1).padStart(2,'0')+'.'+String(x.getDate()).padStart(2,'0');return f(s)+' – '+f(e)}", iso(10))
        check('跳到那一天所在的一週', (await page.inner_text('.range')) == want, want)
        check('選中的是那一天', await page.evaluate("(d)=>{const n=Number(d.slice(8));const b=[...document.querySelectorAll('.week .day[aria-pressed=true] .n')].map(e=>Number(e.textContent));return b.length===1&&b[0]===n}", iso(10)))
        pos = await page.evaluate("(()=>{const c=document.querySelector('[data-task-id=\"s-a\"]').getBoundingClientRect();const m=document.querySelector('.main').getBoundingClientRect();return {cc:c.y+c.height/2,mc:m.y+m.height/2,top:c.y,bot:c.bottom,mt:m.y,mb:m.bottom}})()")
        check('卡片完整在畫面內', pos['top'] >= pos['mt'] - 1 and pos['bot'] <= pos['mb'] + 1, str(pos))
        check('捲到畫面中間', abs(pos['cc'] - pos['mc']) <= 40, f"卡片中心 {pos['cc']:.0f} / 主區中心 {pos['mc']:.0f}")
        await page.wait_for_timeout(1000)
        check('1.5 秒後標亮消失', not await page.evaluate("!!document.querySelector('.flash')"))
        check('分頁籤是「全部」', await page.evaluate("document.querySelector('.tag[aria-pressed=true]').textContent") == '全部')

        # 6. 點已完成的事項：切到「已完成」頁籤
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(400)
        await page.fill('#search-input', '搜尋測試乙'); await page.wait_for_timeout(150)
        await page.click('.search-row[data-hit-id="s-b"]'); await page.wait_for_timeout(500)
        check('已完成的切到「已完成」頁籤', await page.evaluate("document.querySelector('.tag[aria-pressed=true]').textContent") == '已完成')
        check('已完成的卡片在畫面上', await page.evaluate("!!document.querySelector('[data-task-id=\"s-b\"]')"))
        check('已完成的卡片標亮', await page.evaluate("!!document.querySelector('[data-task-id=\"s-b\"].flash')"))
        await page.wait_for_timeout(1700)

        # 7. 點隨手記：跳到那天、隨手記列標亮
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(400)
        await page.fill('#search-input', '搜尋測試丙'); await page.wait_for_timeout(150)
        await page.click('.search-row[data-hit-id="n-a"]'); await page.wait_for_timeout(500)
        check('隨手記：分頁籤回到「全部」', await page.evaluate("document.querySelector('.tag[aria-pressed=true]').textContent") == '全部')
        check('隨手記列有 data-note-id 且標亮', await page.evaluate("!!document.querySelector('[data-note-id=\"n-a\"].flash')"))
        await page.wait_for_timeout(900)
        vis = await page.evaluate("(()=>{const c=document.querySelector('[data-note-id=\"n-a\"]').getBoundingClientRect();const m=document.querySelector('.main').getBoundingClientRect();return c.top>=m.y-1&&c.bottom<=m.bottom+1})()")
        check('隨手記列在畫面內', vis)
        await page.wait_for_timeout(1200)

        # 8. 關閉方式：返回鍵、Escape、通知跳日期（open-date）
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(400)
        await page.click('.search-page .back'); await page.wait_for_selector('.search-page', state='detached', timeout=3000)
        check('返回鍵關閉', True)
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(400)
        await page.keyboard.press('Escape'); await page.wait_for_selector('.search-page', state='detached', timeout=3000)
        check('Escape 關閉', True)
        await page.click('.search-btn'); await page.wait_for_selector('#search-input'); await page.wait_for_timeout(400)
        target = iso(30)
        await page.evaluate("(d)=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'open-date',date:d}}))", target)
        await page.wait_for_selector('.search-page', state='detached', timeout=3000)
        want2 = await page.evaluate("(d)=>{const t=new Date(d+'T00:00:00');const day=(t.getDay()+6)%7;const s=new Date(t);s.setDate(t.getDate()-day);const e=new Date(s);e.setDate(s.getDate()+6);const f=x=>x.getFullYear()+'.'+String(x.getMonth()+1).padStart(2,'0')+'.'+String(x.getDate()).padStart(2,'0');return f(s)+' – '+f(e)}", target)
        check('點通知跳日期時也關掉搜尋頁', (await page.inner_text('.range')) == want2, want2)

        # 9. 搜尋結果隨資料更新（搜尋頁開著時完成事項／刪除）不出錯；超過 200 筆的提示在單元測試
        check('沒有頁面錯誤', not errs, str(errs))
        await b.close()
    print('FAILS:', fails)

asyncio.run(main())
