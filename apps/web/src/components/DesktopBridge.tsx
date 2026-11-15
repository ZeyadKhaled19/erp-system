import { AlertTriangle, CheckCircle2, Download, Power, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getDesktop, type DesktopEvent, type UpdateState } from '../lib/desktop';
import { EcoLogo, EcoMark } from './EcoLogo';
import '../desktop.css';

/**
 * رسايل برنامج الويندوز جوه السيستم نفسه (بدل رسايل ويندوز):
 * «نسخة جديدة جاهزة»، «قفل البرنامج؟»، شاشة النسخة الاحتياطية وقت القفل ونتيجتها.
 * بيشتغل بس جوه برنامج الويندوز؛ في المتصفح ما بيعملش حاجة.
 */

// حالة التحديث متاحة لأي صفحة (مثلًا صفحة «برنامج الويندوز»)
type UpdateInfo = { state: UpdateState; version: string | null; percent: number };
let updateInfo: UpdateInfo = { state: 'idle', version: null, percent: 0 };
const listeners = new Set<() => void>();
const setUpdateInfo = (u: UpdateInfo) => {
  updateInfo = u;
  listeners.forEach((l) => l());
};
export const useDesktopUpdate = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => updateInfo,
  );

type Closing =
  | { stage: 'backup'; updateVersion: string | null }
  | { stage: 'done'; id: number; file: string | null; skipped: boolean; error: string | null; backupDir: string; copyDir: string; updateVersion: string | null };

const SEEN_KEY = 'eco.update.prompted';

