import { Check, Home, Palette, Monitor, Moon, Sun } from 'lucide-react';
import { useHome } from '../lib/home';
import { useEffect, useState, type ReactNode } from 'react';
import { ACCENTS, FONTS, isPaletteMode, loadAppearance, saveAppearance, THEMES, type Appearance, type ThemeMode } from '../lib/theme';
import { Segmented, Sheet } from './ui';

export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [a, setA] = useState(() => loadAppearance());
  useEffect(() => {
    const h = (e: Event) => setA((e as CustomEvent).detail);
    window.addEventListener('erp:appearance', h);
    return () => window.removeEventListener('erp:appearance', h);
  }, []);
  return [a, saveAppearance];
}

const MODE_ICON: Record<ThemeMode, ReactNode> = { light: <Sun />, navy: <Palette />, amber: <Palette />, teal: <Palette />, paprika: <Palette />, dark: <Moon />, system: <Monitor /> };

/** لوحة المظهر: الوضع، لون التمييز، الخط، الكثافة — التغيير فوري ويخص المستخدم الحالي فقط */
/** صفحة البداية الشخصية: من المساحات المسموحة فقط، و«حسب الدور» يتبع إعداد المدير */
export function StartPagePicker() {
  const { pref, setPref, available, roleDefault, home } = useHome();
  if (available.length < 2) return null;
  return (
    <section className="ap-sec">
      <div className="ap-h">صفحة البداية</div>
      <div className="ap-start" role="radiogroup" aria-label="صفحة البداية">
        <button role="radio" aria-checked={!pref || !available.some((w) => w.id === pref)} className={`ap-font ${!pref || !available.some((w) => w.id === pref) ? 'on' : ''}`} onClick={() => setPref(null)}>
          <span className="ap-font-s"><Home /> حسب الدور</span>
          <span className="ap-font-l">الآن: {roleDefault.label}</span>
        </button>
        {available.map((w) => (
          <button key={w.id} role="radio" aria-checked={pref === w.id} className={`ap-font ${pref === w.id ? 'on' : ''}`} onClick={() => setPref(w.id)}>
            <span className="ap-font-s">{w.label}</span>
            <span className="ap-font-l">{w.desc}</span>
          </button>
        ))}
      </div>
      <div className="footnote">تفتح عليها بعد تسجيل الدخول أو فتح البرنامج. صفحة البداية الحالية: {home.label}.</div>
    </section>
  );
}

export function AppearancePanel() {
  const [a, set] = useAppearance();
  return (
    <div className="ap">
      <StartPagePicker />
      <section className="ap-sec">
        <div className="ap-h">وضع الألوان</div>
        <div className="ap-modes" role="radiogroup" aria-label="وضع الألوان">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={a.theme === t.id} className={`ap-mode ${a.theme === t.id ? 'on' : ''}`} onClick={() => set({ ...a, theme: t.id })}>
              <span className={`ap-prev ${t.id}`}><i /><b /></span>
              <span className="ap-mode-t">{MODE_ICON[t.id]}{t.label}</span>
              <span className="ap-mode-d">{t.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ap-sec">
        <div className="ap-h">لون التمييز</div>
        {isPaletteMode(a.theme) && <div className="footnote">وضع «{THEMES.find((t) => t.id === a.theme)?.label}» له ألوانه الخاصة، ولون التمييز يتبع البالتة. اختيارك هنا يُطبق في الأوضاع العادية.</div>}
        <div className="ap-accents" role="radiogroup" aria-label="لون التمييز">
          {ACCENTS.map((c) => (
            <button key={c.id} role="radio" aria-checked={a.accent === c.id} className={`ap-acc ${a.accent === c.id ? 'on' : ''}`} onClick={() => set({ ...a, accent: c.id })}>
              <i style={{ background: c.color }}>{a.accent === c.id && <Check />}</i>
              {c.label}
            </button>
          ))}
        </div>
        <div className="ap-sample">
          <button className="btn primary sm" type="button">زر أساسي</button>
          <span className="badge blue">محدد</span>
          <a href="#" onClick={(e) => e.preventDefault()}>رابط</a>
          <span className="ap-focus">خانة نشطة</span>
        </div>
      </section>

      <section className="ap-sec">
        <div className="ap-h">الخط</div>
        <div className="ap-fonts">
          {FONTS.map((f) => (
            <button key={f.id} className={`ap-font ${a.font === f.id ? 'on' : ''}`} onClick={() => set({ ...a, font: f.id })} style={{ fontFamily: f.family }}>
              <span className="ap-font-s">فاتورة بيع ١٢٣ · 1,250.00</span>
              <span className="ap-font-l">{f.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ap-sec">
        <div className="ap-h">كثافة العرض</div>
        <Segmented value={a.density} onChange={(v) => set({ ...a, density: v })} options={[{ value: 'comfortable', label: 'مريح' }, { value: 'compact', label: 'مضغوط (صفوف أكثر)' }]} />
      </section>
      <div className="footnote">اختياراتك تُحفظ لحسابك على هذا الجهاز، ولا تغيّر شكل البرنامج عند باقي المستخدمين.</div>
    </div>
  );
}

export function AppearanceSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="تفضيلاتي" onClose={onClose}>
      <AppearancePanel />
    </Sheet>
  );
}
