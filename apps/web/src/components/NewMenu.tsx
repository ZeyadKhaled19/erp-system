import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuickActions, type QuickAction } from '../lib/quickActions';
import { FloatingPop } from './ui';

/** قائمة «جديد» في الشريط العلوي: كل ما يملك المستخدم صلاحية إنشائه، والأكثر استخدامًا أولًا */
export function NewMenu() {
  const nav = useNavigate();
  const { actions, usage, use } = useQuickActions();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const creates = actions.filter((a) => a.creates);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  if (!creates.length) return null;

  const frequent = creates.filter((a) => (usage[a.key] ?? 0) > 0).slice(0, 3);
  const groups = [...new Set(creates.map((a) => a.group))];
  const go = (a: QuickAction) => {
    use(a);
    setOpen(false);
    nav(a.to);
  };
  const Item = ({ a }: { a: QuickAction }) => (
    <button type="button" role="menuitem" className="nm-item" onClick={() => go(a)}>
      <span className="nm-ic">{a.icon}</span>
      {a.label}
    </button>
  );
  return (
    <>
      <button ref={btn} type="button" className="btn primary sm nm-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus /> <span className="hide-mobile">جديد</span>
      </button>
      {open && (
        <FloatingPop anchor={btn} popRef={pop} className="picker-pop nm-pop" maxHeight={480}>
          <div role="menu" aria-label="إنشاء جديد">
            {frequent.length > 0 && (
              <div className="nm-group">
                <div className="nm-title">الأكثر استخدامًا</div>
                {frequent.map((a) => <Item key={'f' + a.key} a={a} />)}
              </div>
            )}
            {groups.map((g) => (
              <div key={g} className="nm-group">
                <div className="nm-title">{g}</div>
                {creates.filter((a) => a.group === g).map((a) => <Item key={a.key} a={a} />)}
              </div>
            ))}
          </div>
        </FloatingPop>
      )}
    </>
  );
}