export function DesktopBridge() {
  const desk = getDesktop();
  const [confirm, setConfirm] = useState<{ id: number; updateVersion: string | null } | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [updatePrompt, setUpdatePrompt] = useState<string | null>(null);
  const autoAck = useRef<number | null>(null);

  useEffect(() => {
    if (!desk) return;
    const off = desk.on((e: DesktopEvent) => {
      if (e.type === 'update') {
        setUpdateInfo({ state: e.state, version: e.version, percent: e.percent });
        // «نسخة جديدة جاهزة» مرة واحدة لكل نسخة (في الجلسة دي)
        if (e.state === 'ready' && e.version) {
          let seen = '';
          try { seen = sessionStorage.getItem(SEEN_KEY) ?? ''; } catch { /* مش مهم */ }
          if (seen !== e.version) setUpdatePrompt(e.version);
        }
      } else if (e.type === 'confirm-close') {
        setUpdatePrompt(null);
        setConfirm({ id: e.id, updateVersion: e.updateVersion });
        desk.ack(e.id);
      } else if (e.type === 'closing') {
        setConfirm(null);
        setClosing({ stage: 'backup', updateVersion: e.updateVersion });
      } else if (e.type === 'closing-done') {
        setClosing({ stage: 'done', id: e.id, ...e.result, backupDir: e.backupDir, copyDir: e.copyDir, updateVersion: e.updateVersion });
        desk.ack(e.id);
        // النتيجة بتفضل ظاهرة شوية، وبعدين البرنامج يقفل لوحده
        if (autoAck.current) window.clearTimeout(autoAck.current);
        autoAck.current = window.setTimeout(() => desk.reply(e.id, true), e.result.error ? 6000 : 2600);
      }
    });
    desk.ready();
    return () => {
      off();
      if (autoAck.current) window.clearTimeout(autoAck.current);
    };
  }, [desk]);

  if (!desk) return null;

  const answerClose = (ok: boolean) => {
    if (!confirm) return;
    desk.reply(confirm.id, ok);
    setConfirm(null);
  };
  const dismissUpdate = () => {
    try { if (updatePrompt) sessionStorage.setItem(SEEN_KEY, updatePrompt); } catch { /* مش مهم */ }
    setUpdatePrompt(null);
  };

  return createPortal(
    <>
      {updatePrompt && !confirm && !closing && (
        <div className="dk-overlay" role="dialog" aria-modal="true" aria-labelledby="dk-up-t">
          <div className="dk-modal">
            <span className="dk-ic up"><Download /></span>
            <h3 id="dk-up-t">نسخة جديدة جاهزة <bdi className="dk-ver">{updatePrompt}</bdi></h3>
            <p>تحب تحدّث دلوقتي؟ هيتعمل نسخة احتياطية الأول، وبعدين البرنامج يقفل ويفتح تاني بالنسخة الجديدة (حوالي دقيقة).</p>
            <p className="dk-muted">أو كمّل شغلك، والتحديث هيتسطب لوحده لما تقفل البرنامج.</p>
            <div className="dk-actions">
              <button type="button" className="dk-btn primary" autoFocus onClick={() => { dismissUpdate(); void desk.installUpdate(); }}>
                <RefreshCw /> حدّث دلوقتي
              </button>
              <button type="button" className="dk-btn" onClick={dismissUpdate}>لما أقفل البرنامج</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="dk-overlay" role="alertdialog" aria-modal="true" aria-labelledby="dk-close-t">
          <div className="dk-modal">
            <span className="dk-ic"><Power /></span>
            <h3 id="dk-close-t">قفل البرنامج؟</h3>
            <ul className="dk-list">
              <li><CheckCircle2 /> هيتعمل نسخة احتياطية بآخر البيانات قبل القفل.</li>
              {confirm.updateVersion && <li><Download /> وهيتسطب التحديث الجديد (نسخة <bdi>{confirm.updateVersion}</bdi>) — البيانات مش هتتلمس.</li>}
              <li><AlertTriangle /> الأجهزة التانية على الشبكة مش هتقدر تتصل لحد ما تفتح البرنامج تاني (وشغلها بيتحفظ عندها لحد ما ترجع).</li>
            </ul>
            <div className="dk-actions">
              <button type="button" className="dk-btn primary" autoFocus onClick={() => answerClose(true)}>
                {confirm.updateVersion ? 'نسخ احتياطي وتحديث وقفل' : 'نسخ احتياطي وقفل'}
              </button>
              <button type="button" className="dk-btn" onClick={() => answerClose(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {closing && (
        <div className="dk-closing" role="status" aria-live="polite">
          <div className="dk-closing-in">
            <EcoLogo size={46} light className="dk-closing-logo" />
            {closing.stage === 'backup' ? (
              <>
                <div className="dk-spin" aria-hidden="true" />
                <div className="dk-closing-t">جاري عمل نسخة احتياطية بآخر البيانات…</div>
                <div className="dk-closing-s">ما تقفلش الجهاز</div>
              </>
            ) : closing.error ? (
              <>
                <span className="dk-done warn"><AlertTriangle /></span>
                <div className="dk-closing-t">ما قدرتش أعمل نسخة احتياطية</div>
                <div className="dk-closing-s">{closing.error}</div>
                <div className="dk-path">آخر نسخة تلقائية موجودة في: <bdi>{closing.backupDir}</bdi></div>
              </>
            ) : (
              <>
                <span className="dk-done"><CheckCircle2 /></span>
                <div className="dk-closing-t">{closing.file ? 'تم عمل نسخة احتياطية بآخر البيانات' : 'البيانات محفوظة'}</div>
                <div className="dk-closing-s">{closing.file ? <bdi>{closing.file}</bdi> : 'مفيش أي تغيير من آخر نسخة احتياطية'}</div>
                <div className="dk-path">في: <bdi>{closing.backupDir}</bdi>{closing.copyDir && <><br />واتنسخت كمان في: <bdi>{closing.copyDir}</bdi></>}</div>
              </>
            )}
            {closing.stage === 'done' && closing.updateVersion && !closing.error && <div className="dk-closing-s">بيسطّب التحديث <bdi>{closing.updateVersion}</bdi> ويفتح البرنامج تاني…</div>}
            {closing.stage === 'done' && (
              <button type="button" className="dk-btn primary dk-ok" onClick={() => desk.reply(closing.id, true)}>تمام</button>
            )}
          </div>
          <div className="dk-closing-foot"><EcoMark size={14} /> <bdi>Eco System</bdi></div>
        </div>
      )}
    </>,
    document.body,
  );
}
