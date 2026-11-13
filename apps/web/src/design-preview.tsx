import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import './design-preview.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { computeDocument } from '@erp/shared';
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, Boxes, BriefcaseBusiness, CalendarDays, Check,
  ChevronLeft, ClipboardCheck, Clock3, Coins, FileBarChart, Fingerprint, House,
  IdCard, Moon, PackagePlus, Palette, Plus, Printer, Receipt, RefreshCw, Save, Search,
  Settings, ShoppingBasket, ShoppingCart, SlidersHorizontal, Sun, Trash2, Truck,
  UserPlus, UsersRound, Wallet, Wifi, WifiOff, X, type LucideIcon,
} from 'lucide-react';

type Accent = 'blue' | 'violet' | 'teal' | 'orange';
type Mode = 'light' | 'dark' | 'system';
type Section = { id: string; label: string; icon: LucideIcon; color: string; path: string };
type Action = { id: string; label: string; icon: LucideIcon; color: string; section: string; permission: string };
type PreviewPreferences = { mode: Mode; accent: Accent };
type HomeConfig = { navOrder: string[]; homeOrder: string[]; favoriteOrder: string[]; allowed: string[]; actionIcons: Record<string, number> };

type SaleLine = { id: string; itemId: string; name: string; code: string; qty: number; price: number; stock: number; service?: boolean; discount: number; taxRateBp: number };
type SaleDraft = { customer: string; warehouse: string; lines: SaleLine[]; discountMode: 'amount' | 'percent'; discountValue: number; payment: 'cash' | 'credit' | 'split'; cashAmount: number; bankAmount: number; cashbox: string; bankAccount: string; serviceName: string; servicePrice: number };
type PreviewRole = 'manager' | 'cashier' | 'viewer';

const saleItems = [
  { id: 'oil-filter', name: 'فلتر زيت موتور', code: 'ITM-1042', barcode: '6221042001042', price: 385, stock: 14, taxRateBp: 1400 },
  { id: 'engine-oil', name: 'زيت محرك 5W-30', code: 'ITM-2087', barcode: '6222087002087', price: 740, stock: 8, taxRateBp: 1400 },
  { id: 'air-filter', name: 'فلتر هواء', code: 'ITM-1033', barcode: '6221033001033', price: 520, stock: 2, taxRateBp: 1400 },
  { id: 'spark-plug', name: 'شمعة إشعال', code: 'ITM-0510', barcode: '6220510000510', price: 165, stock: 26, taxRateBp: 1400 },
];
const defaultSaleDraft: SaleDraft = { customer: 'عميل نقدي', warehouse: 'المخزن الرئيسي', lines: [], discountMode: 'amount', discountValue: 0, payment: 'cash', cashAmount: 0, bankAmount: 0, cashbox: 'خزنة الفرع الرئيسي', bankAccount: 'حساب البنك الأهلي', serviceName: 'مصنعية تغيير زيت', servicePrice: 180 };
const saleDraftKey = 'motorco.sales.preview.draft.v1';
const rolePermissions: Record<PreviewRole, { label: string; price: boolean; discount: boolean; create: boolean; post: boolean; print: boolean }> = {
  manager: { label: 'مدير تجريبي', price: true, discount: true, create: true, post: true, print: true },
  cashier: { label: 'كاشير تجريبي', price: false, discount: false, create: true, post: true, print: true },
  viewer: { label: 'مستخدم للعرض', price: false, discount: false, create: false, post: false, print: false },
};

function readSaleDraft(): SaleDraft {
  try { return { ...defaultSaleDraft, ...JSON.parse(localStorage.getItem(saleDraftKey) || 'null') }; }
  catch { return defaultSaleDraft; }
}

const PREVIEW_USER = 'ziad-khaled';
const sections: Section[] = [
  { id: 'home', label: 'الرئيسية', icon: House, color: 'blue', path: '/' },
  { id: 'sales', label: 'المبيعات', icon: ShoppingCart, color: 'green', path: '/sales' },
  { id: 'purchases', label: 'المشتريات', icon: ShoppingBasket, color: 'violet', path: '/purchases' },
  { id: 'inventory', label: 'المخزون', icon: Boxes, color: 'orange', path: '/inventory' },
  { id: 'parties', label: 'العملاء والموردين', icon: UsersRound, color: 'teal', path: '/parties' },
  { id: 'employees', label: 'الموظفين', icon: IdCard, color: 'blue', path: '/employees' },
  { id: 'partners', label: 'الشركاء ورأس المال', icon: Coins, color: 'violet', path: '/partners' },
];
const actions: Action[] = [
  { id: 'sale-invoice', label: 'فاتورة بيع جديدة', icon: ShoppingCart, color: 'green', section: 'sales', permission: 'sales' },
  { id: 'purchase-invoice', label: 'فاتورة شراء جديدة', icon: ShoppingBasket, color: 'violet', section: 'purchases', permission: 'purchases' },
  { id: 'new-item', label: 'إضافة صنف', icon: PackagePlus, color: 'blue', section: 'inventory', permission: 'inventory' },
  { id: 'new-customer', label: 'إضافة عميل', icon: UserPlus, color: 'teal', section: 'parties', permission: 'parties' },
  { id: 'stock-count', label: 'جرد مخزون', icon: ClipboardCheck, color: 'orange', section: 'inventory', permission: 'inventory' },
  { id: 'collect-payment', label: 'تحصيل من عميل', icon: Banknote, color: 'green', section: 'parties', permission: 'parties' },
  { id: 'expense', label: 'تسجيل مصروف', icon: Receipt, color: 'violet', section: 'partners', permission: 'partners' },
  { id: 'sales-report', label: 'تقارير المبيعات', icon: FileBarChart, color: 'blue', section: 'sales', permission: 'reports' },
];
const favoriteActions: Action[] = [
  { id: 'cashbox', label: 'فتح الخزينة', icon: Wallet, color: 'blue', section: 'partners', permission: 'partners' },
  { id: 'customer-statement', label: 'كشف حساب عميل', icon: UsersRound, color: 'teal', section: 'parties', permission: 'parties' },
  { id: 'item-search', label: 'بحث عن صنف', icon: Boxes, color: 'orange', section: 'inventory', permission: 'inventory' },
  { id: 'attendance', label: 'حضور وانصراف', icon: Fingerprint, color: 'green', section: 'employees', permission: 'employees' },
];
const iconChoices: LucideIcon[] = [ShoppingCart, ShoppingBasket, PackagePlus, UserPlus, ClipboardCheck, Banknote, Receipt, FileBarChart, Boxes, UsersRound, Wallet];
const defaultHomeConfig: HomeConfig = {
  navOrder: sections.map((item) => item.id),
  homeOrder: actions.slice(0, 7).map((item) => item.id),
  favoriteOrder: favoriteActions.slice(0, 3).map((item) => item.id),
  allowed: sections.map((item) => item.id).concat('reports'),
  actionIcons: {},
};
const defaultPrefs: PreviewPreferences = { mode: 'light', accent: 'blue' };
const prefsKey = `motorco.ui-preview.${PREVIEW_USER}.preferences.v2`;
const configKey = `motorco.ui-preview.${PREVIEW_USER}.home-config.v2`;

