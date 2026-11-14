import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';
import { HUB_WORKSPACE, WorkspaceSummary } from '../components/WorkspaceSummary';
import { ShortcutCard, type ShortcutColor } from '../components/ShortcutCard';

const SC_COLORS: ShortcutColor[] = ['blue', 'purple', 'teal', 'orange', 'yellow', 'red', 'indigo', 'pink', 'green', 'slate'];
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { HUBS } from '../components/nav';
import { usePerm } from '../lib/hooks';
import { InventorySection, PurchasesSection, TreasurySection } from './HubSections';
import { SalesSection } from './SalesSection';
import { SectionHeader } from '../components/Section';

/** صفحة قسم: الإجراءات الأهم كبطاقات كبيرة، ثم باقي الشاشات بشكل مرتب */
export function HubPage() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const can = usePerm();
  const hub = HUBS.find((h) => h.key === key);
  useEffect(() => {
    if (hub) document.title = `${hub.label} — الحسابات`;
    const slot = document.getElementById('nav-title-slot');
    if (slot && hub) slot.textContent = hub.label;
  }, [hub]);
  if (!hub) return <Navigate to="/" replace />;
  if (hub.to) return <Navigate to={hub.to} replace />;
  // الأقسام اللي اتنقلت للتصميم الموحد الجديد (صورة المبيعات المعتمدة)
  if (hub.key === 'sales') return <SalesSection />;
  if (hub.key === 'purchases') return <PurchasesSection />;
  if (hub.key === 'inventory') return <InventorySection />;
  if (hub.key === 'treasury') return <TreasurySection />;
  // صفحة التقارير تجمع كمان تقارير المخزون والخزينة، وكل التقارير تظهر ككروت
  const isReports = hub.key === 'reports';
  const extra = isReports
    ? [{
        title: 'تقارير المخزون والخزينة',
        links: [
          ...(HUBS.find((h) => h.key === 'inventory')?.groups.find((g) => g.title === 'تقارير المخزون')?.links ?? []),
          ...(HUBS.find((h) => h.key === 'treasury')?.groups.flatMap((g) => g.links).filter((l) => l.to.startsWith('/reports/')) ?? []),
        ],
      }]
    : [];
  const groups = [...hub.groups, ...extra].map((g) => ({ ...g, links: g.links.filter((l) => !l.perm || can(l.perm)) })).filter((g) => g.links.length);

  return (
    <div className="page">
      <div className="sx-top">
        <SectionHeader icon={hub.icon} color={isReports ? 'green' : 'slate'} title={hub.label} sub={hub.sub} />
      </div>
      {HUB_WORKSPACE[hub.key] && !isReports && <WorkspaceSummary ws={HUB_WORKSPACE[hub.key]} />}
      {groups.map((g, gi) => {
        const heroes = gi === 0 ? g.links.filter((l) => l.hero) : [];
        const rest = g.links.filter((l) => !heroes.includes(l));
        return (
          <div key={g.title}>
            <div className="hub-group-title">{g.title}</div>
            {gi === 0 || isReports ? (
              <div className="sc-grid">
                {[...heroes, ...rest].map((l, i) => (
                  <ShortcutCard key={l.to} label={l.label} icon={l.icon} color={SC_COLORS[i % SC_COLORS.length]} sub={l.desc} onClick={() => nav(l.to)} />
                ))}
              </div>
            ) : (
              <div className="list">
                {rest.map((l) => (
                  <div key={l.to} className="list-row tappable with-icon" onClick={() => nav(l.to)}>
                    <span className="sb-icon">{l.icon}</span>
                    <div className="title">{l.label}{l.desc && <div className="sub">{l.desc}</div>}</div>
                    <ChevronLeft style={{ width: 18, height: 18, color: 'var(--label-3)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {isReports && HUB_WORKSPACE[hub.key] && (
        <>
          <div className="hub-group-title">ملخص الحسابات</div>
          <WorkspaceSummary ws={HUB_WORKSPACE[hub.key]} />
        </>
      )}
    </div>
  );
}
