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

const APP_NAME = 'نظام إدارة الأعمال';
app.setName(APP_NAME);
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
    if (m.type === 'log') writeLog(m.message);
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
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#15171C;color:#F3F4F6;font:16px "Segoe UI",Tahoma,sans-serif}
.b{text-align:center}.s{width:42px;height:42px;border:4px solid #3A3D45;border-top-color:#3B82F6;border-radius:50%;margin:0 auto 18px;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}small{display:block;margin-top:8px;color:#9CA3AF}</style></head><body><div class="b"><div class="s"></div>${body}</div></body></html>`);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#15171C',
    autoHideMenuBar: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.maximize();
  win.loadURL(page(APP_NAME, `جاري تشغيل السيستم…<small>${APP_NAME}</small>`));
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

// ask=false: من غير سؤال (مثلًا «حدّث دلوقتي» من رسالة التحديث)
async function confirmAndQuit({ ask = true } = {}) {
  if (ask) {
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
    if (response !== 0) return;
  }
  quitting = true;
  if (win && !win.isDestroyed()) win.loadURL(page('نسخ احتياطي', 'جاري عمل نسخة احتياطية بآخر البيانات…<small>ما تقفلش الجهاز</small>'));
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
  const opts = { type: error ? 'warning' : 'info', title: APP_NAME, buttons: ['تمام'], noLink: true };
  if (error) {
    await showBox({ ...opts, message: 'ما قدرتش أعمل نسخة احتياطية', detail: `${error.message}\nآخر نسخة تلقائية موجودة في:\n${config.backupDir}` });
  } else if (result && result.file) {
    await showBox({ ...opts, message: 'تم عمل نسخة احتياطية بآخر البيانات ✓', detail: `${path.basename(result.file)}\n\nفي الفولدر:\n${config.backupDir}${config.backupCopyDir ? `\n\nواتنسخت كمان في:\n${config.backupCopyDir}` : ''}` });
  } else if (result) {
    await showBox({ ...opts, message: 'البيانات محفوظة ✓', detail: `مفيش أي تغيير من آخر نسخة احتياطية، فآخر نسخة هي نفس البيانات.\n\nالنسخ في:\n${config.backupDir}` });
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
// ويسأل: يحدّث دلوقتي (بعد نسخة احتياطية) ولا لما يتقفل. بيانات العميل في فولدر لوحده فما بتتلمسش.
let autoUpdater = null;
let updateReady = null; // رقم النسخة الجديدة لما تكون نزلت وجاهزة
let manualCheck = false;

function setupUpdates() {
  if (!app.isPackaged || process.env.ERP_DESKTOP_NO_UPDATES === '1') return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    writeLog('التحديث التلقائي مش متاح: ' + e.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // التسطيب بيحصل من confirmAndQuit بعد النسخة الاحتياطية
  autoUpdater.logger = { info: (m) => writeLog('update: ' + m), warn: (m) => writeLog('update WARN: ' + m), error: (m) => writeLog('update ERROR: ' + m), debug: () => {} };
  autoUpdater.on('update-available', (info) => {
    writeLog(`نسخة جديدة متاحة: ${info.version} — بتنزل في الخلفية`);
    if (manualCheck) void showBox(win, { type: 'info', title: APP_NAME, message: `فيه نسخة جديدة (${info.version})`, detail: 'بتنزل دلوقتي في الخلفية، وهقولك أول ما تجهز. كمّل شغلك عادي.', buttons: ['تمام'], noLink: true });
    manualCheck = false;
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) void showBox(win, { type: 'info', title: APP_NAME, message: 'البرنامج محدّث ✓', detail: `انت على آخر نسخة (${app.getVersion()}).`, buttons: ['تمام'], noLink: true });
    manualCheck = false;
  });
  autoUpdater.on('error', (e) => {
    writeLog('update error: ' + (e && e.message));
    if (manualCheck) void showBox(win, { type: 'warning', title: APP_NAME, message: 'ما قدرتش أشوف التحديثات', detail: 'اتأكد إن الجهاز متوصل بالنت وجرّب تاني.', buttons: ['تمام'], noLink: true });
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    updateReady = info.version;
    buildMenu();
    if (quitting || !win || win.isDestroyed()) return;
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

function checkForUpdatesNow() {
  if (!autoUpdater) {
    void showBox(win, { type: 'info', title: APP_NAME, message: 'التحديث التلقائي شغال في النسخة المتسطّبة بس', buttons: ['تمام'], noLink: true });
    return;
  }
  if (updateReady) {
    void showBox(win, { type: 'info', title: APP_NAME, message: `التحديث ${updateReady} جاهز`, detail: 'هيتسطب لما تقفل البرنامج.', buttons: ['تمام'], noLink: true });
    return;
  }
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

// ---------- القايمة ----------
function buildMenu() {
  const template = [
    {
      label: 'النسخ الاحتياطي',
      submenu: [
        {
          label: 'نسخة احتياطية دلوقتي',
          click: async () => {
            if (!server || !serverReady) return;
            try {
              const done = waitFor('backup-done', 120000);
              server.send({ type: 'backup', reason: 'manual' });
              const r = await done;
              await showBox(win, { type: 'info', title: APP_NAME, message: 'تم عمل نسخة احتياطية ✓', detail: r.file ? path.basename(r.file) : '', buttons: ['تمام'], noLink: true });
            } catch (e) {
              void showBox(win, { type: 'error', title: APP_NAME, message: 'ما قدرتش أعمل نسخة احتياطية', detail: e.message, buttons: ['تمام'], noLink: true });
            }
          },
        },
        { label: 'افتح فولدر النسخ', click: () => { fs.mkdirSync(config.backupDir, { recursive: true }); void shell.openPath(config.backupDir); } },
        { type: 'separator' },
        {
          label: 'اختار فولدر نسخة تانية (فلاشة / هارد خارجي / Google Drive)…',
          click: async () => {
            const r = await dialog.showOpenDialog(win, { title: 'فولدر النسخة التانية', properties: ['openDirectory', 'createDirectory'] });
            if (r.canceled || !r.filePaths[0]) return;
            config = { ...config, backupCopyDir: r.filePaths[0] };
            saveConfig(config);
            await showBox(win, { type: 'info', title: APP_NAME, message: 'تمام ✓', detail: `كل نسخة هتتنسخ كمان في:\n${r.filePaths[0]}\n\n(بيتطبق من أول مرة تفتح فيها البرنامج تاني)`, buttons: ['تمام'], noLink: true });
          },
        },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { label: 'تحديث الصفحة', accelerator: 'F5', click: () => win && win.webContents.reload() },
        { label: 'تكبير', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'تصغير', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'الحجم العادي', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'ملء الشاشة', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'مساعدة',
      submenu: [
        {
          label: updateReady ? `التحديث ${updateReady} جاهز — هيتسطب لما تقفل` : 'البحث عن تحديثات',
          click: () => checkForUpdatesNow(),
        },
        {
          label: 'عن البرنامج',
          click: () => void showBox(win, { type: 'info', title: APP_NAME, message: APP_NAME, detail: `النسخة ${app.getVersion()}`, buttons: ['تمام'], noLink: true }),
        },
        { type: 'separator' },
        {
          label: 'عنوان السيستم للأجهزة التانية',
          click: () => {
            const ips = lanAddresses();
            void showBox(win, {
              type: 'info',
              title: APP_NAME,
              message: 'افتح العنوان ده من أي جهاز على نفس الشبكة:',
              detail: (ips.length ? ips.map((ip) => `http://${ip}:${config.port}`).join('\n') : 'الجهاز مش متوصل بشبكة') + '\n\nلو الجهاز التاني مش شايفه: لما ويندوز يسألك «Allow access» للبرنامج اختار السماح.',
              buttons: ['تمام'],
              noLink: true,
            });
          },
        },
        { label: 'فولدر البيانات والسجل', click: () => void shell.openPath(userData) },
        { label: 'أدوات المطوّر', accelerator: 'Ctrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- التشغيل ----------
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  buildMenu();
  createWindow();
  startServer();
  setupUpdates();
  try {
    await waitFor('ready', 120000);
  } catch {
    // رسالة مش بتوقف البرنامج (showErrorBox كانت بتجمّد كل حاجة لحد ما حد يدوس عليها)
    if (!quitting) void showBox(win, { type: 'error', title: APP_NAME, message: 'السيستم أخد وقت طويل يشتغل', detail: `جرّب تقفل البرنامج وتفتحه تاني.\nالسجل: ${logFile}`, buttons: ['تمام'], noLink: true });
    return;
  }
  serverReady = true;
  await loadApp();
});

// فتح السيستم في الشباك؛ لو الصفحة ما فتحتش بنحاول تاني (من غير ما نوقف البرنامج)
async function loadApp(attempt = 1) {
  if (!win || win.isDestroyed() || quitting) return;
  try {
    await win.loadURL(`http://localhost:${config.port}/`);
  } catch (e) {
    writeLog(`فتح الصفحة فشل (محاولة ${attempt}): ${e.message}`);
    if (attempt === 2) {
      // آخر حل: نمسح ملفات الواجهة المتخزنة (مش البيانات) ونحاول من الأول
      try { await win.webContents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch { /* مش مهم */ }
    }
    if (attempt < 4) setTimeout(() => void loadApp(attempt + 1), 1500);
    else void showBox(win, { type: 'error', title: APP_NAME, message: 'الصفحة مش راضية تفتح', detail: `السيستم شغال، بس الشباك ما قدرش يفتحه. جرّب «عرض ← تحديث الصفحة» أو اقفل البرنامج وافتحه تاني.\nالسجل: ${logFile}`, buttons: ['تمام'], noLink: true });
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
void ipcMain;