function loadPrefs(): PreviewPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(prefsKey) || 'null') as Partial<PreviewPreferences> | null;
    return {
      mode: value?.mode && ['light', 'dark', 'system'].includes(value.mode) ? value.mode : defaultPrefs.mode,
      accent: value?.accent && ['blue', 'violet', 'teal', 'orange'].includes(value.accent) ? value.accent : defaultPrefs.accent,
    };
  } catch { return defaultPrefs; }
}
function loadConfig(): HomeConfig {
  try {
    const value = JSON.parse(localStorage.getItem(configKey) || 'null') as Partial<HomeConfig> | null;
    if (!value) return defaultHomeConfig;
    const validOrder = (ids: unknown, available: Action[] | Section[], fallback: string[]) => {
      const valid = new Set(available.map((item) => item.id));
      return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && valid.has(id)))].concat(fallback.filter((id) => !ids.includes(id))) : fallback;
    };
    return {
      navOrder: validOrder(value.navOrder, sections, defaultHomeConfig.navOrder),
      homeOrder: validOrder(value.homeOrder, actions, defaultHomeConfig.homeOrder),
      favoriteOrder: validOrder(value.favoriteOrder, favoriteActions, defaultHomeConfig.favoriteOrder),
      allowed: Array.isArray(value.allowed) ? value.allowed.filter((id): id is string => typeof id === 'string' && defaultHomeConfig.allowed.includes(id)) : defaultHomeConfig.allowed,
      actionIcons: value.actionIcons && typeof value.actionIcons === 'object' ? value.actionIcons : {},
    };
  } catch { return defaultHomeConfig; }
}

