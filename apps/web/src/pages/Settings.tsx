import { bpToPercent, parsePercentBp } from '@erp/shared';
import { Building2, ChevronLeft, HardDriveDownload, KeyRound, ListTree, MonitorSmartphone, Palette, Printer, RefreshCw, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Wallet, Warehouse } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShortcutCard, type ShortcutColor } from '../components/ShortcutCard';
import { PageHeader } from '../components/Layout';
import { AppearancePanel } from '../components/Appearance';
import { Banner, Field, Switch, useUi } from '../components/ui';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { usePerm, useSettings } from '../lib/hooks';
import { clearLocalData, syncNow } from '../lib/sync';

export function SettingsPage() {
  const can = usePerm();
  const ui = useUi();
  const s = useSettings();
  const [f, setF] = useState<any>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [err, setErr] = useState<string | null>(null);
  const [storage, setStorage] = useState<string | null>(null);
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    if (!f && s.company_name !== undefined) setF({ ...s, tax_pct: bpToPercent(s.default_tax_rate_bp ?? 0) });
  }, [s, f]);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStorage(`${((e.usage ?? 0) / 1024 / 1024).toFixed(1)} م.ب مستخدمة`)).catch(() => {});
  }, []);

  const save = async () => {
    setErr(null);
    try {
      await api('/api/admin/settings', {
        body: {
          company_name: f.company_name,
          company_address: f.company_address ?? '',
          company_phone: f.company_phone ?? '',
          company_tax_no: f.company_tax_no ?? '',
          invoice_footer: f.invoice_footer ?? '',
          default_tax_rate_bp: parsePercentBp(f.tax_pct || '0'),
          allow_negative_stock: !!f.allow_negative_stock,
          enforce_credit_limit: !!f.enforce_credit_limit,
          default_due_days: Math.max(0, Number(f.default_due_days) || 0),
          print_logo: f.print_logo || null,
          print_template_invoice: f.print_template_invoice || 'a4',
          print_template_voucher: f.print_template_voucher || 'voucher',
          print_show_balance: !!f.print_show_balance,
          print_contract_terms: f.print_contract_terms || '',
          ...(can('period.lock') ? { locked_until: f.locked_until || null } : {}),
        },
      });
      ui.toast('تم حفظ الإعدادات');
      void syncNow();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const manage = can('settings.manage') && !!f;
  const saveBtn = <button className="btn primary lg stg-save" onClick={save}>حفظ الإعدادات</button>;
  type Sec = 'general' | 'company' | 'rules' | 'print' | 'appearance' | 'password' | 'device';
  const secs: { id: Sec; label: string; icon: ReactNode; show: boolean }[] = [
    { id: 'general', label: 'عام', icon: <Settings />, show: true },
    { id: 'company', label: 'بيانات الشركة', icon: <Building2 />, show: manage },
    { id: 'rules', label: 'قواعد العمل', icon: <SlidersHorizontal />, show: manage },
    { id: 'print', label: 'الطباعة', icon: <Printer />, show: manage },
    { id: 'appearance', label: 'المظهر', icon: <Palette />, show: true },
    { id: 'password', label: 'كلمة المرور', icon: <KeyRound />, show: true },
    { id: 'device', label: 'هذا الجهاز', icon: <MonitorSmartphone />, show: true },
  ];
  const links = [
    { to: '/users', label: 'المستخدمون والصلاحيات', icon: <ShieldCheck />, perm: 'users.manage' },
    { to: '/warehouses', label: 'المخازن والتصنيفات', icon: <Warehouse />, perm: 'items.view' },
    { to: '/accounts', label: 'دليل الحسابات', icon: <ListTree />, perm: 'accounts.view' },
    { to: '/sync', label: 'المزامنة', icon: <RefreshCw /> },
    { to: '/backups', label: 'النسخ الاحتياطي', icon: <HardDriveDownload />, perm: 'backup.manage' },
    { to: '/audit', label: 'سجل التدقيق', icon: <ScrollText />, perm: 'audit.view' },
  ].filter((l) => !l.perm || can(l.perm));
  const raw = sp.get('sec') as Sec | null;
  const sec: Sec = raw && secs.some((x) => x.id === raw && x.show) ? raw : 'general';
  const go = (id: Sec) => setSp(id === 'general' ? {} : { sec: id }, { replace: true });
  const cards: { label: string; icon: ReactNode; color: ShortcutColor; onClick: () => void; show: boolean }[] = [
    { label: 'بيانات الشركة', icon: <Building2 />, color: 'orange', onClick: () => go('company'), show: manage },
    { label: 'المخازن والتصنيفات', icon: <Warehouse />, color: 'red', onClick: () => nav('/warehouses'), show: can('items.view') },
    { label: 'الخزائن والبنوك', icon: <Wallet />, color: 'blue', onClick: () => nav('/cashboxes'), show: can('treasury.view') },
    { label: 'دليل الحسابات', icon: <ListTree />, color: 'yellow', onClick: () => nav('/accounts'), show: can('accounts.view') },
    { label: 'المستخدمون والصلاحيات', icon: <ShieldCheck />, color: 'indigo', onClick: () => nav('/users'), show: can('users.manage') },
    { label: 'إعدادات النظام', icon: <SlidersHorizontal />, color: 'blue', onClick: () => go('rules'), show: manage },
    { label: 'الطباعة', icon: <Printer />, color: 'teal', onClick: () => go('print'), show: manage },
    { label: 'المظهر', icon: <Palette />, color: 'purple', onClick: () => go('appearance'), show: true },
  ];

  return (
    <div className="page">
      <PageHeader title="الإعدادات" />
      {err && <Banner kind="err">{err}</Banner>}
      <div className="stg-layout">
        <nav className="stg-menu" aria-label="أقسام الإعدادات">
          {secs.filter((x) => x.show).map((x) => (
            <button key={x.id} type="button" className={sec === x.id ? 'on' : ''} aria-current={sec === x.id ? 'page' : undefined} onClick={() => go(x.id)}>
              <span className="stg-menu-ic">{x.icon}</span>{x.label}
            </button>
          ))}
          {links.length > 0 && <div className="stg-menu-sep">صفحات الإعدادات</div>}
          {links.map((l) => (
            <button key={l.to} type="button" onClick={() => nav(l.to)}>
              <span className="stg-menu-ic">{l.icon}</span>{l.label}<ChevronLeft className="stg-menu-go" />
            </button>
          ))}
        </nav>
        <div className="stg-body">
          {sec === 'general' && (
            <>
              <div className="stg-title">البيانات الأساسية</div>
              <div className="sc-grid stg-cards">
                {cards.filter((c) => c.show).map((c) => <ShortcutCard key={c.label} label={c.label} icon={c.icon} color={c.color} onClick={c.onClick} />)}
              </div>
            </>
          )}
          {sec === 'company' && manage && (
            <>
              <div className="stg-title">بيانات الشركة <span>(تظهر في الطباعة وأعلى الشاشة)</span></div>
          <div className="card pad stack">
            <Field label="اسم الشركة / المحل"><input className="input" value={f.company_name ?? ''} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
            <Field label="العنوان"><input className="input" value={f.company_address ?? ''} onChange={(e) => setF({ ...f, company_address: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="الهاتف"><input className="input num" value={f.company_phone ?? ''} onChange={(e) => setF({ ...f, company_phone: e.target.value })} /></Field>
              <Field label="رقم التسجيل الضريبي"><input className="input num" value={f.company_tax_no ?? ''} onChange={(e) => setF({ ...f, company_tax_no: e.target.value })} /></Field>
            </div>
            <Field label="تذييل الفاتورة المطبوعة"><input className="input" value={f.invoice_footer ?? ''} onChange={(e) => setF({ ...f, invoice_footer: e.target.value })} placeholder="مثال: شكرًا لتعاملكم معنا" /></Field>
          </div>
              {saveBtn}
            </>
          )}
          {sec === 'rules' && manage && (
            <>
              <div className="stg-title">قواعد العمل</div>
          <div className="list">
            <div className="list-row">
              <div className="title">نسبة الضريبة الافتراضية للأصناف الجديدة %<div className="sub">العملة: الجنيه المصري. لا يتضمن النظام ربطًا بمنظومة الفاتورة الإلكترونية بعد.</div></div>
              <input className="input num" style={{ width: 90 }} value={f.tax_pct} onChange={(e) => setF({ ...f, tax_pct: e.target.value })} />
            </div>
            <div className="list-row">
              <div className="title">السماح بالبيع بأكثر من الرصيد<div className="sub">عند الإيقاف: المستند يذهب للمراجعة بدل الترحيل</div></div>
              <Switch checked={!!f.allow_negative_stock} onChange={(v) => setF({ ...f, allow_negative_stock: v })} />
            </div>
            <div className="list-row">
              <div className="title">تطبيق الحد الائتماني للعملاء<div className="sub">البيع الآجل فوق الحد يذهب للمراجعة</div></div>
              <Switch checked={!!f.enforce_credit_limit} onChange={(v) => setF({ ...f, enforce_credit_limit: v })} />
            </div>
            <div className="list-row">
              <div className="title">أيام الاستحقاق الافتراضية للفواتير الآجلة<div className="sub">0 = بدون تاريخ استحقاق تلقائي</div></div>
              <input className="input num" style={{ width: 90 }} type="number" min={0} value={f.default_due_days ?? 0} onChange={(e) => setF({ ...f, default_due_days: e.target.value })} />
            </div>
            {can('period.lock') && (
              <div className="list-row">
                <div className="title">قفل الفترات حتى تاريخ<div className="sub">لا يُسمح بترحيل أو إلغاء أي مستند بتاريخ حتى هذا اليوم</div></div>
                <input type="date" className="input" style={{ width: 170 }} value={f.locked_until ?? ''} onChange={(e) => setF({ ...f, locked_until: e.target.value || null })} />
              </div>
            )}
          </div>
              {saveBtn}
            </>
          )}
          {sec === 'print' && manage && (
            <>
              <PrintSettings f={f} setF={setF} />
              {saveBtn}
            </>
          )}
          {sec === 'appearance' && (
            <>
              <div className="stg-title">المظهر <span>(خاص بحسابك)</span></div>
              <div className="card pad"><AppearancePanel /></div>
            </>
          )}
          {sec === 'password' && (
            <>
              <div className="stg-title">تغيير كلمة المرور</div>
      <div className="card pad stack">
        <Field label="كلمة المرور الحالية"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="كلمة المرور الجديدة"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <button
          className="btn"
          disabled={!pw.current || pw.next.length < 6}
          onClick={async () => {
            try {
              await api('/api/auth/change-password', { body: pw });
              setPw({ current: '', next: '' });
              ui.toast('تم تغيير كلمة المرور');
            } catch (e) {
              ui.toast((e as Error).message, 'err');
            }
          }}
        >
          تغيير
        </button>
      </div>

            </>
          )}
          {sec === 'device' && (
            <>
              <div className="stg-title">هذا الجهاز</div>
      <div className="list">
        <div className="list-row"><div className="title">التخزين المحلي</div><span className="muted">{storage ?? '—'}</span></div>
        <div className="list-row">
          <div className="title">مسح البيانات المحلية<div className="sub">يحذف النسخة المحلية فقط؛ العمليات غير المرسلة ستُفقد</div></div>
          <button
            className="btn sm danger"
            onClick={async () => {
              const pending = await db.outbox.where('status').equals('pending').count();
              const ok = await ui.confirm({
                title: 'مسح البيانات المحلية؟',
                message: pending ? `تحذير: يوجد ${pending} عملية لم تُرفع للخادم وستُفقد نهائيًا.` : 'ستُحمّل البيانات من الخادم من جديد عند الدخول.',
                confirmLabel: 'مسح',
                destructive: true,
              });
              if (!ok) return;
              await clearLocalData();
              localStorage.removeItem('erp.session');
              location.reload();
            }}
          >
            مسح
          </button>
        </div>
      </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** إعدادات الطباعة: الشعار والقوالب الافتراضية وشروط عقد التقسيط */
function PrintSettings({ f, setF }: { f: any; setF: (v: any) => void }) {
  const onLogo = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // تصغير الشعار ليبقى خفيفًا ويُخزن ضمن الإعدادات ويعمل دون اتصال
      const scale = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setF({ ...f, print_logo: c.toDataURL('image/png') });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  return (
    <>
      <div className="stg-title">الطباعة</div>
      <div className="card pad stack">
        <div className="row">
          <div style={{ flex: 1 }}>
            <div className="bold">شعار الشركة</div>
            <div className="footnote">يظهر أعلى الفواتير والسندات والإيصالات الحرارية</div>
          </div>
          {f.print_logo && <img src={f.print_logo} alt="" style={{ maxHeight: 50, maxWidth: 120, objectFit: 'contain' }} />}
          <label className="btn sm">
            اختيار صورة
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onLogo(e.target.files?.[0])} />
          </label>
          {f.print_logo && <button className="btn sm danger" onClick={() => setF({ ...f, print_logo: null })}>إزالة</button>}
        </div>
        <div className="grid grid-2">
          <Field label="القالب الافتراضي للفواتير">
            <select className="select" value={f.print_template_invoice || 'a4'} onChange={(e) => setF({ ...f, print_template_invoice: e.target.value })}>
              <option value="a4">A4 كامل</option>
              <option value="a5">A5 نصف صفحة</option>
              <option value="thermal80">إيصال حراري 80mm</option>
              <option value="thermal58">إيصال حراري 58mm</option>
            </select>
          </Field>
          <Field label="القالب الافتراضي للسندات">
            <select className="select" value={f.print_template_voucher || 'voucher'} onChange={(e) => setF({ ...f, print_template_voucher: e.target.value })}>
              <option value="voucher">سند مع المبلغ بالحروف</option>
              <option value="a5">A5</option>
              <option value="thermal80">إيصال حراري 80mm</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <div className="title" style={{ flex: 1 }}>إظهار رصيد العميل/المورد الحالي على الفاتورة</div>
          <Switch checked={!!f.print_show_balance} onChange={(v) => setF({ ...f, print_show_balance: v })} />
        </div>
        <Field label="شروط عقد التقسيط" hint="تُطبع في عقد التقسيط؛ اتركها فارغة لاستخدام الشروط الافتراضية">
          <textarea className="textarea" style={{ minHeight: 120 }} value={f.print_contract_terms ?? ''} onChange={(e) => setF({ ...f, print_contract_terms: e.target.value })} />
        </Field>
        <div className="footnote">اضغط «حفظ الإعدادات» أعلى الصفحة بعد التعديل.</div>
      </div>
    </>
  );
}
