"""卡片上分類文字後面的標示（重要／截止日／延 N 天／↻ 每週）：
1. 垂直：每一項的墨跡上下中心和「分類」文字一致（≤0.5px；版面上全部同字級、同行高，剩下的是字形差）
2. 水平：每個「·」左邊的空白＝右邊的空白，而且所有地方的空白都一樣寬（≤0.75px，不同字的字形邊距本來就差 0.25–0.75px）
3. 重要且未完成的卡片底色是 #FBF0EE"""
import asyncio, io, math, sys
import numpy as np
from playwright.async_api import async_playwright
from PIL import Image
PUT = open('e2e/alerts.py').read().split('PUT = """')[1].split('"""')[0]
SCALE = int(sys.argv[1]) if len(sys.argv) > 1 else 4
# 4x 螢幕的量測解析度是 0.25px，空白差要 ≤0.75px（不到 1 個裝置像素；不同字的字形邊距本來就差 0.25–0.75px）；垂直方向不同字形（議／要…）的墨跡中心本來就差 0.1–0.4px，所以 ≤0.5px。2x、3x 只能量到 0.5／0.33px，空白放寬到 1px
GAP_TOL, V_TOL = (0.75, 0.5) if SCALE == 4 else (1.0, 0.75)

def ink(a, x0, x1, y0, y1):
    """區域內墨跡的 (左, 右, 上, 下)，單位 = 截圖像素"""
    reg = a[y0:y1, x0:x1]
    vals, counts = np.unique(reg.reshape(-1, 3), axis=0, return_counts=True)
    bg = vals[counts.argmax()]
    m = np.abs(reg - bg).sum(axis=2) > 90
    cols, rows = np.nonzero(m.any(axis=0))[0], np.nonzero(m.any(axis=1))[0]
    if not len(cols): return None
    return cols[0] + x0, cols[-1] + 1 + x0, rows[0] + y0, rows[-1] + 1 + y0

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 430, 'height': 844}, device_scale_factor=SCALE, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); page.set_default_timeout(8000)
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        today = await page.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")
        t = lambda i, ti, **k: {'id': i, 'date': today, 'time': '15:00', 'category': '待辦', 'title': ti, 'note': '', 'done': False, 'delayDays': 0, 'createdAt': int(i[1:]), 'updatedAt': 1, **k}
        rep = {'seriesId': 's', 'freq': 'weekly', 'anchor': today, 'occurrence': today}
        await page.evaluate(PUT, [t('a1', '全部都有', important=True, deadline=True, delayDays=2, repeat=rep, category='會議'),
                                  t('a2', '只有重要', important=True), t('a3', '截止加每週', deadline=True, repeat=rep, category='私人'),
                                  t('a4', '只有延後', delayDays=1), t('a5', '只有每月', repeat={**rep, 'freq': 'monthly'}), t('a6', '延後加每週', delayDays=12, repeat=rep)])
        await page.reload(); await page.wait_for_selector('.card'); await page.wait_for_timeout(700)
        await page.add_style_tag(content='*{transition:none !important;animation:none !important} .bottom{visibility:hidden !important} .alerts{display:none !important}')
        fails, gaps = [], []
        for title in ['全部都有', '只有重要', '截止加每週', '只有延後', '只有每月', '延後加每週']:
            card = page.locator('.card', has_text=title)
            await card.evaluate("e=>e.scrollIntoView({block:'center'})"); await page.wait_for_timeout(150)
            cb = await card.bounding_box()
            cx, cy = math.floor(cb['x']), math.floor(cb['y'])
            png = await page.screenshot(clip={'x': cx, 'y': cy, 'width': math.ceil(cb['width']) + 2, 'height': 60})
            a = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)
            els = await card.evaluate("""c=>[...c.querySelectorAll('.left > .cat, .left .sep, .left .mark')].map(e=>{const r=e.getBoundingClientRect();return [e.className.split(' ').pop(), e.textContent, r.x, r.y, r.width, r.height]})""")
            inks = []
            for cls, txt, x, y, w, h in els:
                i = ink(a, int((x - cx) * SCALE), int((x + w - cx) * SCALE), int((y - cy) * SCALE), int((y + h - cy) * SCALE))
                inks.append((cls, txt, i))
            cat = inks[0][2]; cc = (cat[2] + cat[3]) / 2
            for cls, txt, i in inks[1:]:
                if cls == 'sep': continue
                d = ((i[2] + i[3]) / 2 - cc) / SCALE
                ok = abs(d) <= V_TOL; print('OK  ' if ok else 'FAIL', f'{title}／{txt}：中心比分類文字{d:+.2f}px'); 
                if not ok: fails.append((title, txt, d))
            for k in range(1, len(inks) - 1):
                if inks[k][0] != 'sep': continue
                gl = (inks[k][2][0] - inks[k - 1][2][1]) / SCALE; gr = (inks[k + 1][2][0] - inks[k][2][1]) / SCALE
                gaps += [gl, gr]
                ok = abs(gl - gr) <= GAP_TOL; print('OK  ' if ok else 'FAIL', f'{title}／「{inks[k-1][1]}」·「{inks[k+1][1]}」：左空白 {gl:.2f}px，右空白 {gr:.2f}px')
                if not ok: fails.append((title, 'gap', gl - gr))
        spread = max(gaps) - min(gaps)
        ok = spread <= GAP_TOL; print('OK  ' if ok else 'FAIL', f'所有空白最小 {min(gaps):.2f}px、最大 {max(gaps):.2f}px（差 {spread:.2f}px）')
        if not ok: fails.append(('all', 'gap-spread', spread))
        bgs = await page.evaluate("()=>[...document.querySelectorAll('.card')].map(c=>[c.querySelector('.title').textContent, getComputedStyle(c).backgroundColor])")
        want = {'全部都有': 'rgb(251, 240, 238)', '只有重要': 'rgb(251, 240, 238)', '截止加每週': 'rgb(250, 250, 246)', '只有延後': 'rgb(250, 250, 246)'}
        for ti, col in bgs:
            if ti in want and col != want[ti]: print('FAIL 底色', ti, col); fails.append((ti, '底色', 0))
        # 窄螢幕（390px）：四個標示放不下時會整組換行，不能壓到右邊的時間
        await page.set_viewport_size({'width': 390, 'height': 844}); await page.wait_for_timeout(400)
        ov = await page.evaluate("""()=>[...document.querySelectorAll('.card')].filter(c=>c.querySelector('.left')).map(c=>{const t=c.querySelector('.time').getBoundingClientRect();return [c.querySelector('.title').textContent,[...c.querySelectorAll('.left > *')].some(e=>{const r=e.getBoundingClientRect();return r.top<t.bottom&&r.bottom>t.top&&r.right>t.left-8})]})""")
        for ti, bad in ov:
            print('FAIL' if bad else 'OK  ', f'390px 寬：{ti}的標示沒有壓到時間（至少留 8px）' if not bad else f'390px 寬：{ti}的標示壓到時間'); 
            if bad: fails.append((ti, 'overlap', 0))
        print('FAILS:', len(fails)); await b.close()
asyncio.run(main())
