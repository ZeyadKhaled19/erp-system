// برنامج الويندوز: بيشغّل الخادم (قاعدة البيانات + الواجهة) جوه البرنامج، ويفتح السيستم في شباك.
// - الأجهزة التانية على الشبكة بتفتح نفس السيستم من المتصفح على عنوان الجهاز ده (المنفذ 4000).
// - نسخة احتياطية كل ساعة لو فيه تغيير (وأول نسخة كل يوم بتتحفظ 30 يوم).
// - لما تقفل البرنامج: رسالة، وبعدين نسخة احتياطية بآخر البيانات، وبعدين يقفل.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Eco System';
// فولدر البيانات كان باسم البرنامج القديم: لو موجود بنفضل نستخدمه علشان البيانات ما تختفيش بعد التحديث
const LEGACY_NAME = 'نظام إدارة الأعمال';
const legacyUserData = path.join(app.getPath('appData'), LEGACY_NAME);
app.setName(APP_NAME);
if (!process.env.ERP_DESKTOP_DIR && fs.existsSync(path.join(legacyUserData, 'config.json'))) app.setPath('userData', legacyUserData);
// هوية المتصفح لازم تكون حروف إنجليزي بس: Electron بيحط اسم البرنامج فيها، والاسم العربي كان بيخلي
// طبقة الشغل من غير نت (Service Worker) ترفض الطلبات، فالشباك ما بيفتحش من تاني مرة.
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36 ERP-Desktop/${app.getVersion()}`;

// نسخة واحدة بس من البرنامج (التانية بتفتح الشباك الموجود)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- الإعدادات والفولدرات ----------
// للتجربة بس: ERP_DESKTOP_DIR فولدر بيانات منفصل، و ERP_DESKTOP_PORT منفذ تاني (علشان التجربة ما تلمسش البيانات الحقيقية)
if (process.env.ERP_DESKTOP_DIR) app.setPath('userData', process.env.ERP_DESKTOP_DIR);
const userData = app.getPath('userData');
const configFile = path.join(userData, 'config.json');
function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { /* أول تشغيل */ }
  let changed = false;
  if (!c.jwtSecret) { c.jwtSecret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if (!c.port) { c.port = Number(process.env.ERP_DESKTOP_PORT) || 4000; changed = true; }
  if (!c.backupDir) {
    c.backupDir = process.env.ERP_DESKTOP_DIR ? path.join(userData, 'backups') : path.join(app.getPath('documents'), `${APP_NAME} - نسخ احتياطية`);
    changed = true;
  }
  if (c.backupCopyDir === undefined) { c.backupCopyDir = ''; changed = true; }
  if (changed) saveConfig(c);
  return c;
}
function saveConfig(c) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2));
}
let config = loadConfig();

const appDir = path.join(__dirname, 'app');
const serverFile = path.join(appDir, 'server.mjs');
const logFile = path.join(userData, 'server.log');
function writeLog(line) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* السجل مش أساسي */ }
}

// كل الرسائل بتعدي من هنا. للتجربة الآلية بس: ERP_DESKTOP_AUTOCLICK=1 بيكتب الرسالة في السجل ويختار الزرار الافتراضي
function showBox(a, b) {
  const opts = b || a;
  if (process.env.ERP_DESKTOP_AUTOCLICK === '1') {
    const choice = opts.defaultId ?? 0;
    writeLog(`[رسالة] ${opts.message} | ${String(opts.detail || '').replace(/\n+/g, ' / ')} | اختيار: ${(opts.buttons || [])[choice]}`);
    return Promise.resolve({ response: choice, checkboxChecked: false });
  }
  return b ? dialog.showMessageBox(a, b) : dialog.showMessageBox(a);
}

// ---------- الخادم ----------
let server = null;
let serverReady = false;
const waiters = new Map(); // نوع الرسالة ← دوال مستنية

function waitFor(type, ms) {
  return new Promise((resolve, reject) => {
    const list = waiters.get(type) || [];
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    list.push((m) => { clearTimeout(t); resolve(m); });
    waiters.set(type, list);
  });
}

function startServer() {
  server = fork(serverFile, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.on('data', (d) => writeLog(String(d).trim()));
  server.stderr.on('data', (d) => writeLog('ERR ' + String(d).trim()));
  server.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'log') {
      writeLog(m.message);
      if (/قبل التحديث/.test(m.message)) setSplashStatus('بياخد نسخة احتياطية قبل تحديث قاعدة البيانات…');
      else if (/تم تطبيق/.test(m.message)) setSplashStatus('بيحدّث قاعدة البيانات…');
      else if (/الخادم يعمل/.test(m.message)) setSplashStatus('بيفتح السيستم…');
    }
    if (m.type === 'error') writeLog('ERROR ' + m.message);
    const list = waiters.get(m.type);
    if (list && list.length) { waiters.set(m.type, []); list.forEach((fn) => fn(m)); }
    if (m.type === 'error' && m.fatal) {
      const busy = /EADDRINUSE/.test(m.message);
      dialog.showErrorBox(APP_NAME, busy
        ? `المنفذ ${config.port} مستخدم من برنامج تاني (غالبًا السيستم شغال بالفعل على الجهاز ده من طريقة تانية).\nاقفل التشغيل التاني وافتح البرنامج تاني.`
        : `السيستم ما قدرش يشتغل:\n${m.message}\n\nالسجل: ${logFile}`);
      quitting = true;
      app.exit(1);
    }
  });
  server.on('exit', (code) => {
    writeLog(`الخادم وقف (code ${code})`);
    server = null;
    serverReady = false;
    if (!quitting) {
      dialog.showErrorBox(APP_NAME, `السيستم وقف بشكل غير متوقع. هيتقفل البرنامج — افتحه تاني.\nالسجل: ${logFile}`);
      quitting = true;
      app.exit(1);
    }
  });
  server.send({
    type: 'start',
    options: {
      port: config.port,
      dataDir: path.join(userData, 'data', 'pg'),
      backupDir: config.backupDir,
      webDist: path.join(appDir, 'web'),
      jwtSecret: config.jwtSecret,
      autoBackup: true,
      backupCopyDir: config.backupCopyDir || undefined,
      backupEveryMinutes: 60,
      backupKeep: 30,
      backupKeepHourly: 48,
    },
  });
}

// ---------- الشباك ----------
let win = null;
let quitting = false;

const page = (title, body) =>
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#15171C;color:#E5E7EB;font:16px "Segoe UI",Tahoma,sans-serif}
.b{text-align:center}.n{direction:ltr;font-size:26px;font-weight:800;letter-spacing:1px;margin-bottom:22px;background:linear-gradient(90deg,#FB923C,#FDBA74,#F3F4F6,#FB923C);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sh 4s linear infinite}
.s{width:40px;height:40px;border:4px solid #ffffff1a;border-top-color:#EA580C;border-radius:50%;margin:0 auto 18px;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}@keyframes sh{to{background-position:300% 0}}small{display:block;margin-top:8px;color:#9CA3AF}</style></head><body><div class="b"><div class="n">${APP_NAME}</div><div class="s"></div>${body}</div></body></html>`);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

