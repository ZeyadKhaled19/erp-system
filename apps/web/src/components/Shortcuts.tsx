import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasPermission } from '@erp/shared';
import { Sheet } from './ui';
import { SECTIONS } from './nav';

type Row = { keys: string[][]; label: string };
type Group = { title: string; rows: Row[] };

// مفاتيح متاحة في أي شاشة
const GLOBAL: Group = {
  title: 'في أي شاشة',
  rows: [
    { keys: [['F1'], ['?']], label: 'قايمة الاختصارات دي' },
    { keys: [['Ctrl', 'K']], label: 'بحث عن صنف أو عميل أو فاتورة' },
    { keys: [['Alt', 'N']], label: 'فاتورة بيع جديدة' },
    { keys: [['Alt', '1…9']], label: 'تروح لقسم من الشريط اللي فوق (1 = الرئيسية، 2 = المبيعات…)' },
    { keys: [['Esc']], label: 'يقفل النافذة أو القائمة المفتوحة' },
  ],
};

const QUICK_SALE: Group = {
  title: 'فاتورة البيع / الشراء',
  rows: [
    { keys: [['F12'], ['Ctrl', 'Enter']], label: 'حفظ' },
    { keys: [['F4']], label: 'حفظ وطباعة' },
    { keys: [['F9']], label: 'حفظ وعرض' },
    { keys: [['F3'], ['F10']], label: 'فاتورة جديدة في تبويب جديد' },
    { keys: [['F2']], label: 'استعلام عن الصنف (رصيده وأسعاره)' },
    { keys: [['F5']], label: 'تعديل كمية السطر المختار' },
    { keys: [['F6']], label: 'تعديل سعر السطر المختار' },
    { keys: [['F7']], label: 'خصم على السطر المختار' },
    { keys: [['F8']], label: 'حذف السطر المختار' },
    { keys: [['F11']], label: 'خانة المبلغ المدفوع' },
    { keys: [['↑'], ['↓']], label: 'تتنقل بين سطور الفاتورة' },
    { keys: [['Enter']], label: 'في خانة البحث: يضيف الصنف' },
  ],
};

const POS: Group = {
  title: 'البيع السريع (الكاشير)',
  rows: [
    { keys: [['F2']], label: 'خانة البحث عن صنف' },
    { keys: [['↑'], ['↓'], ['Enter']], label: 'تختار من نتايج البحث وتضيف' },
    { keys: [['Esc']], label: 'تمسح البحث' },
    { keys: [['F9'], ['Ctrl', 'Enter']], label: 'الدفع' },
    { keys: [['F3']], label: 'عملية بيع جديدة جنب الحالية' },
    { keys: [['Ctrl', 'Tab']], label: 'تتنقل بين عمليات البيع المفتوحة' },
  ],
};

const EDITOR: Group = {
  title: 'شاشة المستند',
  rows: [
    { keys: [['Ctrl', 'Enter']], label: 'حفظ' },
    { keys: [['Ctrl', 'S']], label: 'حفظ كمسودة' },
    { keys: [['F2']], label: 'خانة الباركود' },
  ],
};

function screenGroup(pathname: string, search: string): Group | null {
  const sp = new URLSearchParams(search);
  if (pathname === '/pos') return POS;
  const m = pathname.match(/^\/docs\/new\/(\w+)/);
  if (m && ((m[1] === 'sale_invoice' && !sp.get('advanced') && !sp.get('quotation') && !sp.get('ref')) || (m[1] === 'purchase_invoice' && !sp.get('advanced') && !sp.get('ref')))) return QUICK_SALE;
  if (m || pathname.startsWith('/docs/edit/')) return EDITOR;
  return null;
}

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** مفاتيح عامة (F1، Alt+N، Alt+رقم) + نافذة الاختصارات */
export function useGlobalShortcuts(permissions: string[] | undefined) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    const can = (p: string) => hasPermission(permissions ?? [], p);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F1' || (e.key === '?' && !typingIn(e.target) && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('.overlay')) return;
      const k = e.code;
      if (k === 'KeyN' && can('sales.create')) {
        e.preventDefault();
        nav('/docs/new/sale_invoice');
        return;
      }
      const d = /^Digit([1-9])$/.exec(k) ?? /^Numpad([1-9])$/.exec(k);
      if (d) {
        const visible = SECTIONS.filter((s) => !s.perms.length || s.perms.some(can));
        const s = visible[Number(d[1]) - 1];
        if (s) {
          e.preventDefault();
          nav(s.to);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, permissions]);
  return { open, setOpen };
}

export function ShortcutsSheet({ onClose, permissions }: { onClose: () => void; permissions: string[] | undefined }) {
  const loc = useLocation();
  const screen = screenGroup(loc.pathname, loc.search);
  const can = (p: string) => hasPermission(permissions ?? [], p);
  const sections = SECTIONS.filter((s) => !s.perms.length || s.perms.some(can));
  const groups = [screen, GLOBAL].filter(Boolean) as Group[];
  return (
    <Sheet title="اختصارات الكيبورد" onClose={onClose}>
      <div className="kb-help">
        {groups.map((g) => (
          <section key={g.title} className="kb-group">
            <h4>{g.title}{g === screen && <span className="kb-here">الشاشة دي</span>}</h4>
            {g.rows.map((r) => (
              <div key={r.label} className="kb-row">
                <span className="kb-keys">
                  {r.keys.map((combo, i) => (
                    <span key={i} className="kb-combo">
                      {i > 0 && <span className="kb-or">أو</span>}
                      {combo.map((k, j) => (
                        <span key={j}>{j > 0 && '+'}<kbd>{k}</kbd></span>
                      ))}
                    </span>
                  ))}
                </span>
                <span className="kb-label">{r.label}</span>
              </div>
            ))}
          </section>
        ))}
        <section className="kb-group">
          <h4>أرقام الأقسام مع Alt</h4>
          <div className="kb-sections">
            {sections.slice(0, 9).map((s, i) => (
              <span key={s.key} className="kb-sec"><kbd>{i + 1}</kbd>{s.label}</span>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