function SaleInvoicePreview({ active }: { active: boolean }) {
  const [draft, setDraft] = useState<SaleDraft>(readSaleDraft);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<PreviewRole>('manager');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [modal, setModal] = useState<'negative' | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const [pendingPrint, setPendingPrint] = useState(false);
  const permission = rolePermissions[role];
  const products = draft.lines.filter((line) => !line.service);
  const services = draft.lines.filter((line) => line.service);
  const merchandiseGross = products.reduce((sum, line) => sum + line.qty * line.price, 0);
  const serviceGross = services.reduce((sum, line) => sum + line.qty * line.price, 0);
  const lineDiscount = products.reduce((sum, line) => sum + Math.min(line.discount, line.qty * line.price), 0);
  const baseAfterLineDiscount = Math.max(0, merchandiseGross - lineDiscount);
  const documentDiscount = permission.discount
    ? Math.min(baseAfterLineDiscount, draft.discountMode === 'percent' ? Math.round(baseAfterLineDiscount * Math.max(0, Math.min(100, draft.discountValue))) / 100 : Math.max(0, draft.discountValue))
    : 0;
  const productCalc = computeDocument(products.map((line) => ({ qty: line.qty * 1000, price: line.price * 100, discount: Math.min(line.discount, line.qty * line.price) * 100, tax_rate_bp: line.taxRateBp })), documentDiscount * 100);
  const serviceCalc = computeDocument(services.map((line) => ({ qty: line.qty * 1000, price: line.price * 100, discount: 0, tax_rate_bp: line.taxRateBp })), 0);
  const taxTotal = (productCalc.tax + serviceCalc.tax) / 100;
  const total = Math.max(0, (productCalc.total + serviceCalc.total) / 100);
  const lineTotal = (line: SaleLine) => {
    const index = draft.lines.filter((entry) => Boolean(entry.service) === Boolean(line.service)).findIndex((entry) => entry.id === line.id);
    return ((line.service ? serviceCalc : productCalc).lines[index]?.total ?? 0) / 100;
  };
  const paid = draft.payment === 'cash' ? total : draft.payment === 'credit' ? 0 : Math.min(total, Math.max(0, draft.cashAmount) + Math.max(0, draft.bankAmount));
  const due = total - paid;
  const shortage = products.filter((line) => line.qty > line.stock);
  const matches = query.trim() ? saleItems.filter((item) => [item.name, item.code, item.barcode].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))) : [];

  useEffect(() => {
    try { localStorage.setItem(saleDraftKey, JSON.stringify(draft)); } catch { /* تظل المسودة في الذاكرة حتى نهاية الجلسة */ }
  }, [draft]);
  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler); window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); };
  }, []);

  const patchDraft = (patch: Partial<SaleDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const addProduct = (item: typeof saleItems[number]) => {
    setDraft((current) => {
      const existing = current.lines.find((line) => line.itemId === item.id);
      if (existing) return { ...current, lines: current.lines.map((line) => line.id === existing.id ? { ...line, qty: line.qty + 1 } : line) };
      return { ...current, lines: [...current.lines, { id: crypto.randomUUID(), itemId: item.id, name: item.name, code: item.code, qty: 1, price: item.price, stock: item.stock, discount: 0, taxRateBp: item.taxRateBp }] };
    });
    setQuery(''); setMessage(`${item.name} أُضيف إلى الفاتورة`);
  };
  const updateLine = (id: string, patch: Partial<SaleLine>) => setDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line) }));
  const addService = () => {
    const name = draft.serviceName.trim() || 'مصنعية / خدمة';
    setDraft((current) => ({ ...current, lines: [...current.lines, { id: crypto.randomUUID(), itemId: 'service', name, code: 'خدمة', qty: 1, price: Math.max(0, current.servicePrice), stock: 0, service: true, discount: 0, taxRateBp: 1400 }] }));
    setMessage('أُضيف بند خدمة تجريبي؛ لا يخصم من المخزون ولا يقبل خصمًا');
  };
  const savePreview = (printAfter = false) => {
    setPendingPrint(printAfter);
    if (printAfter && !permission.print) return setMessage('هذا الدور لا يملك صلاحية طباعة الفواتير');
    if (!permission.create || !permission.post) return setMessage('هذا الدور لا يملك صلاحية إنشاء الفاتورة وترحيلها');
    if (!draft.lines.length) return setMessage('أضف صنفًا أو بند خدمة أولًا');
    if (due > 0 && draft.customer === 'عميل نقدي') return setMessage('اختر عميلًا قبل تسجيل أي مبلغ آجل');
    if (shortage.length) return setModal('negative');
    setMessage(online ? (printAfter ? 'تم حفظ فاتورة المعاينة وتجهيز الطباعة (محاكاة فقط)' : 'تم حفظ فاتورة المعاينة وترحيلها (محاكاة فقط)') : (printAfter ? 'حُفظت محليًا برقم مؤقت LOCAL-00017؛ الطباعة جاهزة والمزامنة تنتظر الاتصال' : 'حُفظت محليًا برقم مؤقت LOCAL-00017، وستظهر للمزامنة عند عودة الاتصال'));
  };
  const confirmSave = () => {
    setModal(null);
    setMessage(online ? (pendingPrint ? 'تم تأكيد البيع بالسالب وتجهيز الطباعة في المحاكاة فقط' : 'تم تأكيد البيع بالسالب في محاكاة الشاشة فقط') : (pendingPrint ? 'تأكد البيع بالسالب محليًا برقم مؤقت LOCAL-00017؛ الطباعة جاهزة والمزامنة تنتظر الاتصال' : 'حُفظت محليًا برقم مؤقت LOCAL-00017 بانتظار المزامنة'));
  };
  const createNew = () => {
    if (draft.lines.length) { setModal('new'); return; }
    resetDraft();
  };
  const resetDraft = () => { setDraft({ ...defaultSaleDraft, lines: [] }); setQuery(''); setMessage('فاتورة جديدة جاهزة'); setModal(null); };

  return <section className={`sale-preview ${active ? '' : 'sale-preview-hidden'}`} aria-label="معاينة فاتورة البيع" aria-hidden={!active}>
    <div className="sale-heading"><div><div className="sale-kicker">المبيعات <ChevronLeft /> فاتورة جديدة</div><h1>فاتورة بيع</h1><p>معاينة تفاعلية · بيانات تجريبية · لا تحفظ فاتورة فعلية</p></div><div className="sale-heading-actions"><button className={`sale-connection ${online ? 'is-online' : 'is-offline'}`} onClick={() => setOnline((value) => !value)} title="اضغط لمحاكاة حالة الاتصال">{online ? <Wifi /> : <WifiOff />}{online ? 'متصل' : 'أوفلاين'}<span>{online ? 'مزامنة جاهزة' : 'مسودة محلية · LOCAL-00017'}</span></button><label className="sale-role">صلاحيات المعاينة<select value={role} onChange={(e) => { setRole(e.target.value as PreviewRole); setMessage('تغيّر دور المعاينة؛ الأزرار والحقول تتبع صلاحيات الدور'); }}><option value="manager">مدير تجريبي</option><option value="cashier">كاشير تجريبي</option><option value="viewer">عرض فقط</option></select></label></div></div>

    <div className="sale-meta-card"><div><span className="sale-label">رقم الفاتورة</span><strong className="sale-number">{online ? 'يصدر عند الحفظ' : 'LOCAL-00017'}</strong><small>{online ? 'مسودة غير محفوظة' : 'رقم مؤقت · ينتظر المزامنة'}</small></div><label><span className="sale-label">التاريخ</span><input type="date" value="2026-11-13" readOnly /></label><label><span className="sale-label">العميل</span><select value={draft.customer} onChange={(e) => patchDraft({ customer: e.target.value })}><option>عميل نقدي</option><option>مركز النور لصيانة السيارات</option><option>شركة الطريق السريع</option><option>أحمد محمد</option></select></label><label><span className="sale-label">المخزن</span><select value={draft.warehouse} onChange={(e) => patchDraft({ warehouse: e.target.value })}><option>المخزن الرئيسي</option><option>فرع مدينة نصر</option></select></label></div>

    <div className="sale-layout"><div className="sale-workspace">
      <div className="sale-search-card"><div className="sale-section-title"><div><span className="sale-step">١</span><div><h2>أضف الأصناف</h2><p>ابحث بالاسم أو الكود أو امسح الباركود</p></div></div><span className="sale-stock-hint">المتوفر ظاهر بجانب كل صنف</span></div><div className="sale-search"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) addProduct(matches[0]); }} placeholder="مثال: فلتر زيت أو 6221042001042" aria-label="بحث عن صنف بالاسم أو الباركود" />{query && <button onClick={() => setQuery('')} aria-label="مسح البحث"><X /></button>}</div>{matches.length > 0 && <div className="sale-results">{matches.map((item) => <button key={item.id} onClick={() => addProduct(item)}><span className="sale-result-icon"><PackagePlus /></span><span className="sale-result-name"><strong>{item.name}</strong><small>{item.code} · {item.barcode}</small></span><span className="sale-result-stock">متاح {item.stock}</span><b>{item.price.toLocaleString('ar-EG')} ج.م</b><Plus /></button>)}</div>}
        <div className="sale-shortcuts"><button className="sale-service-button" onClick={addService}><Plus /> إضافة مصنعية / خدمة</button><span>بند الخدمة لا يخصم مخزونًا ولا يقبل خصمًا</span></div></div>

      <div className="sale-lines-card"><div className="sale-section-title"><div><span className="sale-step">٢</span><div><h2>بنود الفاتورة <small>{draft.lines.length}</small></h2><p>عدّل الكمية والسعر حسب صلاحية المستخدم</p></div></div><button className="sale-clear" onClick={() => setDraft((current) => ({ ...current, lines: [] }))} disabled={!draft.lines.length}><Trash2 /> مسح البنود</button></div><div className="sale-table-wrap"><table className="sale-table"><thead><tr><th>الصنف</th><th>المخزون</th><th>الكمية</th><th>السعر</th><th>خصم السطر</th><th>الإجمالي</th><th></th></tr></thead><tbody>{draft.lines.length ? draft.lines.map((line) => <tr key={line.id} className={line.service ? 'service-row' : ''}><td><strong>{line.name}</strong><small>{line.service ? 'مصنعية / خدمة · بلا حركة مخزون' : line.code}</small></td><td>{line.service ? <span className="sale-service-tag">خدمة</span> : <span className={line.qty > line.stock ? 'stock-low' : ''}>{line.stock} قطعة</span>}</td><td><input type="number" min="1" step="1" value={line.qty} onChange={(e) => updateLine(line.id, { qty: Math.max(1, Number(e.target.value) || 1) })} aria-label={`كمية ${line.name}`} /></td><td><input type="number" min="0" step="1" value={line.price} disabled={!permission.price || line.service} onChange={(e) => updateLine(line.id, { price: Math.max(0, Number(e.target.value) || 0) })} aria-label={`سعر ${line.name}`} /><small>{!permission.price && !line.service ? 'السعر حسب القائمة' : 'ج.م'}</small></td><td>{line.service ? <span className="sale-no-discount">غير متاح</span> : <input type="number" min="0" max={line.qty * line.price} value={permission.discount ? line.discount : 0} disabled={!permission.discount} onChange={(e) => updateLine(line.id, { discount: Math.max(0, Math.min(line.qty * line.price, Number(e.target.value) || 0)) })} aria-label={`خصم ${line.name}`} />}</td><td className="sale-line-total">{lineTotal(line).toLocaleString('ar-EG')} ج.م</td><td><button className="sale-remove" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((entry) => entry.id !== line.id) }))} aria-label={`حذف ${line.name}`}><X /></button></td></tr>) : <tr><td colSpan={7} className="sale-empty">ابحث عن صنف وأضفه، أو أضف بند مصنعية / خدمة.</td></tr>}</tbody></table></div></div>

      <div className="sale-service-card"><div className="sale-section-title"><div><span className="sale-step soft-step">٣</span><div><h2>بند مصنعية / خدمة حر</h2><p>يُضاف للفاتورة دون التأثير على المخزون أو قبول خصم</p></div></div><span className="sale-service-tag">لا حركة مخزون</span></div><div className="sale-service-fields"><label>وصف الخدمة<input value={draft.serviceName} onChange={(e) => patchDraft({ serviceName: e.target.value })} placeholder="مثال: مصنعية تغيير زيت" /></label><label>القيمة (ج.م)<input type="number" min="0" value={draft.servicePrice} disabled={!permission.price} onChange={(e) => patchDraft({ servicePrice: Math.max(0, Number(e.target.value) || 0) })} /></label><button onClick={addService}><Plus /> إضافة للبنود</button></div></div>

      <div className="sale-payment-card"><div className="sale-section-title"><div><span className="sale-step">٤</span><div><h2>طريقة الدفع</h2><p>اختر نقدي أو آجل أو وزّع الدفع بين الخزنة والحساب</p></div></div></div><div className="sale-pay-options">{([['cash', 'نقدي', Banknote], ['credit', 'آجل', Clock3], ['split', 'دفع مجزأ', RefreshCw]] as const).map(([value, label, Icon]) => <button key={value} className={draft.payment === value ? 'selected' : ''} onClick={() => patchDraft({ payment: value })}><Icon />{label}{draft.payment === value && <Check />}</button>)}</div>{draft.payment !== 'credit' && <div className="sale-payment-fields"><label>الخزنة<select value={draft.cashbox} onChange={(e) => patchDraft({ cashbox: e.target.value })}><option>خزنة الفرع الرئيسي</option><option>خزنة الكاشير</option></select></label>{draft.payment === 'split' && <><label>المبلغ من الخزنة<input type="number" min="0" value={draft.cashAmount} onChange={(e) => patchDraft({ cashAmount: Math.max(0, Number(e.target.value) || 0) })} /></label><label>الحساب البنكي<select value={draft.bankAccount} onChange={(e) => patchDraft({ bankAccount: e.target.value })}><option>حساب البنك الأهلي</option><option>حساب البنك التجاري</option></select></label><label>المبلغ من الحساب<input type="number" min="0" value={draft.bankAmount} onChange={(e) => patchDraft({ bankAmount: Math.max(0, Number(e.target.value) || 0) })} /></label></>}</div>}<div className="sale-credit-note"><span><Wallet />{draft.payment === 'credit' ? 'يُسجل كامل الإجمالي على حساب العميل' : due > 0 ? 'المتبقي يُسجل آجلًا على العميل' : 'المبلغ المدفوع يغطي إجمالي الفاتورة'}</span><strong>المتبقي: {due.toLocaleString('ar-EG')} ج.م</strong></div></div>
    </div>

    <aside className="sale-summary"><div className="sale-summary-head"><div><span className="sale-step">٥</span><div><h2>ملخص الفاتورة</h2><p>يتحدّث تلقائيًا مع البنود</p></div></div><span className="sale-summary-status"><i />{online ? 'متصل' : 'أوفلاين'}</span></div><div className="sale-summary-content"><div><span>إجمالي الأصناف</span><strong>{merchandiseGross.toLocaleString('ar-EG')} ج.م</strong></div><div><span>المصنعية والخدمات</span><strong>{serviceGross.toLocaleString('ar-EG')} ج.م</strong></div><div className="sale-discount-row"><span>خصم البنود</span><strong>− {lineDiscount.toLocaleString('ar-EG')} ج.م</strong></div>{documentDiscount > 0 && <div className="sale-discount-row"><span>خصم الفاتورة</span><strong>− {documentDiscount.toLocaleString('ar-EG')} ج.م</strong></div>}<label className="sale-doc-discount"><span>خصم الفاتورة</span><div><input type="number" min="0" max={draft.discountMode === 'percent' ? 100 : baseAfterLineDiscount} value={draft.discountValue} disabled={!permission.discount} onChange={(e) => patchDraft({ discountValue: Math.max(0, Number(e.target.value) || 0) })} /><select value={draft.discountMode} disabled={!permission.discount} onChange={(e) => patchDraft({ discountMode: e.target.value as SaleDraft['discountMode'] })}><option value="amount">ج.م</option><option value="percent">%</option></select></div></label><div className="sale-tax-row"><span>ضريبة تجريبية على البنود</span><strong>{taxTotal.toLocaleString('ar-EG')} ج.م</strong></div><div className="sale-summary-total"><span>الإجمالي النهائي</span><strong>{total.toLocaleString('ar-EG')} <small>ج.م</small></strong></div><div className="sale-paid"><span>المدفوع</span><strong>{paid.toLocaleString('ar-EG')} ج.م</strong></div><div className="sale-due"><span>المتبقي على العميل</span><strong>{due.toLocaleString('ar-EG')} ج.م</strong></div><div className="sale-temp-number"><WifiOff /><span>{online ? 'رقم الفاتورة يصدر من النظام عند الحفظ' : <>رقم مؤقت للمسودة <b>LOCAL-00017</b></>}</span></div></div><div className="sale-summary-actions"><button className="sale-save-button" onClick={() => savePreview()} disabled={!permission.create || !permission.post}><Save /> حفظ وترحيل</button><button className="sale-print-button" onClick={() => savePreview(true)} disabled={!permission.print || !permission.create || !permission.post}><Printer /> حفظ وطباعة</button><button className="sale-new-button" onClick={createNew}><Plus /> فاتورة جديدة</button>{(!permission.create || !permission.post || !permission.print || !permission.price || !permission.discount) && <small className="sale-permission-hint">الصلاحيات الفعلية تتحقق على الخادم؛ هذا الدور للمعاينة فقط.</small>}{message && <div className="sale-message" role="status">{message}</div>}</div></aside></div>

    {modal && <div className="sale-modal-backdrop"><section className="sale-confirm-modal" role="alertdialog" aria-modal="true"><span className="sale-warning-icon"><AlertTriangle /></span><h2>{modal === 'negative' ? 'الكمية تتجاوز المخزون المتاح' : 'بدء فاتورة جديدة؟'}</h2><p>{modal === 'negative' ? <>سيصبح الرصيد بالسالب في: {shortage.map((line) => <b key={line.id}>{line.name} (المتاح {line.stock}، المطلوب {line.qty}) </b>)}. هل تريد المتابعة؟</> : 'ستُمسح البنود الحالية من مسودة المعاينة. يمكنك الرجوع عنها بإلغاء هذه الخطوة.'}</p><div><button className="sale-new-button" onClick={() => setModal(null)}>رجوع</button><button className="sale-save-button" onClick={modal === 'negative' ? confirmSave : resetDraft}>{modal === 'negative' ? 'تأكيد البيع بالسالب' : 'فاتورة جديدة'}</button></div></section></div>}
  </section>;
}

