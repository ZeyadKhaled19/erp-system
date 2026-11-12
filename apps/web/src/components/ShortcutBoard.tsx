import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Eye, EyeOff, GripVertical, Plus, RotateCcw, Scaling, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from '../lib/hooks';
import { ShortcutCard, type ShortcutColor } from './ShortcutCard';
import { useUi } from './ui';

export interface BoardCard {
  label: string;
  to: string;
  icon: ReactNode;
  color: ShortcutColor;
  badge?: ReactNode;
  sub?: string;
  /** الحجم الافتراضي للمربع (المستخدم يغيّره) */
  size?: Size;
}
export interface BoardGroup {
  title: string;
  cards: BoardCard[];
}
export type Size = 's' | 'm' | 'l';
interface Layout {
  groups: { title: string; items: string[] }[];
  hidden: string[];
  size: Record<string, Size>;
}
const EMPTY: Layout = { groups: [], hidden: [], size: {} };
const SIZE_LABEL: Record<Size, string> = { s: 'عادي', m: 'عريض', l: 'عريض' };
// حجمان فقط (عادي/عريض) حتى تبقى الصفوف متراصة بلا فراغات؛ «كبير» القديم يُعامل كعريض
const NEXT_SIZE: Record<Size, Size> = { s: 'm', m: 's', l: 's' };

// v2: لوحة المربعات الجديدة (ترتيب وأحجام مختلفة عن البطاقات القديمة)
const keyFor = (uid: string) => `erp.shortcuts.v2.${uid}`;
function loadLayout(uid: string): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(uid)) ?? 'null');
    return v && Array.isArray(v.groups) ? { groups: v.groups, hidden: v.hidden ?? [], size: v.size ?? {} } : EMPTY;
  } catch {
    return EMPTY;
  }
}
function storeLayout(uid: string, l: Layout | null) {
  try {
    if (l) localStorage.setItem(keyFor(uid), JSON.stringify(l));
    else localStorage.removeItem(keyFor(uid));
  } catch {
    /* التخزين غير متاح: التخصيص للجلسة الحالية فقط */
  }
}

/** ترتيب البطاقات حسب تخصيص المستخدم؛ أي بطاقة جديدة أو غير مذكورة تُضاف لمجموعتها الافتراضية */
function arrange(defaults: BoardGroup[], layout: Layout): BoardGroup[] {
  const byId = new Map(defaults.flatMap((g) => g.cards.map((c) => [c.to, c] as const)));
  const used = new Set<string>();
  const order = [...layout.groups];
  for (const g of defaults) if (!order.some((o) => o.title === g.title)) order.push({ title: g.title, items: [] });
  const out: BoardGroup[] = order.map((o) => ({
    title: o.title,
    cards: o.items.filter((id) => byId.has(id) && !used.has(id) && (used.add(id), true)).map((id) => byId.get(id)!),
  }));
  for (const g of defaults) {
    const target = out.find((o) => o.title === g.title)!;
    for (const c of g.cards) if (!used.has(c.to)) (used.add(c.to), target.cards.push(c));
  }
  return out;
}
const toLayout = (groups: BoardGroup[], hidden: string[], size: Record<string, Size>): Layout => ({
  groups: groups.map((g) => ({ title: g.title, items: g.cards.map((c) => c.to) })),
  hidden,
  size,
});

/**
 * لوحة الاختصارات القابلة للتخصيص لكل مستخدم: الترتيب (سحب أو أسهم)، النقل بين المجموعات،
 * ترتيب المجموعات، الحجم (صغير/متوسط/كبير)، والإخفاء. يُحفظ محليًا باسم المستخدم.
 */
