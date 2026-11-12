// 產生推播用的金鑰與密碼。在電腦上執行一次：  node server/generate-keys.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
void publicKey;

console.log('把下面三行分別填進 Cloudflare 的設定，以及 App 設定頁：\n');
console.log('VAPID_PUBLIC  （公開的，也要填進 App）：');
console.log(b64u(pub));
console.log('\nVAPID_PRIVATE （私密，只填進 Cloudflare，不要給任何人）：');
console.log(jwk.d);
console.log('\nAPP_SECRET    （密碼，Cloudflare 與 App 都要填，要給朋友時私下傳給他們）：');
console.log(b64u(randomBytes(24)));
