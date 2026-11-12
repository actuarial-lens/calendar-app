"""設定頁：伺服器欄位、匯出匯入（用瀏覽器下載與上傳檔案實測）"""
import json, sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:4173/?demo=1'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    page.goto(URL); page.wait_for_selector('.task-card, .card, [class*=task]', timeout=8000)
    page.click('.gear'); page.wait_for_selector('#push-url')
    # 伺服器欄位：沒填完時測試按鈕停用；填完後啟用且會保存
    test_btn = page.get_by_role('button', name='測試伺服器推播')
    assert test_btn.is_disabled()
    page.fill('#push-url', 'https://x.workers.dev'); page.fill('#push-key', 'BEl6'); page.fill('#push-secret', 'pw')
    assert test_btn.is_enabled()
    assert page.input_value('#push-secret') == 'pw'
    assert page.get_attribute('#push-secret', 'type') == 'password'
    # 匯出
    with page.expect_download() as dl:
        page.get_by_role('button', name='匯出', exact=True).click()
    path = dl.value.path()
    data = json.load(open(path))
    assert data['format'] == 'calendar-backup' and len(data['tasks']) > 0, data.keys()
    assert 'push' not in json.dumps(data) and 'pw' not in json.dumps(data)
    page.wait_for_selector('text=已匯出')
    n = len(data['tasks'])
    # 匯入同一份：不應有新增
    page.set_input_files('input[type=file]', path)
    page.wait_for_selector('text=沒有需要匯入的新資料')
    # 匯入新檔：改一筆 id → 新增 1
    data['tasks'][0]['id'] = 'imported-1'; data['tasks'][0]['title'] = '匯入測試事項'
    json.dump(data, open('/tmp/new.json', 'w'))
    page.set_input_files('input[type=file]', '/tmp/new.json')
    page.wait_for_selector('text=新增事項 1、更新 0')
    # 壞檔
    open('/tmp/bad.json', 'w').write('nope')
    page.set_input_files('input[type=file]', '/tmp/bad.json')
    page.wait_for_selector('text=不是有效的備份檔')
    page.screenshot(path='/tmp/settings.png', full_page=False)
    # 設定重整後仍在
    page.reload(); page.click('.gear'); page.wait_for_selector('#push-url')
    assert page.input_value('#push-url') == 'https://x.workers.dev'
    b.close()
print('OK backup', n)
