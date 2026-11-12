import { DOC_TYPES, hasPermission } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { LANDED_KEY, useHome } from '../lib/home';
import { useSession } from '../lib/hooks';
import { HUBS } from './nav';
import { useUi } from './ui';

/**
 * حارس الشاشات: الواجهة لا تعرض شاشة بدون صلاحيتها. هذا للعرض فقط؛
 * الخادم يتحقق من الصلاحية في كل عملية وكل تقرير بشكل مستقل.
 */
export function RequirePerm({ any, children }: { any: string[]; children: ReactNode }) {
  const { session } = useSession();
  const ok = any.length === 0 || any.some((p) => hasPermission(session.user.permissions, p));
  return ok ? <>{children}</> : <Denied />;
}

/** الرجوع لصفحة بداية مسموحة مع تنبيه واحد */
function Denied() {
  const ui = useUi();
  const { home } = useHome();
  const loc = useLocation();
  useEffect(() => {
    ui.toast('ليس لديك صلاحية لفتح هذه الشاشة', 'warn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  // صفحة البداية مسموحة دائمًا بحكم طريقة اختيارها، فلا حلقة توجيه
  return <Navigate to={home.path === loc.pathname ? '/' : home.path} replace />;
}

/** صلاحية إنشاء كل نوع مستند */
export function createPermFor(type: string): string | null {
  const special: Record<string, string> = {
    quotation: 'sales.quotation',
    journal_voucher: 'accounts.journal',
    party_opening: 'accounts.journal',
    partner_capital: 'partners.create',
    partner_withdrawal: 'partners.create',
    profit_distribution: 'partners.distribute',
    year_closing: 'period.lock',
  };
  if (special[type]) return special[type];
  const info = DOC_TYPES[type as keyof typeof DOC_TYPES];
  return info ? `${info.module}.create` : null;
}

export function NewDocGuard({ children }: { children: ReactNode }) {
  const { type = '' } = useParams();
  const p = createPermFor(type);
  return <RequirePerm any={p ? [p] : ['__none__']}>{children}</RequirePerm>;
}

/** عرض/تعديل مستند: يحتاج صلاحية مشاهدة وحدته (مبيعات، مشتريات، خزينة...) */
export function DocGuard({ children }: { children: ReactNode }) {
  const { id = '' } = useParams();
  const doc = useLiveQuery(async () => ({ d: (await db.documents.get(id)) ?? null }), [id]);
  if (!doc) return null;
  const info = doc.d ? DOC_TYPES[doc.d.doc_type as keyof typeof DOC_TYPES] : null;
  // مستند غير موجود محليًا: الشاشة نفسها تعرض رسالتها
  if (!info) return <>{children}</>;
  return <RequirePerm any={[`${info.module}.view`]}>{children}</RequirePerm>;
}

export function HubGuard({ children }: { children: ReactNode }) {
  const { key = '' } = useParams();
  const hub = HUBS.find((h) => h.key === key);
  return <RequirePerm any={hub?.perm ? [hub.perm] : []}>{children}</RequirePerm>;
}

/**
 * «/»: أول دخول في الجلسة يذهب لصفحة بداية المستخدم مباشرة (قبل رسم أي شيء، فلا وميض).
 * بعدها «الرئيسية» تفتح لوحة الإدارة عادي.
 */
export function HomeRoute({ children }: { children: ReactNode }) {
  const { home } = useHome();
  // ننتظر قراءة إعداد صفحات الأدوار من الجهاز (لحظي) حتى لا نوجه للمكان الخطأ
  const ready = useLiveQuery(async () => ({ v: (await db.settings.get('role_home_pages'))?.value ?? null }), []);
  let landed = true;
  try {
    landed = sessionStorage.getItem(LANDED_KEY) === '1';
  } catch {
    /* ignore */
  }
  if (!landed && !ready) return null;
  if (!landed) {
    try {
      sessionStorage.setItem(LANDED_KEY, '1');
    } catch {
      /* ignore */
    }
    if (home.path !== '/') return <Navigate to={home.path} replace />;
  }
  return <>{children}</>;
}