export function ShortcutBoard({ groups: defaults, onOpen }: { groups: BoardGroup[]; onOpen: (to: string) => void }) {
  const ui = useUi();
  const { session } = useSession();
  const uid = session.user.id;
  const [layout, setLayout] = useState<Layout>(() => loadLayout(uid));
  useEffect(() => setLayout(loadLayout(uid)), [uid]);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const arranged = useMemo(() => arrange(defaults, layout), [defaults, layout]);
  const hidden = new Set(layout.hidden);
  const defaultSize = useMemo(() => new Map(defaults.flatMap((g) => g.cards.map((c) => [c.to, c.size ?? 's'] as const))), [defaults]);
  const sizeOf = (id: string): Size => {
    const z = layout.size[id] ?? defaultSize.get(id) ?? 's';
    return z === 'l' ? 'm' : z;
  };

  const commit = (groups: BoardGroup[], h = layout.hidden, size = layout.size) => {
    const l = toLayout(groups, h, size);
    setLayout(l);
    storeLayout(uid, l);
  };
  const clone = () => arranged.map((g) => ({ ...g, cards: [...g.cards] }));
  const locate = (gs: BoardGroup[], id: string) => {
    for (let gi = 0; gi < gs.length; gi++) {
      const ci = gs[gi].cards.findIndex((c) => c.to === id);
      if (ci >= 0) return { gi, ci };
    }
    return null;
  };
  /** نقل بطاقة خطوة داخل مجموعتها (مع تخطي المخفي)، أو لمجموعة مجاورة عند الطرف */
  const step = (id: string, dir: -1 | 1) => {
    const gs = clone();
    const p = locate(gs, id);
    if (!p) return;
    const cards = gs[p.gi].cards;
    let j = p.ci + dir;
    while (j >= 0 && j < cards.length && hidden.has(cards[j].to)) j += dir;
    if (j >= 0 && j < cards.length) {
      [cards[p.ci], cards[j]] = [cards[j], cards[p.ci]];
    } else {
      // عند طرف المجموعة تنتقل البطاقة للمجموعة المجاورة
      const ng = p.gi + dir;
      if (ng < 0 || ng >= gs.length) return;
      const [card] = cards.splice(p.ci, 1);
      if (dir > 0) gs[ng].cards.unshift(card);
      else gs[ng].cards.push(card);
    }
    commit(gs);
  };
  const dropOn = (targetGroup: number, beforeId: string | null) => {
    if (!drag) return;
    const gs = clone();
    const p = locate(gs, drag);
    if (!p) return;
    const [card] = gs[p.gi].cards.splice(p.ci, 1);
    const list = gs[targetGroup].cards;
    const at = beforeId ? list.findIndex((c) => c.to === beforeId) : -1;
    list.splice(at < 0 ? list.length : at, 0, card);
    commit(gs);
    setDrag(null);
    setOver(null);
  };
  const moveGroup = (gi: number, dir: -1 | 1) => {
    const gs = clone();
    const j = gi + dir;
    if (j < 0 || j >= gs.length) return;
    [gs[gi], gs[j]] = [gs[j], gs[gi]];
    commit(gs);
  };
  const toggleHidden = (id: string) => commit(clone(), hidden.has(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id]);
  const cycleSize = (id: string) => commit(clone(), layout.hidden, { ...layout.size, [id]: NEXT_SIZE[sizeOf(id)] });
  const reset = async () => {
    const ok = await ui.confirm({ title: 'استرجاع الترتيب الافتراضي؟', message: 'سيرجع ترتيب المربعات وأحجامها كما كانت، وتظهر كل المربعات المخفية.', confirmLabel: 'استرجاع' });
    if (!ok) return;
    storeLayout(uid, null);
    setLayout(EMPTY);
  };

  const hiddenCards = arranged.flatMap((g) => g.cards).filter((c) => hidden.has(c.to));
  const visibleGroups = arranged
    .map((g, gi) => ({ ...g, gi, cards: g.cards.filter((c) => !hidden.has(c.to)) }))
    .filter((g) => editing || g.cards.length);

  return (
    <div className={`sb-board ${editing ? 'editing' : ''}`}>
      <div className="sb-board-bar">
        {editing ? (
          <>
            <span className="sb-board-hint">اسحب المربعات لترتيبها أو انقلها لمجموعة أخرى. اضغط على المربع لتغيير حجمه (عادي ↔ عريض)، و<EyeOff style={{ width: 14, height: 14, verticalAlign: -2 }} /> لإخفائه.</span>
            <button type="button" className="btn sm plain" onClick={() => void reset()}><RotateCcw /> الافتراضي</button>
            <button type="button" className="btn sm primary" onClick={() => setEditing(false)}><Check /> تم</button>
          </>
        ) : (
          <button type="button" className="btn sm plain sb-board-edit" onClick={() => setEditing(true)}><Settings2 /> تخصيص المربعات</button>
        )}
      </div>

      <div className="sc-board-flow">
      {visibleGroups.map((g, vi) => (
        <section key={g.title} className="sc-group">
          <div className="sc-title-row">
            <h2 className="sc-title">{g.title}</h2>
            {editing && (
              <span className="sc-group-tools">
                <button type="button" className="icon-btn" title="تحريك المجموعة لأعلى" aria-label={`تحريك ${g.title} لأعلى`} disabled={vi === 0} onClick={() => moveGroup(g.gi, -1)}><ArrowUp /></button>
                <button type="button" className="icon-btn" title="تحريك المجموعة لأسفل" aria-label={`تحريك ${g.title} لأسفل`} disabled={vi === visibleGroups.length - 1} onClick={() => moveGroup(g.gi, 1)}><ArrowDown /></button>
              </span>
            )}
          </div>
          <div
            className="sc-grid"
            onDragOver={(e) => editing && drag && e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); dropOn(g.gi, null); }}
          >
            {g.cards.map((c) => {
              const sz = sizeOf(c.to);
              return (
                <div
                  key={c.to}
                  className={`sc-wrap sz-${sz} ${drag === c.to ? 'dragging' : ''} ${over === c.to ? 'over' : ''}`}
                  draggable={editing}
                  onDragStart={(e) => { setDrag(c.to); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.to); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDragOver={(e) => { if (editing && drag && drag !== c.to) { e.preventDefault(); e.stopPropagation(); setOver(c.to); } }}
                  onDragLeave={() => setOver((o) => (o === c.to ? null : o))}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOn(g.gi, c.to); }}
                >
                  <ShortcutCard label={c.label} icon={c.icon} color={c.color} badge={editing ? undefined : c.badge} sub={sz === 'l' ? c.sub : undefined} onClick={() => (editing ? cycleSize(c.to) : onOpen(c.to))} />
                  {editing && (
                    <div className="sc-tools" onClick={(e) => e.stopPropagation()}>
                      <span className="sc-tool grip" title="اسحب للترتيب" aria-hidden="true"><GripVertical /></span>
                      <button type="button" className="sc-tool" title="قبل" aria-label={`نقل ${c.label} للأمام`} onClick={() => step(c.to, -1)}><ArrowRight /></button>
                      <button type="button" className="sc-tool" title="بعد" aria-label={`نقل ${c.label} للخلف`} onClick={() => step(c.to, 1)}><ArrowLeft /></button>
                      <button type="button" className="sc-tool size" title={`الحجم: ${SIZE_LABEL[sz]} — اضغط للتغيير`} aria-label={`حجم ${c.label}: ${SIZE_LABEL[sz]}`} onClick={() => cycleSize(c.to)}><Scaling /></button>
                      <button type="button" className="sc-tool" title="إخفاء" aria-label={`إخفاء ${c.label}`} onClick={() => toggleHidden(c.to)}><EyeOff /></button>
                    </div>
                  )}
                </div>
              );
            })}
            {editing && g.cards.length === 0 && <div className="sc-drop-empty">اسحب بطاقة هنا</div>}
          </div>
        </section>
      ))}
      </div>

      {editing && hiddenCards.length > 0 && (
        <div className="sc-hidden">
          <span className="sc-hidden-t"><Eye /> مربعات مخفية — اضغط لإظهارها</span>
          {hiddenCards.map((c) => (
            <button key={c.to} type="button" className="btn sm" onClick={() => toggleHidden(c.to)}><Plus /> {c.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