function PreviewApp() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [config, setConfig] = useState(loadConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [customTab, setCustomTab] = useState<'actions' | 'nav' | 'favorites'>('actions');
  const [quickOpen, setQuickOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [tabs, setTabs] = useState([{ id: 'home', label: 'الرئيسية', icon: House }]);
  const [activeTab, setActiveTab] = useState('home');
  const tabListRef = useRef<HTMLDivElement>(null);
  const [hasScrollableTabs, setHasScrollableTabs] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* تظل إعدادات الجلسة فعالة */ } }, [prefs]);
  useEffect(() => { try { localStorage.setItem(configKey, JSON.stringify(config)); } catch { /* تظل إعدادات الجلسة فعالة */ } }, [config]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const list = tabListRef.current; if (!list) return;
    const update = () => setHasScrollableTabs(list.scrollWidth > list.clientWidth + 1);
    update(); const observer = new ResizeObserver(update); observer.observe(list);
    Array.from(list.children).forEach((tab) => observer.observe(tab)); return () => observer.disconnect();
  }, [tabs.length]);

  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && systemDark);
  const dateLabel = useMemo(() => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(now), [now]);
  const timeLabel = useMemo(() => new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' }).format(now), [now]);
  const hasPermission = (permission: string) => config.allowed.includes(permission);
  const navSections = config.navOrder.map((id) => sections.find((item) => item.id === id)!).filter((section) => config.allowed.includes(section.id));
  const visibleActions = config.homeOrder.map((id) => actions.find((item) => item.id === id)!).filter((action) => hasPermission(action.permission));
  const visibleFavorites = config.favoriteOrder.map((id) => favoriteActions.find((item) => item.id === id)!).filter((action) => hasPermission(action.permission));
  const openTab = (id: string, label: string, icon: LucideIcon, permission = id) => {
    if (!hasPermission(permission)) return;
    setTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, { id, label, icon }]);
    setActiveTab(id); setQuickOpen(false);
    const section = sections.find((item) => item.id === id) || sections.find((item) => item.id === actions.find((action) => action.id === id)?.section);
    if (section) setActiveSection(section.id);
  };
  const closeTab = (id: string) => {
    const next = tabs.filter((tab) => tab.id !== id); setTabs(next);
    if (activeTab === id) setActiveTab(next.at(-1)?.id ?? 'home');
  };
  const move = (key: 'navOrder' | 'homeOrder' | 'favoriteOrder', id: string, direction: -1 | 1) => setConfig((current) => {
    const order = [...current[key]], index = order.indexOf(id), next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return current;
    [order[index], order[next]] = [order[next], order[index]]; return { ...current, [key]: order };
  });
  const toggleId = (key: 'homeOrder' | 'favoriteOrder', id: string) => setConfig((current) => {
    const order = current[key]; return { ...current, [key]: order.includes(id) ? order.filter((value) => value !== id) : [...order, id] };
  });
  const tasks = [
    { label: 'فواتير تحتاج متابعة', count: '5', icon: ClipboardCheck, color: 'red', target: 'sales', permission: 'sales' },
    { label: 'أصناف تحت حد الطلب', count: '12', icon: Boxes, color: 'orange', target: 'inventory', permission: 'inventory' },
    { label: 'مستحقات على العملاء', count: '8', icon: UsersRound, color: 'blue', target: 'parties', permission: 'parties' },
    { label: 'مستحقات للموردين', count: '3', icon: Truck, color: 'blue', target: 'parties', permission: 'parties' },
  ].filter((task) => hasPermission(task.permission));

  return <main className={`preview-shell ${activeTab === 'sale-invoice' ? 'sale-mode' : ''} ${dark ? 'theme-dark' : 'theme-light'} accent-${prefs.accent}`} dir="rtl">
    <nav className="main-nav" aria-label="التنقل الرئيسي">
      {navSections.map((section) => { const Icon = section.icon; return <button key={section.id} className={`nav-link ${activeSection === section.id ? 'active' : ''}`} onClick={() => openTab(section.id, section.label, section.icon, section.id)}><span>{section.label}</span><Icon /></button>; })}
      <button className={`nav-link settings-link ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen(true)} aria-label="إعدادات المظهر" title="إعدادات المظهر"><span>المظهر</span><Settings /></button>
    </nav>
    <div className="workspace-tabs">
      <button className={`add-tab ${quickOpen ? 'active' : ''}`} onClick={() => setQuickOpen((value) => !value)} aria-label="فتح قائمة جديدة" title="فتح قائمة جديدة"><Plus /></button>
      <div ref={tabListRef} className={`tab-list ${hasScrollableTabs ? 'has-scrollable-tabs' : ''}`}>
        {tabs.map((tab) => { const Icon = tab.icon; return <div key={tab.id} className={`workspace-tab ${activeTab === tab.id ? 'active' : ''}`}><button className="tab-close" onClick={() => closeTab(tab.id)} aria-label={`إغلاق ${tab.label}`}><X /></button><button className="tab-title" onClick={() => setActiveTab(tab.id)}><Icon /><span>{tab.label}</span></button></div>; })}
      </div>
      {quickOpen && <div className="quick-menu" role="menu"><div className="quick-menu-title">فتح مساحة عمل · المسموح فقط</div>{navSections.map((section) => { const Icon = section.icon; return <button role="menuitem" key={section.id} onClick={() => openTab(section.id, section.label, section.icon, section.id)}><Icon /><span>{section.label}</span></button>; })}{visibleActions.slice(0, 4).map((action) => { const Icon = action.icon; return <button role="menuitem" key={action.id} onClick={() => openTab(action.id, action.label, config.actionIcons[action.id] != null ? iconChoices[config.actionIcons[action.id] % iconChoices.length] : action.icon, action.permission)}><Icon /><span>{action.label}</span></button>; })}</div>}
    </div>
    <div className={activeTab === 'sale-invoice' ? 'preview-home preview-home-hidden' : 'preview-home'}>
    <section className="welcome-row"><div className="welcome-copy"><div className="welcome-title">مرحبًا بك، زياد خالد <span className="wave">👋</span></div><p>في نظام إدارة الأعمال <b>MOTORCO</b></p></div><div className="datetime-pill"><span><CalendarDays />{dateLabel}</span><i /><span><Clock3 />{timeLabel}</span></div></section>

    <section className="home-actions" aria-label="اختصارات العمليات">
      <div className="home-actions-heading"><div><h1>عمليات سريعة</h1><p>{visibleActions.length} عمليات متاحة</p></div><button className="customize-button" onClick={() => { setCustomTab('actions'); setCustomizeOpen(true); }}><SlidersHorizontal /> تخصيص الكروت</button></div>
      <div className="action-grid" style={{ '--action-count': Math.max(1, visibleActions.length) } as React.CSSProperties}>
        {visibleActions.map((action) => {
          const Icon = config.actionIcons[action.id] != null ? iconChoices[config.actionIcons[action.id] % iconChoices.length] : action.icon;
          return <button key={action.id} className={`action-card ${action.color}`} onClick={() => openTab(action.id, action.label, Icon, action.permission)} title={action.label}><Icon className="section-icon" strokeWidth={1.8} /><span>{action.label}</span></button>;
        })}
        {!visibleActions.length && <div className="shortcuts-empty">لا توجد عمليات متاحة لهذا المستخدم.</div>}
      </div>
    </section>

    <section className="dashboard-panels">
      <article className="panel tasks-panel"><div className="panel-heading"><h2><ClipboardCheck /> مهامي السريعة</h2><span className="panel-caption">تنبيهات ومتابعات</span></div>
        <div className="task-list">{tasks.map((task) => { const Icon = task.icon; const target = sections.find((item) => item.id === task.target)!; return <button key={task.label} className="task-row" onClick={() => openTab(target.id, target.label, target.icon, task.permission)}><Icon className="task-icon" /><span className="task-label">{task.label}</span><b className={`task-count ${task.color}`}>{task.count}</b><ChevronLeft className="task-chevron" /></button>; })}</div>
      </article>
      <article className="panel shortcuts-panel"><div className="panel-heading"><h2><span className="star">★</span> اختصاراتي المفضلة</h2><button className="customize-button" onClick={() => { setCustomTab('favorites'); setCustomizeOpen(true); }}><SlidersHorizontal /> تخصيص</button></div>
        <div className="favorite-grid" style={{ '--favorite-count': Math.max(1, visibleFavorites.length) } as React.CSSProperties}>{visibleFavorites.map((action) => { const Icon = action.icon; return <button key={action.id} className={`favorite-card ${action.color}`} onClick={() => openTab(action.id, action.label, action.icon, action.permission)}><Icon /><span>{action.label}</span></button>; })}{!visibleFavorites.length && <div className="shortcuts-empty">أضف أوامر متكررة من «تخصيص».</div>}</div>
      </article>
    </section>
    <footer className="preview-footer"><span><span className="demo-dot" /> معاينة تفاعلية · بيانات تجريبية · المستخدم: زياد خالد</span><span>واجهة MOTORCO ERP</span></footer>
    </div>

    <SaleInvoicePreview active={activeTab === 'sale-invoice'} />

    {settingsOpen && <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}><section className="appearance-panel" aria-label="تفضيلات المظهر">
      <header><div><span className="settings-heading-icon"><Palette /></span><div><h2>تفضيلات المظهر</h2><p>تخصيص شكل المعاينة</p></div></div><button className="close-panel" onClick={() => setSettingsOpen(false)} aria-label="إغلاق"><X /></button></header>
      <div className="settings-section"><h3>المظهر</h3><div className="mode-options">{([['light', 'فاتح', Sun], ['dark', 'داكن', Moon], ['system', 'النظام', BriefcaseBusiness]] as const).map(([mode, label, Icon]) => <button key={mode} className={prefs.mode === mode ? 'chosen' : ''} onClick={() => setPrefs((value) => ({ ...value, mode }))}><Icon /><span>{label}</span>{prefs.mode === mode && <Check />}</button>)}</div></div>
      <div className="settings-section"><h3>اللون المميز</h3><div className="accent-options">{([['blue', 'أزرق', '#2463eb'], ['violet', 'بنفسجي', '#7554e8'], ['teal', 'فيروزي', '#0d9b9d'], ['orange', 'برتقالي', '#eb8a1d']] as const).map(([accent, label, color]) => <button key={accent} className={prefs.accent === accent ? 'chosen' : ''} onClick={() => setPrefs((value) => ({ ...value, accent }))} aria-label={label} aria-pressed={prefs.accent === accent}><i style={{ background: color }}>{prefs.accent === accent && <Check />}</i><span>{label}</span></button>)}</div></div>
      <div className="appearance-note">تفضيلات المظهر محفوظة لمستخدم المعاينة الحالي على هذا الجهاز.</div><button className="done-button" onClick={() => setSettingsOpen(false)}>تم</button>
    </section></div>}

    {customizeOpen && <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCustomizeOpen(false)}><section className="appearance-panel customize-panel" aria-label="تخصيص الرئيسية">
      <header><div><span className="settings-heading-icon"><SlidersHorizontal /></span><div><h2>تخصيص الرئيسية</h2><p>ترتيب شخصي للمستخدم · زياد خالد</p></div></div><button className="close-panel" onClick={() => setCustomizeOpen(false)} aria-label="إغلاق"><X /></button></header>
      <div className="custom-tabs" role="tablist"><button className={customTab === 'actions' ? 'selected' : ''} onClick={() => setCustomTab('actions')}>عمليات جديدة</button><button className={customTab === 'nav' ? 'selected' : ''} onClick={() => setCustomTab('nav')}>شريط الأقسام</button><button className={customTab === 'favorites' ? 'selected' : ''} onClick={() => setCustomTab('favorites')}>المفضلة</button></div>
      {customTab === 'actions' && <><p className="custom-help">أضف أو أزل عملية، غيّر أيقونتها، ورتّبها كما تريد. لا يظهر هنا إلا ما تسمح به صلاحيات المستخدم.</p><div className="custom-list">{actions.filter((action) => hasPermission(action.permission)).map((action) => { const selected = config.homeOrder.includes(action.id); const Icon = config.actionIcons[action.id] != null ? iconChoices[config.actionIcons[action.id] % iconChoices.length] : action.icon; const index = config.homeOrder.indexOf(action.id); return <div key={action.id} className={`custom-row ${selected ? 'selected' : ''}`}><button className="custom-toggle" onClick={() => toggleId('homeOrder', action.id)} aria-pressed={selected}>{selected ? <Check /> : <Plus />}</button><Icon className={`custom-row-icon ${action.color}`} /><span>{action.label}</span>{selected && <div className="row-tools"><button title="تغيير الأيقونة" aria-label={`تغيير أيقونة ${action.label}`} onClick={() => setConfig((current) => ({ ...current, actionIcons: { ...current.actionIcons, [action.id]: ((current.actionIcons[action.id] ?? iconChoices.indexOf(action.icon)) + 1) % iconChoices.length } }))}><Palette /></button><button title="تحريك لأعلى" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => move('homeOrder', action.id, -1)}><ArrowUp /></button><button title="تحريك لأسفل" aria-label="تحريك لأسفل" disabled={index === config.homeOrder.length - 1} onClick={() => move('homeOrder', action.id, 1)}><ArrowDown /></button></div>}</div>; })}</div></>}
      {customTab === 'nav' && <><p className="custom-help">اختر الأقسام المسموح بها للمستخدم ورتّب ظهورها في شريط التنقل. الأقسام المحجوبة لا تظهر في القائمة أو كبطاقات عمليات.</p><div className="custom-list">{config.navOrder.map((id) => { const section = sections.find((item) => item.id === id)!; const Icon = section.icon; const selected = config.allowed.includes(id); const index = config.navOrder.indexOf(id); return <div key={id} className={`custom-row ${selected ? 'selected' : 'disabled-row'}`}><button className="custom-toggle" onClick={() => setConfig((current) => ({ ...current, allowed: selected ? current.allowed.filter((value) => value !== id) : [...current.allowed, id] }))} aria-pressed={selected}>{selected ? <Check /> : <Plus />}</button><Icon className={`custom-row-icon ${section.color}`} /><span>{section.label}</span><div className="row-tools"><button title="تحريك لأعلى" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => move('navOrder', id, -1)}><ArrowUp /></button><button title="تحريك لأسفل" aria-label="تحريك لأسفل" disabled={index === config.navOrder.length - 1} onClick={() => move('navOrder', id, 1)}><ArrowDown /></button></div></div>; })}<div className="permission-note">صلاحية التقارير <button className={`permission-chip ${hasPermission('reports') ? 'enabled' : ''}`} onClick={() => setConfig((current) => ({ ...current, allowed: hasPermission('reports') ? current.allowed.filter((id) => id !== 'reports') : [...current.allowed, 'reports'] }))}>{hasPermission('reports') ? 'مسموح' : 'غير مسموح'}</button></div></div><div className="appearance-note">محاكاة الصلاحيات للمعاينة فقط. النظام الفعلي يجب أن يتحقق من الإذن على الخادم قبل تنفيذ كل عملية.</div></>}
      {customTab === 'favorites' && <><p className="custom-help">هذه أوامر يومية متكررة، منفصلة عن بطاقات إنشاء العمليات والتنبيهات.</p><div className="custom-list">{favoriteActions.filter((action) => hasPermission(action.permission)).map((action) => { const Icon = action.icon; const selected = config.favoriteOrder.includes(action.id); const index = config.favoriteOrder.indexOf(action.id); return <div key={action.id} className={`custom-row ${selected ? 'selected' : ''}`}><button className="custom-toggle" onClick={() => toggleId('favoriteOrder', action.id)} aria-pressed={selected}>{selected ? <Check /> : <Plus />}</button><Icon className={`custom-row-icon ${action.color}`} /><span>{action.label}</span>{selected && <div className="row-tools"><button title="تحريك لأعلى" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => move('favoriteOrder', action.id, -1)}><ArrowUp /></button><button title="تحريك لأسفل" aria-label="تحريك لأسفل" disabled={index === config.favoriteOrder.length - 1} onClick={() => move('favoriteOrder', action.id, 1)}><ArrowDown /></button></div>}</div>; })}</div></>}
      <button className="done-button" onClick={() => setCustomizeOpen(false)}>تم · حفظ التخصيص</button>
    </section></div>}
  </main>;
}

createRoot(document.getElementById('preview-root')!).render(<PreviewApp />);
