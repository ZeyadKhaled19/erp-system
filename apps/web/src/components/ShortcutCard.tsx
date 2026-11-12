import type { ReactNode } from 'react';

export type ShortcutColor = 'blue' | 'purple' | 'teal' | 'orange' | 'red' | 'yellow' | 'pink' | 'indigo' | 'green' | 'slate';

/**
 * بطاقة اختصار كبيرة ملونة: أيقونة أعلى اليمين، عدّاد أعلى اليسار، الاسم أسفل اليمين،
 * ونسخة كبيرة باهتة من الأيقونة في الركن للزينة.
 */
export function ShortcutCard({ label, icon, color, badge, sub, onClick }: { label: string; icon: ReactNode; color: ShortcutColor; badge?: ReactNode; sub?: string; onClick: () => void }) {
  return (
    <button type="button" className={`sc sc-${color}`} onClick={onClick}>
      <span className="sc-icon" aria-hidden="true">{icon}</span>
      {badge !== undefined && badge !== null && <span className="sc-badge num">{badge}</span>}
      <span className="sc-mark" aria-hidden="true">{icon}</span>
      <span className="sc-text">
        <span className="sc-label">{label}</span>
        {sub && <span className="sc-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sc-group">
      <h2 className="sc-title">{title}</h2>
      <div className="sc-grid">{children}</div>
    </section>
  );
}
