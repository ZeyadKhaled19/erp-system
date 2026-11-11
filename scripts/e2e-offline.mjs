/**
 * اختبار قبول حقيقي للعمل دون اتصال على متصفح Edge/Chrome المثبت (بدون مكتبات إضافية):
 * 1) تشغيل خادم مؤقت ببيانات اختبار منفصلة (لا يمس بيانات data/)
 * 2) الدخول وانتظار المزامنة وتسجيل Service Worker
 * 3) إيقاف الخادم ثم إعادة تحميل التطبيق: يجب أن يفتح من الكاش ويعرض «دون اتصال»
 * 4) إضافة صنف دون اتصال ثم إعادة تحميل الصفحة: يجب أن يبقى الصنف وعمليته في الطابور
 * 5) إعادة تشغيل الخادم: يجب أن تُرفع العملية ويظهر الصنف على الخادم
 *
 * التشغيل:  npm run build && node scripts/e2e-offline.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4100;
const BASE = `http://localhost:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'erp-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const browserPath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!browserPath) throw new Error('لم يُعثر على Edge أو Chrome');

let server;
function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'apps/server'),
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: path.join(tmp, 'pg'), BACKUP_DIR: path.join(tmp, 'bk'), JWT_SECRET: 'e2e-secret', ADMIN_INITIAL_PASSWORD: 'admin123', DATABASE_URL: '' },
    stdio: 'ignore',
  });
}
async function waitHealth(up = true) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (up && r.ok) return;
    } catch {
      if (!up) return;
    }
    await sleep(300);
  }
  throw new Error('الخادم لم يستجب');
}
async function stopServer() {
  server.kill();
  await new Promise((r) => server.once('exit', r));
  await sleep(500);
}

// ------------------------------------------------ CDP
const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${path.join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let ws;
let msgId = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        };
        return;
      }
    } catch {
      /* not ready */
    }
    await sleep(200);
  }
  throw new Error('تعذر الاتصال بالمتصفح');
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++msgId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(2500);
}
async function waitFor(expr, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      if (await evaluate(expr)) return true;
    } catch {
      /* page loading */
    }
    await sleep(400);
  }
  return false;
}
const idb = (store, op = 'getAll') => `
  const db = await new Promise((r, j) => { const q = indexedDB.open('erp-local'); q.onsuccess = () => r(q.result); q.onerror = j; });
  const out = await new Promise((r) => { const q = db.transaction('${store}').objectStore('${store}').${op}(); q.onsuccess = () => r(q.result); });
  db.close();`;

try {
  startServer();
  await waitHealth();
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');

  // تسجيل الدخول عبر الواجهة
  await goto(BASE);
  const setVal = (sel, v) => `{ const el = document.querySelector('${sel}'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); }`;
  await waitFor(`return !!document.querySelector('input[autocomplete=username]')`);
  await evaluate(`${setVal('input[autocomplete=username]', 'admin')} ${setVal('input[autocomplete=current-password]', 'admin123')} document.querySelector('form').requestSubmit(); return true;`);
  check('تسجيل الدخول', await waitFor(`return document.body.innerText.includes('آخر العمليات')`));
  check('المزامنة الأولى (سحب البيانات للجهاز)', await waitFor(`${idb('accounts', 'count')} return out > 10;`));
  check('تسجيل Service Worker', await waitFor(`const r = await navigator.serviceWorker.getRegistration(); return !!r?.active;`, 30000));
  await goto(BASE);
  check('الصفحة تحت تحكم Service Worker', await waitFor(`return !!navigator.serviceWorker.controller`));

  // دون اتصال
  await stopServer();
  await goto(`${BASE}/items`);
  check('فتح التطبيق بعد إيقاف الخادم (من الكاش)', await waitFor(`return document.body.innerText.includes('الأصناف')`));
  check('مؤشر «دون اتصال» ظاهر', await waitFor(`return document.body.innerText.includes('دون اتصال')`, 25000));

  // إضافة صنف دون اتصال
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('صنف جديد')).click(); return true;`);
  await sleep(800);
  await evaluate(`
    const inputs = [...document.querySelectorAll('.sheet input.input')];
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const set = (el, v) => { s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(inputs[0], 'صنف أُضيف دون اتصال');
    return true;`);
  await sleep(300);
  await evaluate(`[...document.querySelectorAll('.sheet-foot button')].find((b) => b.innerText.includes('حفظ وإغلاق')).click(); return true;`);
  check('الصنف ظاهر محليًا «بانتظار المزامنة»', await waitFor(`return document.body.innerText.includes('صنف أُضيف دون اتصال') && document.body.innerText.includes('بانتظار المزامنة')`));

  // إغلاق وفتح دون اتصال
  await goto(`${BASE}/items`);
  check('بعد إعادة الفتح دون اتصال: الصنف ما زال موجودًا', await waitFor(`return document.body.innerText.includes('صنف أُضيف دون اتصال')`));
  const pendingCount = await evaluate(`${idb('outbox')} return out.filter((e) => e.status === 'pending').length;`);
  check('العملية محفوظة في طابور الجهاز', pendingCount === 1, `pending=${pendingCount}`);

  // عودة الاتصال
  startServer();
  await waitHealth();
  check('رفع العملية تلقائيًا بعد عودة الخادم', await waitFor(`${idb('outbox')} return out.length && out.every((e) => e.status === 'accepted');`, 40000));
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123', device_id: 'e2e-checker-01' }) })).json();
  const pulled = await (await fetch(`${BASE}/api/sync/pull?cursor=0`, { headers: { authorization: `Bearer ${login.token}` } })).json();
  check('الصنف موجود على الخادم المركزي', (pulled.changes.items ?? []).some((i) => i.name === 'صنف أُضيف دون اتصال'));
  check('اختفى «بانتظار المزامنة» من الواجهة', await waitFor(`return !document.body.innerText.includes('بانتظار المزامنة')`, 20000));
} catch (e) {
  console.error(e);
  results.push({ name: 'exception', ok: false });
} finally {
  try { ws?.close(); } catch { /* */ }
  browser.kill();
  server?.kill();
  await sleep(800);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} نجح`);
  process.exit(failed ? 1 : 0);
}
