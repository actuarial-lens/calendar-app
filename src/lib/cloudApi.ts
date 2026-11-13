import { CloudError, MAX_BLOB_CHARS } from './cloudBackup';

export interface CloudConfig {
  endpoint: string;
  secret: string;
}

export interface RemoteItem {
  day: string;
  updatedAt: number;
  size: number;
}

type FetchFn = typeof fetch;

const url = (c: CloudConfig, path: string) => c.endpoint.trim().replace(/\/+$/, '') + path;

async function call(c: CloudConfig, path: string, body: unknown, fetchFn: FetchFn, keepalive = false): Promise<Record<string, unknown>> {
  if (!c.endpoint.trim() || !c.secret.trim()) throw new CloudError('config', '請先在上方「背景提醒」填好伺服器網址與密碼');
  let res: Response;
  try {
    res = await fetchFn(url(c, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.secret.trim()}` },
      body: JSON.stringify(body),
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new CloudError('network', '連不上伺服器，請檢查網路');
  }
  if (res.ok) {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (res.status === 401) throw new CloudError('auth', '伺服器密碼不正確');
  if (res.status === 501) throw new CloudError('no-db', '伺服器還沒設定雲端備份（請依說明建立 D1 資料庫）');
  if (res.status === 413) throw new CloudError('too-large', '資料太大，無法備份');
  if (res.status === 403) throw new CloudError('full', '伺服器上的備份數量已滿');
  if (res.status === 404) throw new CloudError('not-found', '找不到這組還原碼的備份');
  throw new CloudError('server', `伺服器回應 ${res.status}，請檢查設定`);
}

/** 上傳（同一天會覆蓋）。keepalive：App 切到背景時用，瀏覽器限制內容不能超過 64KB */
export async function putBackup(c: CloudConfig, a: { id: string; day: string; blob: string; keepalive?: boolean }, fetchFn: FetchFn = (...x) => fetch(...x)): Promise<void> {
  if (a.blob.length > MAX_BLOB_CHARS) throw new CloudError('too-large', '資料太大，無法備份');
  await call(c, '/backup/put', { id: a.id, day: a.day, blob: a.blob }, fetchFn, a.keepalive);
}

export async function listBackups(c: CloudConfig, id: string, fetchFn: FetchFn = (...x) => fetch(...x)): Promise<RemoteItem[]> {
  const r = await call(c, '/backup/list', { id }, fetchFn);
  const items = Array.isArray(r.items) ? (r.items as RemoteItem[]) : [];
  return items.filter((i) => i && typeof i.day === 'string' && typeof i.updatedAt === 'number');
}

export async function getBackup(c: CloudConfig, id: string, day: string, fetchFn: FetchFn = (...x) => fetch(...x)): Promise<string> {
  const r = await call(c, '/backup/get', { id, day }, fetchFn);
  if (typeof r.blob !== 'string') throw new CloudError('not-found', '找不到這組還原碼的備份');
  return r.blob;
}

export async function deleteBackups(c: CloudConfig, id: string, fetchFn: FetchFn = (...x) => fetch(...x)): Promise<void> {
  await call(c, '/backup/delete', { id }, fetchFn);
}
