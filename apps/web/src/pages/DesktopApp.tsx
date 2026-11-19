import { CheckCircle2, Download, ExternalLink, FolderOpen, HardDrive, Laptop, Loader2, MonitorSmartphone, RefreshCw, ShieldCheck, Wifi, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDesktopUpdate } from '../components/DesktopBridge';
import { SectionCard, SectionHeader } from '../components/Section';
import { useUi } from '../components/ui';
import { getDesktop, type DesktopInfo } from '../lib/desktop';
import '../desktop.css';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ar-EG-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** صفحة «برنامج الويندوز»: التحديثات والنسخ الاحتياطي وعنوان السيستم للأجهزة التانية (جوه البرنامج بس) */
export function DesktopAppPage() {
  const desk = getDesktop();
  const ui = useUi();
  const update = useDesktopUpdate();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (desk) setInfo(await desk.info());
  }, [desk]);
  useEffect(() => { void load(); }, [load]);

  if (!desk) {
    return (
      <div className="page sx-page">
        <SectionHeader icon={<Laptop />} color="blue" title="برنامج الويندوز" sub="التحديثات والتنزيل" />
        <div className="dk-grid">
          <SectionCard icon={<Download />} title="آخر إصدار من برنامج الويندوز">
            <div className="dk-rows">
              <p className="dk-note">أنت فاتح النظام من المتصفح. تقدر من هنا توصل لآخر إصدار من برنامج الويندوز وتنزّله على جهاز المحل.</p>
              <div className="dk-btns">
                <a className="dk-btn primary" href="https://github.com/ZeyadKhaled19/erp-releases/releases/latest" target="_blank" rel="noreferrer">
                  <ExternalLink /> عرض التحديثات والتنزيل
                </a>
              </div>
              <p className="dk-note">تثبيت تحديثات البرنامج والنسخ الاحتياطي وإعداد الأجهزة على الشبكة تقدر تديرهم من داخل برنامج الويندوز على جهاز المحل.</p>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  // حالة التحديث: الأحدث من البرنامج (لو وصلت)، وإلا من آخر قراءة للصفحة
  const u = update.state !== 'idle' ? update : info?.update ?? update;
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      ui.toast((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  const checkNow = () => run('check', async () => {
    setCheckMsg(null);
    const r = await desk.checkUpdates();
    setCheckMsg(r.state === 'none' ? 'انت على آخر نسخة ✓' : r.state === 'downloading' ? `فيه نسخة جديدة (${r.version}) بتنزل دلوقتي في الخلفية` : r.state === 'ready' ? `التحديث ${r.version} جاهز` : r.state === 'unavailable' ? 'التحديث التلقائي شغال في النسخة المتسطّبة بس' : 'ما قدرتش أشوف التحديثات — اتأكد إن الجهاز متوصل بالنت');
  });
  const backupNow = () => run('backup', async () => {
    const r = await desk.backupNow();
    ui.toast(r.file ? `تم عمل نسخة احتياطية ✓ ${r.file}` : 'تم ✓');
    await load();
  });
  const chooseCopy = () => run('copy', async () => {
    const dir = await desk.chooseCopyDir();
    if (dir) ui.toast('كل نسخة هتتنسخ كمان في الفولدر ده ✓');
    await load();
  });
  const clearCopy = () => run('clear', async () => {
    await desk.clearCopyDir();
    await load();
  });
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => ui.toast('اتنسخ ✓'), () => {});
  };

  const badge =
    u.state === 'ready' ? <span className="dk-badge ok"><CheckCircle2 /> تحديث جاهز ({u.version})</span>
    : u.state === 'downloading' ? <span className="dk-badge info"><Loader2 className="spin" /> بينزل تحديث {u.version ? `(${u.version})` : ''}</span>
    : u.state === 'checking' ? <span className="dk-badge info"><Loader2 className="spin" /> بيدوّر على تحديثات</span>
    : u.state === 'none' ? <span className="dk-badge ok"><CheckCircle2 /> آخر نسخة</span>
    : u.state === 'error' ? <span className="dk-badge warn">ما قدرش يشوف التحديثات</span>
    : u.state === 'unavailable' ? <span className="dk-badge">التحديث التلقائي في النسخة المتسطّبة بس</span>
    : <span className="dk-badge">—</span>;

  return (
    <div className="page sx-page">
      <SectionHeader icon={<Laptop />} color="blue" title="برنامج الويندوز" sub="التحديثات والنسخ الاحتياطي وعنوان السيستم للأجهزة التانية" />
      <div className="dk-grid">
        <SectionCard icon={<Download />} title="التحديثات">
          <div className="dk-rows">
            <div className="dk-row"><span className="dk-row-l">النسخة الحالية</span><bdi className="dk-row-v">{info?.version ?? '…'}</bdi></div>
            <div className="dk-row"><span className="dk-row-l">الحالة</span>{badge}</div>
            {u.state === 'downloading' && u.percent > 0 && <div className="dk-progress" aria-label={`${u.percent}%`}><i style={{ width: `${u.percent}%` }} /></div>}
            {checkMsg && <p className="dk-note">{checkMsg}</p>}
            <div className="dk-btns">
              {u.state === 'ready' ? (
                <button type="button" className="dk-btn primary" onClick={() => void desk.installUpdate()}><RefreshCw /> حدّث دلوقتي</button>
              ) : (
                <button type="button" className="dk-btn" onClick={checkNow} disabled={busy === 'check' || u.state === 'checking'}>
                  {busy === 'check' ? <Loader2 className="spin" /> : <RefreshCw />} البحث عن تحديثات
                </button>
              )}
            </div>
            <p className="dk-note">البرنامج بيدوّر لوحده كل ما يتفتح وكل 4 ساعات. التحديث بينزل في الخلفية، وقبل ما يتسطب بيتعمل نسخة احتياطية.</p>
          </div>
        </SectionCard>

        <SectionCard icon={<ShieldCheck />} color="green" title="النسخ الاحتياطي">
          <div className="dk-rows">
            <div className="dk-row"><span className="dk-row-l">آخر نسخة</span><span className="dk-row-v">{info?.lastBackup ? fmtTime(info.lastBackup.at) : 'لسه'}</span></div>
            <div className="dk-row"><span className="dk-row-l">الفولدر</span><bdi className="dk-row-v" style={{ fontSize: '0.8125rem' }}>{info?.backupDir ?? '…'}</bdi></div>
            <div className="dk-row">
              <span className="dk-row-l">نسخة تانية</span>
              {info?.backupCopyDir ? (
                <span className="dk-row-v" style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <bdi>{info.backupCopyDir}</bdi>
                  <button type="button" className="icon-btn" title="من غير نسخة تانية" aria-label="من غير نسخة تانية" onClick={clearCopy} disabled={busy === 'clear'}><X /></button>
                </span>
              ) : (
                <span className="dk-badge warn">مش متحددة</span>
              )}
            </div>
            <div className="dk-btns">
              <button type="button" className="dk-btn primary" onClick={backupNow} disabled={busy === 'backup'}>{busy === 'backup' ? <Loader2 className="spin" /> : <ShieldCheck />} نسخة احتياطية دلوقتي</button>
              <button type="button" className="dk-btn" onClick={() => void desk.openBackups()}><FolderOpen /> افتح فولدر النسخ</button>
              <button type="button" className="dk-btn" onClick={chooseCopy} disabled={busy === 'copy'}><HardDrive /> {info?.backupCopyDir ? 'غيّر فولدر النسخة التانية' : 'اختار فولدر نسخة تانية'}</button>
            </div>
            <p className="dk-note">كل ساعة بتتعمل نسخة لو فيه تغيير، ووقت قفل البرنامج. اختار فولدر تاني (فلاشة أو هارد خارجي أو Google Drive) علشان لو الجهاز حصله حاجة.</p>
          </div>
        </SectionCard>

        <SectionCard icon={<MonitorSmartphone />} color="purple" title="الأجهزة التانية">
          <div className="dk-rows">
            <p className="dk-note">افتح العنوان ده من أي جهاز أو موبايل على نفس الشبكة:</p>
            {info?.lan.length ? info.lan.map((a) => (
              <div key={a} className="dk-addr"><span>{a}</span><button type="button" onClick={() => copy(a)}>نسخ</button></div>
            )) : <p className="dk-note"><Wifi style={{ width: 14, height: 14, verticalAlign: 'middle' }} /> الجهاز مش متوصل بشبكة.</p>}
            <p className="dk-note">البرنامج لازم يفضل مفتوح على الجهاز ده علشان الأجهزة التانية تتصل. لو جهاز مش شايفه: لما ويندوز يسأل «Allow access» للبرنامج اختار السماح.</p>
            <div className="dk-btns">
              <button type="button" className="dk-btn" onClick={() => void desk.openData()}><FolderOpen /> فولدر البيانات والسجل</button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
