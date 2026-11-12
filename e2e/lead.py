"""每件事的提前提醒：預設 30、可個別設定、存檔後保留"""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei')
    page = ctx.new_page(); errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://localhost:4173/?demo=1'); page.wait_for_selector('.card')
    # 設定頁：預設 30
    page.locator('.gear').click(); page.wait_for_selector('#morning')
    assert page.get_by_text('預設提前提醒（分鐘）').count() == 1
    sel = page.locator('#lead-l').locator('xpath=following-sibling::div//button[@aria-pressed="true"]').inner_text()
    print('預設提前分鐘:', sel); assert sel == '30'
    page.get_by_role('button', name='返回').click(); page.wait_for_timeout(500)
    # 新增事項：沒指定時間 → 看不到提前提醒；指定時間 → 出現，預設選 30
    page.get_by_role('button', name='新增事項').click(); page.wait_for_selector('#ed-title')
    assert page.locator('.lead-row').count() == 0
    page.fill('#ed-title', '提前測試')
    page.get_by_role('button', name='指定', exact=True).click(); page.wait_for_selector('.lead-row')
    on = page.locator('.lead-row button[aria-pressed="true"]').inner_text()
    print('編輯時預設選中:', on); assert on == '30'
    page.locator('.lead-row').get_by_role('button', name='10', exact=True).click()
    assert page.locator('.lead-row button[aria-pressed="true"]').inner_text() == '10'
    page.get_by_role('dialog').get_by_role('button', name='記下').click(); page.wait_for_timeout(600)
    # 重新打開那一筆：仍是 10
    page.locator('.card', has_text='提前測試').first.click(); page.wait_for_selector('.lead-row')
    on = page.locator('.lead-row button[aria-pressed="true"]').inner_text()
    print('重開後選中:', on, '| 錯誤', errs); assert on == '10'
    # 點回 30（= 預設）→ 存檔後再開仍是 30
    page.locator('.lead-row').get_by_role('button', name='30', exact=True).click()
    page.get_by_role('button', name='儲存').click(); page.wait_for_timeout(600)
    page.locator('.card', has_text='提前測試').first.click(); page.wait_for_selector('.lead-row')
    assert page.locator('.lead-row button[aria-pressed="true"]').inner_text() == '30'
    page.screenshot(path='/tmp/lead.png')
    print('OK'); b.close()
