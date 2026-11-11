import { Download, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Banner, Empty, useUi } from '../components/ui';
import { api } from '../lib/api';
import { useRemote } from '../lib/hooks';
import { loadSession, getDeviceId } from '../lib/session';

export function BackupsPage() {
  const ui = useUi();
  const r = useRemote<{ files: string[] }>('/api/admin/backups');
  const [busy, setBusy] = useState(false);

  const download = async (file: string) => {
    const s = loadSession();
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(file)}`, { headers: { authorization: `Bearer ${s?.token}`, 'x-device-id': getDeviceId() } });
    if (!res.ok) return ui.toast('تعذر التحميل', 'err');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
  };

  return (
    <div className="page narrow">
      <PageHeader
        title="النسخ الاحتياطي"
        sub="تُحفظ النسخ على الخادم. تُؤخذ نسخة تلقائيًا قبل أي تحديث لقاعدة البيانات وقبل أي استعادة."
        actions={
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const x = await api<{ file: string }>('/api/admin/backups', { body: {} });
                ui.toast(`تم إنشاء ${x.file}`);
                r.reload();
              } catch (e) {
                ui.toast((e as Error).message, 'err');
              } finally {
                setBusy(false);
              }
            }}
          >
            <HardDriveDownload /> نسخة الآن
          </button>
        }
      />
      {r.error && <Banner kind="warn">{r.error}</Banner>}
      <Banner kind="info">انسخ ملفات النسخ الاحتياطية دوريًا إلى مكان آخر (فلاشة أو تخزين سحابي)، فالنسخة على نفس الجهاز لا تحمي من تلف القرص.</Banner>
      <div className="list" style={{ marginTop: 14 }}>
        {r.data?.files.length === 0 && <Empty title="لا توجد نسخ بعد" />}
        {r.data?.files.map((f) => (
          <div key={f} className="list-row">
            <div className="title num" style={{ fontSize: 14 }}>{f}</div>
            <button className="icon-btn" title="تحميل" onClick={() => download(f)}><Download /></button>
            <button
              className="btn sm danger"
              onClick={async () => {
                const ok = await ui.confirm({
                  title: 'استعادة هذه النسخة؟',
                  message: 'ستُستبدل كل البيانات الحالية على الخادم بمحتوى النسخة. ستُؤخذ نسخة أمان من الوضع الحالي أولًا، وستعيد كل الأجهزة تحميل البيانات.',
                  confirmLabel: 'استعادة',
                  destructive: true,
                });
                if (!ok) return;
                try {
                  const x = await api<any>('/api/admin/backups/restore', { body: { file: f }, timeoutMs: 120000 });
                  ui.toast(`تمت الاستعادة (${x.rows} سجل). نسخة الأمان: ${x.safety_backup}`);
                  r.reload();
                } catch (e) {
                  ui.toast((e as Error).message, 'err');
                }
              }}
            >
              استعادة
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
