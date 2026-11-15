import { startLocalServer, type LocalServerOptions } from './local';

/**
 * الخادم جوه برنامج الويندوز: البرنامج (Electron) بيشغّل الملف ده كعملية فرعية
 * وبيبعتله الإعدادات، وبيكلمه برسائل:
 *   ← { type: 'backup', reason }   نسخة فورية (زرار «نسخة دلوقتي»)
 *   ← { type: 'shutdown' }         نسخة لو فيه تغيير، وبعدين قفل
 *   → { type: 'ready', port } | { type: 'backup-done', file, skipped } | { type: 'error', message } | { type: 'log', message }
 */
const send = (m: unknown) => process.send?.(m);
// البرنامج بيكتب الرسائل دي في السجل (من غير console.log علشان ما تتكتبش مرتين)
const log = (message: string) => {
  if (process.send) send({ type: 'log', message });
  else console.log(message);
};

let server: Awaited<ReturnType<typeof startLocalServer>> | null = null;

async function shutdown() {
  try {
    if (server?.backups) {
      const r = await server.backups.backupNow({ reason: 'on-close', onlyIfChanged: true });
      send({ type: 'backup-done', file: r.file, skipped: r.skipped });
    } else {
      send({ type: 'backup-done', file: null, skipped: true });
    }
  } catch (e) {
    send({ type: 'error', message: `فشلت النسخة الاحتياطية: ${(e as Error).message}` });
  }
  try {
    await server?.close();
  } finally {
    send({ type: 'closed' });
    setTimeout(() => process.exit(0), 50);
  }
}

process.on('message', async (m: any) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'start') {
    try {
      server = await startLocalServer({ ...(m.options as LocalServerOptions), log });
      send({ type: 'ready', port: m.options.port });
    } catch (e) {
      send({ type: 'error', message: (e as Error).message, fatal: true });
    }
  } else if (m.type === 'set-copy-dir') {
    server?.backups?.setCopyDir(typeof m.dir === 'string' && m.dir ? m.dir : undefined);
    log(m.dir ? `فولدر النسخة التانية: ${m.dir}` : 'من غير فولدر نسخة تانية');
  } else if (m.type === 'backup') {
    try {
      const r = server?.backups ? await server.backups.backupNow({ reason: m.reason || 'manual' }) : { file: null, skipped: true };
      send({ type: 'backup-done', file: r.file, skipped: r.skipped });
    } catch (e) {
      send({ type: 'error', message: `فشلت النسخة الاحتياطية: ${(e as Error).message}` });
    }
  } else if (m.type === 'shutdown') {
    await shutdown();
  }
});

// لو البرنامج الأب اتقفل فجأة: نقفل قاعدة البيانات بأمان
process.on('disconnect', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