// ---------- شاشة البداية المتحركة ----------
// شباك صغير من غير إطار بيظهر فورًا لحد ما السيستم يفتح، وبعدين الشباك الأساسي يظهر مكانه
let splash = null;
let splashShownAt = 0;
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function splashHtml() {
  // شعار Eco System (من ملفات الواجهة)، ولو مش موجود أيقونة البرنامج
  let logo = '';
  try { logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(appDir, 'web', 'eco-logo.svg')).toString('base64'); } catch { /* نجرب الأيقونة */ }
  if (!logo) {
    try { logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'build', 'icon.png')).toString('base64'); } catch { /* من غير لوجو */ }
  }
  const company = config.brand && config.brand.company_name ? esc(config.brand.company_name) : '';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}
body{display:grid;place-items:center;font-family:"Segoe UI",Tahoma,sans-serif;color:#E5E7EB;
  background:#15171C;-webkit-app-region:drag}
.wrap{text-align:center;width:100%;padding:0 40px}
.logo{position:relative;width:96px;height:96px;margin:0 auto 22px}
.logo img{position:relative;z-index:2;width:96px;height:96px;object-fit:contain;border-radius:22px;animation:pop .7s cubic-bezier(.2,.9,.3,1.3) both}
.logo i{position:absolute;inset:-10px;border-radius:30px;border:2px solid #EA580C;opacity:0;animation:ring 2.2s ease-out infinite}
.logo i+i{animation-delay:1.1s}
h1{margin:0;font-size:34px;font-weight:800;letter-spacing:1px;direction:ltr;
  background:linear-gradient(90deg,#FB923C,#FDBA74,#F3F4F6,#FB923C);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 4s linear infinite, up .6s .15s ease-out both}
.co{margin-top:6px;font-size:14px;color:#9CA3AF;animation:up .6s .25s ease-out both}
.bar{position:relative;height:4px;margin:28px auto 12px;max-width:260px;border-radius:99px;background:#ffffff14;overflow:hidden}
.bar b{position:absolute;inset:0 auto 0 0;width:40%;border-radius:99px;background:linear-gradient(90deg,#C2410C,#FB923C);animation:slide 1.3s ease-in-out infinite}
#st{font-size:13px;color:#CBD5E1;min-height:18px;transition:opacity .25s}
.v{position:fixed;bottom:12px;left:0;right:0;text-align:center;font-size:11px;color:#6B7280;direction:ltr}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes ring{0%{transform:scale(.85);opacity:.7}100%{transform:scale(1.35);opacity:0}}
@keyframes shine{to{background-position:300% 0}}
@keyframes up{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><div class="wrap">
<div class="logo">${logo ? `<i></i><i></i><img src="${logo}" alt="">` : ''}</div>
<h1>${esc((config.brand && config.brand.system_name) || APP_NAME)}</h1>${company ? `<div class="co">${company}</div>` : ''}
<div class="bar"><b></b></div><div id="st">بيجهّز البرنامج…</div></div>
<div class="v">v${app.getVersion()}</div>
<script>window.setStatus=function(t){var e=document.getElementById('st');e.style.opacity=0;setTimeout(function(){e.textContent=t;e.style.opacity=1},180)}</script>
</body></html>`);
}

function showSplash() {
  splash = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: false,
    title: APP_NAME,
    backgroundColor: '#15171C',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  splash.once('ready-to-show', () => { splashShownAt = Date.now(); splash && splash.show(); });
  splash.on('closed', () => { splash = null; });
  void splash.loadURL(splashHtml());
}

function setSplashStatus(text) {
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

/** الشباك الأساسي يظهر والشاشة المتحركة تختفي (بعد ثانية ونص على الأقل علشان ما تومضش) */
function revealMain() {
  const wait = Math.max(0, 1500 - (Date.now() - splashShownAt));
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) { win.maximize(); win.show(); win.focus(); }
    if (splash && !splash.isDestroyed()) splash.close();
  }, wait);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    backgroundColor: '#15171C',
    autoHideMenuBar: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  setupShortcuts(win);
  // الواجهة بتتحمّل من جديد (تحديث صفحة): نستنى تقول إنها جاهزة تاني
  win.webContents.on('did-navigate', (_e, url) => { writeLog('did-navigate ' + url); rendererReady = false; cancelAsks(); });
  // روابط بره السيستم تفتح في المتصفح العادي
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${config.port}`)) { void shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    void confirmAndQuit();
  });
}

// ---------- الجسر مع الواجهة ----------
// لما الواجهة تكون فاتحة جوه الشباك، رسايل التحديث وتأكيد القفل وحالة النسخة بتظهر جوه السيستم نفسه
// (بنفس شكله) بدل رسايل ويندوز. لو الواجهة مش جاهزة (أو في التجربة الآلية) بنرجع لرسايل ويندوز.
let rendererReady = false;
let askSeq = 0;
const pendingAsks = new Map();
const useRenderer = () => rendererReady && win && !win.isDestroyed();
const toRenderer = (m) => { if (win && !win.isDestroyed()) win.webContents.send('eco:event', m); };

/**
 * سؤال للواجهة وانتظار الرد. لو الواجهة ما أكدتش إن الرسالة ظهرت خلال 3 ثواني (أو الصفحة اتحمّلت من جديد)
 * بيرجع undefined، فبنعرض رسالة ويندوز بدالها. بعد التأكيد بنستنى رد المستخدم براحته (لحد `ms`).
 */
function askRenderer(type, payload, ms) {
  return new Promise((resolve) => {
    const id = ++askSeq;
    let timer = setTimeout(() => finish(undefined), 3000);
    const finish = (v) => { clearTimeout(timer); pendingAsks.delete(id); resolve(v); };
    pendingAsks.set(id, { finish, ack: () => { clearTimeout(timer); timer = setTimeout(() => finish(undefined), ms); } });
    toRenderer({ type, id, ...payload });
  });
}
const cancelAsks = () => { for (const p of [...pendingAsks.values()]) p.finish(undefined); };

/** الطلب جاي من شباك السيستم نفسه (مش من أي حاجة تانية) */
function fromApp(e) {
  try {
    return !!win && e.sender === win.webContents && new URL(e.senderFrame.url).origin === `http://localhost:${config.port}`;
  } catch {
    return false;
  }
}

function listLastBackup() {
  try {
    const files = fs.readdirSync(config.backupDir).filter((f) => /^erp-backup-.*\.json$/.test(f)).sort().reverse();
    if (!files.length) return null;
    return { file: files[0], at: fs.statSync(path.join(config.backupDir, files[0])).mtime.toISOString() };
  } catch {
    return null;
  }
}

async function serverBackup(reason) {
  if (!server || !serverReady) throw new Error('السيستم لسه بيشتغل');
  const done = waitFor('backup-done', 120000);
  const failed = waitFor('error', 120000).then((m) => { throw new Error(m.message); });
  server.send({ type: 'backup', reason });
  return Promise.race([done, failed]);
}

function setupBridge() {
  ipcMain.on('eco:ready', (e) => {
    if (!fromApp(e)) return;
    rendererReady = true;
    writeLog('الواجهة جاهزة (رسايل البرنامج هتظهر جوه السيستم)');
    toRenderer({ type: 'update', ...updateState });
  });
  ipcMain.on('eco:ack', (e, m) => {
    if (!fromApp(e) || !m) return;
    const p = pendingAsks.get(m.id);
    if (p) p.ack();
  });
  ipcMain.on('eco:reply', (e, m) => {
    if (!fromApp(e) || !m) return;
    const p = pendingAsks.get(m.id);
    if (p) p.finish(m.value);
  });
  const handle = (name, fn) => ipcMain.handle(name, (e, ...args) => {
    if (!fromApp(e)) throw new Error('غير مسموح');
    return fn(...args);
  });
  handle('eco:info', () => ({
    version: app.getVersion(),
    port: config.port,
    lan: lanAddresses().map((ip) => `http://${ip}:${config.port}`),
    backupDir: config.backupDir,
    backupCopyDir: config.backupCopyDir || '',
    dataDir: userData,
    lastBackup: listLastBackup(),
    update: updateState,
    packaged: app.isPackaged,
  }));
  handle('eco:backup', async () => {
    const r = await serverBackup('manual');
    return { file: r.file ? path.basename(r.file) : null, skipped: !!r.skipped, backupDir: config.backupDir };
  });
  handle('eco:open-backups', () => { fs.mkdirSync(config.backupDir, { recursive: true }); return shell.openPath(config.backupDir); });
  handle('eco:open-data', () => shell.openPath(userData));
  handle('eco:choose-copy', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'فولدر النسخة التانية', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    config = { ...config, backupCopyDir: r.filePaths[0] };
    saveConfig(config);
    if (server) server.send({ type: 'set-copy-dir', dir: r.filePaths[0] });
    return r.filePaths[0];
  });
  handle('eco:clear-copy', () => {
    config = { ...config, backupCopyDir: '' };
    saveConfig(config);
    if (server) server.send({ type: 'set-copy-dir', dir: '' });
    return true;
  });
  handle('eco:check-updates', () => checkForUpdatesNow());
  handle('eco:install-update', () => {
    if (!updateReady) return false;
    void confirmAndQuit({ ask: false });
    return true;
  });
}

// ---------- القفل: سؤال ← نسخة احتياطية ← رسالة بالنتيجة ← قفل (أو تسطيب التحديث) ----------
// ask=false: من غير سؤال (مثلًا «حدّث دلوقتي»)
async function confirmAndQuit({ ask = true } = {}) {
  const viaApp = useRenderer();
  writeLog(`قفل البرنامج: ${viaApp ? 'رسالة جوه السيستم' : 'رسالة ويندوز'} (rendererReady=${rendererReady})`);
  if (ask) {
    let ok;
    if (viaApp) ok = await askRenderer('confirm-close', { updateVersion: updateReady }, 6 * 3600 * 1000);
    if (viaApp && ok === undefined) writeLog('الواجهة ما أكدتش الرسالة — هعرض رسالة ويندوز');
    if (ok === undefined) {
      const { response } = await showBox(win, {
        type: 'question',
        title: APP_NAME,
        message: 'قفل البرنامج؟',
        detail: 'هيتعمل نسخة احتياطية بآخر البيانات قبل القفل.' +
          (updateReady ? `\nوهيتسطب التحديث الجديد (نسخة ${updateReady}) — البيانات مش هتتلمس.` : '') +
          '\nالأجهزة التانية على الشبكة مش هتقدر تتصل لحد ما تفتح البرنامج تاني (وشغلها بيتحفظ عندها لحد ما ترجع).',
        buttons: [updateReady ? 'نسخ احتياطي وتحديث وقفل' : 'نسخ احتياطي وقفل', 'إلغاء'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      ok = response === 0;
    }
    if (!ok) return;
  }
  quitting = true;
  if (viaApp) toRenderer({ type: 'closing', stage: 'backup', updateVersion: updateReady });
  else if (win && !win.isDestroyed()) win.loadURL(page('نسخ احتياطي', 'جاري عمل نسخة احتياطية بآخر البيانات…<small>ما تقفلش الجهاز</small>'));
  let result = null;
  let error = null;
  if (server && serverReady) {
    try {
      const done = waitFor('backup-done', 120000);
      const failed = waitFor('error', 120000).then((m) => { throw new Error(m.message); });
      server.send({ type: 'shutdown' });
      result = await Promise.race([done, failed]);
      // السيرفر بيقفل قاعدة البيانات بعد النسخة؛ لو اتأخر (اتصالات مفتوحة) ما نستناش أكتر من 5 ثواني
      await waitFor('closed', 5000).catch(() => {});
    } catch (e) {
      error = e;
    }
  }
  if (viaApp) {
    // النتيجة بتظهر جوه السيستم؛ الواجهة بترد بعد ما المستخدم يشوفها (أو بعد ثانيتين ونص لوحدها)
    await askRenderer('closing-done', {
      result: { file: result && result.file ? path.basename(result.file) : null, skipped: !!(result && result.skipped), error: error ? error.message : null },
      backupDir: config.backupDir,
      copyDir: config.backupCopyDir || '',
      updateVersion: updateReady,
    }, 8000);
  } else {
    const opts = { type: error ? 'warning' : 'info', title: APP_NAME, buttons: ['تمام'], noLink: true };
    if (error) {
      await showBox({ ...opts, message: 'ما قدرتش أعمل نسخة احتياطية', detail: `${error.message}\nآخر نسخة تلقائية موجودة في:\n${config.backupDir}` });
    } else if (result && result.file) {
      await showBox({ ...opts, message: 'تم عمل نسخة احتياطية بآخر البيانات ✓', detail: `${path.basename(result.file)}\n\nفي الفولدر:\n${config.backupDir}${config.backupCopyDir ? `\n\nواتنسخت كمان في:\n${config.backupCopyDir}` : ''}` });
    } else if (result) {
      await showBox({ ...opts, message: 'البيانات محفوظة ✓', detail: `مفيش أي تغيير من آخر نسخة احتياطية، فآخر نسخة هي نفس البيانات.\n\nالنسخ في:\n${config.backupDir}` });
    }
  }
  if (server) server.kill();
  if (updateReady && autoUpdater) {
    // التحديث بيتسطب في الخلفية والبرنامج بيفتح تاني لوحده بالنسخة الجديدة
    writeLog(`تسطيب التحديث ${updateReady}`);
    autoUpdater.quitAndInstall(true, true);
    setTimeout(() => app.exit(0), 5000);
    return;
  }
  app.exit(0);
}

// ---------- التحديث التلقائي ----------
// البرنامج بيشوف كل ما يفتح (وكل 4 ساعات) لو فيه نسخة جديدة على GitHub Releases، ينزّلها في الخلفية،
// ويسأل (جوه السيستم): يحدّث دلوقتي (بعد نسخة احتياطية) ولا لما يتقفل. بيانات العميل في فولدر لوحده فما بتتلمسش.
let autoUpdater = null;
let updateReady = null; // رقم النسخة الجديدة لما تكون نزلت وجاهزة
let updateState = { state: app.isPackaged ? 'idle' : 'unavailable', version: null, percent: 0 };
function setUpdateState(s) {
  updateState = { ...updateState, ...s };
  toRenderer({ type: 'update', ...updateState });
}

function setupUpdates() {
  if (!app.isPackaged || process.env.ERP_DESKTOP_NO_UPDATES === '1') return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    writeLog('التحديث التلقائي مش متاح: ' + e.message);
    setUpdateState({ state: 'unavailable' });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // التسطيب بيحصل من confirmAndQuit بعد النسخة الاحتياطية
  autoUpdater.logger = { info: (m) => writeLog('update: ' + m), warn: (m) => writeLog('update WARN: ' + m), error: (m) => writeLog('update ERROR: ' + m), debug: () => {} };
  autoUpdater.on('checking-for-update', () => { if (!updateReady) setUpdateState({ state: 'checking' }); });
  autoUpdater.on('update-available', (info) => {
    writeLog(`نسخة جديدة متاحة: ${info.version} — بتنزل في الخلفية`);
    setUpdateState({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => setUpdateState({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-not-available', () => { if (!updateReady) setUpdateState({ state: 'none', version: null }); });
  autoUpdater.on('error', (e) => {
    writeLog('update error: ' + (e && e.message));
    if (!updateReady) setUpdateState({ state: 'error' });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    updateReady = info.version;
    setUpdateState({ state: 'ready', version: info.version, percent: 100 });
    if (quitting || !win || win.isDestroyed()) return;
    if (useRenderer()) return; // الواجهة بتعرض «نسخة جديدة جاهزة» بنفسها
    const { response } = await showBox(win, {
      type: 'info',
      title: APP_NAME,
      message: `نسخة جديدة جاهزة (${info.version})`,
      detail: 'تحب تحدّث دلوقتي؟ هيتعمل نسخة احتياطية الأول، وبعدين البرنامج يقفل ويفتح تاني بالنسخة الجديدة (حوالي دقيقة).\nأو كمّل شغلك، والتحديث هيتسطب لوحده لما تقفل البرنامج.',
      buttons: ['حدّث دلوقتي', 'لما أقفل البرنامج'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) void confirmAndQuit({ ask: false });
  });
  const check = () => autoUpdater.checkForUpdates().catch((e) => writeLog('update check failed: ' + e.message));
  setTimeout(check, 15000);
  setInterval(check, 4 * 3600 * 1000).unref?.();
}

/** بحث يدوي (من صفحة «برنامج الويندوز» في السيستم): بيرجع الحالة */
async function checkForUpdatesNow() {
  if (!autoUpdater) return { state: 'unavailable', version: null };
  if (updateReady) return { state: 'ready', version: updateReady };
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (v && v !== app.getVersion()) return { state: 'downloading', version: v };
    return { state: 'none', version: null };
  } catch (e) {
    return { state: 'error', version: null, error: e.message };
  }
}

// ---------- اختصارات الكيبورد (من غير شريط القوائم) ----------
function buildMenu() {
  Menu.setApplicationMenu(null);
}
function setupShortcuts(w) {
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const k = input.key;
    const hit = (fn) => { e.preventDefault(); fn(); };
    if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) hit(() => w.webContents.reload());
    else if (k === 'F11') hit(() => w.setFullScreen(!w.isFullScreen()));
    else if (ctrl && input.shift && k.toLowerCase() === 'i') hit(() => w.webContents.toggleDevTools());
    else if (ctrl && (k === '=' || k === '+')) hit(() => w.webContents.setZoomLevel(Math.min(w.webContents.getZoomLevel() + 0.5, 4)));
    else if (ctrl && k === '-') hit(() => w.webContents.setZoomLevel(Math.max(w.webContents.getZoomLevel() - 0.5, -3)));
    else if (ctrl && k === '0') hit(() => w.webContents.setZoomLevel(0));
  });
}

// ---------- التشغيل ----------
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  buildMenu();
  setupBridge();
  showSplash();
  createWindow();
  startServer();
  setupUpdates();
  setSplashStatus('بيشغّل قاعدة البيانات…');
  try {
    await waitFor('ready', 120000);
  } catch {
    revealMain();
    // رسالة مش بتوقف البرنامج (showErrorBox كانت بتجمّد كل حاجة لحد ما حد يدوس عليها)
    if (!quitting) void showBox(win, { type: 'error', title: APP_NAME, message: 'السيستم أخد وقت طويل يشتغل', detail: `جرّب تقفل البرنامج وتفتحه تاني.\nالسجل: ${logFile}`, buttons: ['تمام'], noLink: true });
    return;
  }
  serverReady = true;
  void rememberBrand();
  await loadApp();
});

// اسم ولوجو الشركة بيتحفظوا علشان الشاشة المتحركة تعرضهم من أول ثانية المرة الجاية
async function rememberBrand() {
  try {
    const b = await (await fetch(`http://localhost:${config.port}/api/brand`)).json();
    const brand = { company_name: b.company_name || '', system_name: b.system_name || '', logo: typeof b.logo === 'string' && b.logo.length < 400000 ? b.logo : null };
    if (JSON.stringify(brand) !== JSON.stringify(config.brand || null)) { config = { ...config, brand }; saveConfig(config); }
  } catch { /* مش مهم */ }
}

// فتح السيستم في الشباك؛ لو الصفحة ما فتحتش بنحاول تاني (من غير ما نوقف البرنامج)
async function loadApp(attempt = 1) {
  if (!win || win.isDestroyed() || quitting) return;
  try {
    await win.loadURL(`http://localhost:${config.port}/`);
    revealMain();
  } catch (e) {
    writeLog(`فتح الصفحة فشل (محاولة ${attempt}): ${e.message}`);
    if (attempt === 2) {
      // آخر حل: نمسح ملفات الواجهة المتخزنة (مش البيانات) ونحاول من الأول
      try { await win.webContents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch { /* مش مهم */ }
    }
    if (attempt < 4) setTimeout(() => void loadApp(attempt + 1), 1500);
    else if (revealMain() === undefined) void showBox(win, { type: 'error', title: APP_NAME, message: 'الصفحة مش راضية تفتح', detail: `السيستم شغال، بس الشباك ما قدرش يفتحه. جرّب «عرض ← تحديث الصفحة» أو اقفل البرنامج وافتحه تاني.\nالسجل: ${logFile}`, buttons: ['تمام'], noLink: true });
  }
}

// قفل ويندوز نفسه (Shut down / Sign out): مفيش وقت لرسالة، بس بنحاول ناخد النسخة ونقفل قاعدة البيانات بأمان
app.on('session-end', () => {
  quitting = true;
  if (server && serverReady) server.send({ type: 'shutdown' });
});

app.on('window-all-closed', () => {
  if (quitting) app.exit(0);
});
