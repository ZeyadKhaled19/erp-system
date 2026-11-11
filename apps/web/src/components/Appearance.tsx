import { useEffect, useState } from 'react';
import { ACCENTS, loadAppearance, saveAppearance, THEMES, type Appearance } from '../lib/theme';
import { Segmented, Sheet } from './ui';

export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [a, setA] = useState(loadAppearance);
  useEffect(() => {
    const h = (e: Event) => setA((e as CustomEvent).detail);
    window.addEventListener('erp:appearance', h);
    return () => window.removeEventListener('erp:appearance', h);
  }, []);
  return [a, saveAppearance];
}

/** لوحة اختيار المظهر: الثيم، اللون الأساسي، الكثافة — التغيير فوري */
export function AppearancePanel() {
  const [a, set] = useAppearance();
  return (
    <div className="stack">
      <div className="bold">الثيم</div>
      <div className="theme-cards">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${a.theme === t.id ? 'on' : ''}`} onClick={() => set({ ...a, theme: t.id })}>
            <div className="tc-prev" style={{ background: t.preview }}>
              <i style={{ top: 10, right: 10, width: 28, bottom: 10, background: t.bars[1] }} />
              <i style={{ top: 10, right: 46, left: 10, height: 22, background: t.bars[0] }} />
              <i style={{ top: 40, right: 46, left: 10, height: 26, background: t.bars[0] }} />
            </div>
            {t.label}
          </button>
        ))}
      </div>
      <div className="bold" style={{ marginTop: 8 }}>اللون الأساسي</div>
      <div className="accent-dots">
        {ACCENTS.map((c) => (
          <button key={c.id} title={c.label} aria-label={c.label} className={a.accent === c.id ? 'on' : ''} style={{ background: c.color }} onClick={() => set({ ...a, accent: c.id })} />
        ))}
      </div>
      <div className="bold" style={{ marginTop: 8 }}>كثافة العرض</div>
      <Segmented value={a.density} onChange={(v) => set({ ...a, density: v })} options={[{ value: 'comfortable', label: 'مريح' }, { value: 'compact', label: 'مضغوط (بيانات أكثر)' }]} />
      <div className="footnote">المظهر يُحفظ على هذا الجهاز فقط، ولكل مستخدم أن يختار ما يريحه.</div>
    </div>
  );
}

export function AppearanceSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="المظهر" onClose={onClose}>
      <AppearancePanel />
    </Sheet>
  );
}
