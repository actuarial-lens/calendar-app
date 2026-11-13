"""卡片上「分類」文字與右邊的膠囊（重要／截止／延 N 天）、重複標記（符號＋文字）是否同一個中心：量墨跡的上下中心（px，正 = 偏下），每項都要 ≤0.3px"""
import asyncio, io, math, sys
import numpy as np
from playwright.async_api import async_playwright
from PIL import Image
PUT = open('e2e/alerts.py').read().split('PUT = """')[1].split('"""')[0]
SCALE = 4

def ink_center(a, y0, y1, x0, x1):
    reg = a[y0:y1, x0:x1]
    vals, counts = np.unique(reg.reshape(-1, 3), axis=0, return_counts=True)
    bg = vals[counts.argmax()]
    rows = np.nonzero((np.abs(reg - bg).sum(axis=2) > 90).any(axis=1))[0]
    return None if not len(rows) else (rows[0] + rows[-1] + 1) / 2 + y0

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=SCALE, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); page.set_default_timeout(8000)
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        today = await page.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")
        t = lambda i, ti, **k: {'id': i, 'date': today, 'time': '15:00', 'category': '待辦', 'title': ti, 'note': '', 'done': False, 'delayDays': 0, 'createdAt': int(i[1:]), 'updatedAt': 1, **k}
        rep = {'seriesId': 's', 'freq': 'weekly', 'anchor': today, 'occurrence': today}
        await page.evaluate(PUT, [t('a1', '全部都有', important=True, deadline=True, delayDays=2, repeat=rep, category='會議'),
                                  t('a2', '只有重要', important=True), t('a3', '只有截止', deadline=True, category='私人'), t('a4', '只有延後', delayDays=1)])
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(700)
        await page.add_style_tag(content='*{transition:none !important;animation:none !important} .bottom{visibility:hidden !important} .alerts{display:none !important}')
        res = []
        for title in ['全部都有', '只有重要', '只有截止', '只有延後']:
            card = page.locator('.card', has_text=title)
            await card.evaluate("e=>e.scrollIntoView({block:'center'})"); await page.wait_for_timeout(150)
            cb = await card.bounding_box()
            cx, cy = math.floor(cb['x']), math.floor(cb['y'])
            png = await page.screenshot(clip={'x': cx, 'y': cy, 'width': math.ceil(cb['width']) + 2, 'height': 60})
            a = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)
            async def box(sel):
                loc = card.locator(sel)
                return await loc.first.bounding_box() if await loc.count() else None
            cat = await box('.cat')
            cc = ink_center(a, int((cat['y'] - cy) * SCALE), int((cat['y'] + cat['height'] - cy) * SCALE), int((cat['x'] - cx) * SCALE), int((cat['x'] + cat['width'] - cx) * SCALE))
            if title == '全部都有':
                rr = await card.locator('.rep').evaluate("""e=>{return [e.querySelector('.rep-i'),e.querySelector('.rep-t')].map(n=>{const x=n.getBoundingClientRect();return [x.x,x.y,x.width,x.height]})}""")
                for nm, (rx, ry, rw, rh) in zip(['符號', '文字'], rr):
                    rc = ink_center(a, int((ry - cy) * SCALE), int((ry + rh - cy) * SCALE), int((rx - cx) * SCALE), int((rx + rw - cx) * SCALE))
                    d = round((rc - cc) / SCALE, 2); res.append(('全部都有', '重複' + nm, d, d, 0))
            for sel, name in [('.pill.imp', '重要'), ('.pill.dl', '截止'), ('.pill.delay', '延 N 天')]:
                bx = await box(sel)
                if not bx: continue
                ins = 3  # 避開框線
                pc = ink_center(a, int((bx['y'] + ins - cy) * SCALE), int((bx['y'] + bx['height'] - ins - cy) * SCALE),
                                int((bx['x'] + min(bx['height'] / 2, bx['width'] * .3) - cx) * SCALE), int((bx['x'] + bx['width'] - min(bx['height'] / 2, bx['width'] * .3) - cx) * SCALE))
                res.append((title, name, round((pc - cc) / SCALE, 2), round((bx['y'] + bx['height'] / 2 - cy) - cc / SCALE, 2), round(pc / SCALE - (bx['y'] + bx['height'] / 2 - cy), 2)))
        # 重要且未完成的卡片底色（A：#FBF0EE）；沒標重要的維持 --card
        bgs = await page.evaluate("()=>[...document.querySelectorAll('.card')].map(c=>[c.querySelector('.title').textContent, getComputedStyle(c).backgroundColor])")
        print('卡片底色:', bgs)
        want = {'全部都有': 'rgb(251, 240, 238)', '只有重要': 'rgb(251, 240, 238)', '只有截止': 'rgb(250, 250, 246)', '只有延後': 'rgb(250, 250, 246)'}
        for ti, col in bgs:
            if ti in want and col != want[ti]: print('FAIL 底色', ti, col); res.append((ti, '底色', 99, 0, 0))
        bad = 0
        for title, name, d, boxd, inkd in res:
            # 三個中心要一致：膠囊字 vs 分類字、膠囊框 vs 分類字、膠囊字 vs 膠囊框（都 ≤0.3px，低於一個裝置像素）
            ok = abs(d) <= 0.3 and abs(boxd) <= 0.3 and abs(inkd) <= 0.3; bad += not ok
            print('OK  ' if ok else 'FAIL', f'{title}／{name}：膠囊字−分類字 {d:+.2f}px，膠囊框−分類字 {boxd:+.2f}px，膠囊字−膠囊框 {inkd:+.2f}px')
        print('FAILS:', bad)
        await b.close()
asyncio.run(main())
