"""量測所有膠囊／按鈕的文字是否上下置中：截圖後比對「字的墨跡」上下緣與膠囊上下緣的距離（單位 px，誤差 ≤ 1px 算置中）"""
import asyncio, io, sys
from playwright.async_api import async_playwright
from PIL import Image

PUT = open('e2e/alerts.py').read().split('PUT = """')[1].split('"""')[0]
SCALE = 4
LIMIT = 1.0  # 字形本身上下不對稱（例如「一」「5」），所以容許 ±1px；超過就是真的偏了

def ink_offset(png, clip_y, box, inset):
    """png 是涵蓋整個膠囊的截圖（左上角在頁面 (clip_x, clip_y)）；box = 膠囊的精確位置（可有小數）。
    回傳 (墨跡中心 − 膠囊中心)，單位 px，正 = 字偏下。小數位置不會被截圖的整數邊界吃掉。"""
    import numpy as np
    a = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)
    top = (box['y'] - clip_y) * SCALE; hgt = box['height'] * SCALE
    ys0 = int(round(top + inset * SCALE)); ys1 = int(round(top + hgt - inset * SCALE))
    w = a.shape[1]; xr = int(min(box['height'] / 2, box['width'] * 0.3) * SCALE)
    x0 = int(round((box['x'] - int(box['x'])) * SCALE)) + xr; x1 = x0 + int(box['width'] * SCALE) - 2 * xr   # 避開膠囊兩端的圓弧
    reg = a[ys0:ys1, x0:x1]
    vals, counts = np.unique(reg.reshape(-1, 3), axis=0, return_counts=True)
    bg = vals[counts.argmax()]
    rows = np.nonzero((np.abs(reg - bg).sum(axis=2) > 90).any(axis=1))[0]
    if not len(rows): return None
    ink_c = ((rows[0] + ys0) + (rows[-1] + 1 + ys0)) / 2 / SCALE + clip_y
    return ink_c - (box['y'] + box['height'] / 2)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=SCALE, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page(); page.set_default_timeout(8000)
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        today = await page.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")
        add = lambda n: page.evaluate("([d,n])=>{const [y,m,dd]=d.split('-').map(Number);const x=new Date(y,m-1,dd+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')}", [today, n])
        t = lambda i, d, ti, **k: {'id': i, 'date': d, 'time': '15:00', 'category': '待辦', 'title': ti, 'note': '', 'done': False, 'delayDays': 0, 'createdAt': 1, 'updatedAt': 1, **k}
        await page.evaluate(PUT, [
            t('A', await add(-3), '過去重要A', important=True), t('B', await add(-20), '過期D', deadline=True), t('C', await add(2), '截止C', deadline=True),
            t('R', today, '每週例會', delayDays=1, repeat={'seriesId': 's', 'freq': 'weekly', 'anchor': today, 'occurrence': today}, important=True, deadline=True)])
        await page.reload(); await page.wait_for_selector('.alerts'); await page.wait_for_timeout(600)
        await page.add_style_tag(content='*{transition:none !important;animation:none !important}')  # 不要有動畫
        hide = await page.add_style_tag(content='.bottom{visibility:hidden !important}')  # 量主畫面時，底部列不要蓋住量測的元素
        await page.locator('.alerts-sum').click(); await page.wait_for_timeout(600)

        results = []
        async def measure(label, loc, inset=2.5):
            n = await loc.count(); print('量測', label, n, flush=True)
            for i in range(n):
                el = loc.nth(i)
                if not await el.is_visible(): continue
                await el.evaluate("e=>e.scrollIntoView({block:'center',inline:'nearest'})"); await page.wait_for_timeout(120)
                box = await el.bounding_box()
                if not box or box['y'] < 0 or box['y'] + box['height'] > 844: continue
                import math
                cx, cy = math.floor(box['x']), math.floor(box['y'])
                png = await page.screenshot(clip={'x': cx, 'y': cy, 'width': math.ceil(box['width']) + 2, 'height': math.ceil(box['height']) + 2})
                off = ink_offset(png, cy, box, inset)
                if off is None: continue
                txt = (await el.inner_text()).strip().replace('\n', ' ')[:12]
                pad = await el.evaluate('e=>getComputedStyle(e).padding')
                results.append((label, txt, round(float(off), 2), round(box['height'], 1), pad))
        S = page.locator
        await measure('提示框 已確認/不再通知/已完成/全部移至本日', S('.alerts-cap'))
        await measure('分類頁籤', S('.tag'))
        await measure('週列日期', S('.week .day'), 4)
        await hide.evaluate('e=>e.remove()')
        await measure('底部 新增事項', S('.btn-new'))
        await measure('底部 月曆', S('.btn-cal'))
        # 編輯面板
        await S('.card', has_text='每週例會').click(); await page.wait_for_selector('#ed-title'); await page.wait_for_timeout(700)
        await S('.chip', has_text='指定').click(); await page.wait_for_timeout(400)
        await measure('編輯面板 chip', S('.sheet .chip'))
        await measure('編輯面板 恢復預設', S('.lead-reset'))
        await measure('編輯面板 取消/儲存', S('.sheet-actions button'))
        await S('.sheet').evaluate("e=>e.scrollTo(0,99999)"); await page.wait_for_timeout(300)
        await measure('編輯面板 chip（下半）', S('.sheet .chip'))
        await S('.chip', has_text='截止日').click(); await page.wait_for_selector('#scope-title'); await page.wait_for_timeout(600)
        await measure('詢問框 按鈕', S('.del-actions button'))
        await S('.del-actions .btn-text').click(); await page.wait_for_timeout(500)
        await S('.sheet-actions .btn-ghost', has_text='取消').click(); await page.wait_for_timeout(600)
        # 月曆
        await S('.btn-cal').click(); await page.wait_for_selector('.cal-day'); await page.wait_for_timeout(700)
        await measure('月曆 回到今天', S('.cal-today'))
        await S('.scrim').click(position={'x': 20, 'y': 20}); await page.wait_for_timeout(700)
        # 設定
        await S('.gear').click(); await page.wait_for_selector('.settings'); await page.wait_for_timeout(800)
        await measure('設定 按鈕', S('.settings button.btn-outline, .settings .btn-outline, .settings .seg button, .settings .btn-ghost'))
        await b.close()

    worst = {}
    for label, txt, off, h, _pad in results:
        worst.setdefault(label, []).append((abs(off), off, txt, h))
    bad = 0
    for label, lst in worst.items():
        w = max(lst)
        if label.startswith('週列'):  # 「一」只有一橫、墨跡位置和其他字不同，這一欄用中位數
            import statistics
            m = statistics.median(x[1] for x in lst); w = (abs(m), m, '中位數', w[3])
        ok = w[0] <= LIMIT
        bad += not ok
        print(('OK  ' if ok else 'FAIL'), f'{label}: {len(lst)} 個，最大偏移 {w[1]:+.2f}px（「{w[2]}」，高 {w[3]}px）')
    print('FAILS:', bad)
    if '-v' in sys.argv:
        for r in results: print(r)

asyncio.run(main())
