import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { HUBS } from '../components/nav';
import { usePerm } from '../lib/hooks';

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
  const groups = hub.groups.map((g) => ({ ...g, links: g.links.filter((l) => !l.perm || can(l.perm)) })).filter((g) => g.links.length);

  return (
    <div className="page">
      <div className="hub-head">
        <div className="hub-icon" style={{ background: hub.grad }}>{hub.icon}</div>
        <div>
          <h1 className="large-title" style={{ margin: 0 }}>{hub.label}</h1>
          <div className="page-sub" style={{ margin: 0 }}>{hub.sub}</div>
        </div>
      </div>
      {groups.map((g, gi) => {
        const heroes = gi === 0 ? g.links.filter((l) => l.hero) : [];
        const rest = g.links.filter((l) => !heroes.includes(l));
        return (
          <div key={g.title}>
            <div className="hub-group-title">{g.title}</div>
            {gi === 0 ? (
              <div className="tiles">
                {heroes.map((l) => (
                  <button key={l.to} className="tile hero" style={{ background: l.grad }} onClick={() => nav(l.to)}>
                    <span className="ti">{l.icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span className="tt">{l.label}</span>
                      {l.desc && <span className="td">{l.desc}</span>}
                    </span>
                  </button>
                ))}
                {rest.map((l) => (
                  <button key={l.to} className="tile" onClick={() => nav(l.to)}>
                    <span className="ti" style={{ background: l.grad }}>{l.icon}</span>
                    <span className="tt">{l.label}</span>
                    {l.desc && <span className="td">{l.desc}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="list">
                {rest.map((l) => (
                  <div key={l.to} className="list-row tappable with-icon" onClick={() => nav(l.to)}>
                    <span className="sb-icon" style={{ background: l.grad, color: '#fff' }}>{l.icon}</span>
                    <div className="title">{l.label}{l.desc && <div className="sub">{l.desc}</div>}</div>
                    <ChevronLeft style={{ width: 18, height: 18, color: 'var(--label-3)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
