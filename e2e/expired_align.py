"""「標題·已過期」：標題、點、已過期三者的墨跡上下中心要一樣（≤0.5px）。用法：python3 e2e/expired_align.py [2|3|4]（螢幕像素密度）"""
import asyncio, io, sys
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

dpr = int(sys.argv[1]) if len(sys.argv) > 1 else 3
PUT = """async(rows)=>{const r=indexedDB.open('blue-week');return await new Promise(res=>{r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');const s=tx.objectStore('tasks');for(const x of rows)s.put(x);tx.oncomplete=()=>res(true)}})}"""
fails = []
def check(name, ok, extra=''):
    print(('OK  ' if ok else 'FAIL'), name, extra)
    if not ok: fails.append(name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=dpr, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
        page = await ctx.new_page()
        await page.goto('http://localhost:4173/?demo=1'); await page.wait_for_selector('.card')
        rows = [{'id': f'X{i}', 'date': '2020-01-01', 'time': '15:00', 'category': '待辦', 'title': t, 'note': '', 'done': False, 'delayDays': 0, 'deadline': True, 'createdAt': 1, 'updatedAt': 1} for i, t in enumerate(['保險續約', '季度預算定稿', '繳交報名表'])]
        await page.evaluate(PUT, rows); await page.reload(); await page.wait_for_selector('.alerts'); await page.wait_for_timeout(900)
        await page.locator('.alerts-sum').click(); await page.wait_for_timeout(700)
        png = await page.screenshot(); im = np.array(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)
        n = await page.locator('.alerts-expired').count()
        for i in range(n):
            g = await page.evaluate("(i)=>{const r=e=>e.getBoundingClientRect();const e=document.querySelectorAll('.alerts-expired')[i];const d=e.previousElementSibling;const t=d.previousElementSibling;return [t,d,e].map(x=>{const q=r(x);return [q.left,q.right,q.top,q.bottom]})}", i)
            bg = im[int(g[0][2]*dpr)-2, int(g[0][0]*dpr)]
            cs = []
            for l, r, tp, bt in g:
                y0 = int(tp*dpr)-6
                reg = im[y0:int(bt*dpr)+6, int(l*dpr):int(r*dpr)+1]
                d = np.abs(reg-bg).sum(2) > 90; rows_ = np.where(d.any(1))[0]
                cs.append((rows_.min()+rows_.max())/2/dpr + y0/dpr)
            check(f'第{i+1}列 標題／點／已過期 墨跡中心同高 ({dpr}x)', max(cs)-min(cs) <= 0.5, str([round(c, 2) for c in cs]))
        check('有量到已過期列', n >= 1)
        await b.close()
asyncio.run(main())
print('FAILS:', fails)
