import { DEFAULT_ROLES } from '@erp/shared';
import { hashPassword } from './auth';
import type { Db } from './db';

/**
 * دليل الحسابات الافتراضي (قابل للتعديل لاحقًا من شاشة دليل الحسابات).
 * الحسابات التي لها system_key يعتمد عليها الترحيل الآلي؛ يمكن تغيير اسمها ولا يمكن حذفها.
 */
type Acc = [code: string, name: string, type: string, isGroup: boolean, systemKey?: string];
export const DEFAULT_ACCOUNTS: Acc[] = [
  ['1', 'الأصول', 'asset', true],
  ['11', 'الأصول المتداولة', 'asset', true],
  ['1101', 'الخزائن النقدية', 'asset', true, 'cash_group'],
  ['1102', 'البنوك', 'asset', true, 'bank_group'],
  ['1103', 'العملاء', 'asset', false, 'ar'],
  ['1104', 'المخزون', 'asset', false, 'inventory'],
  ['1105', 'ضريبة القيمة المضافة - مدخلات', 'asset', false, 'vat_input'],
  ['1106', 'أوراق القبض (شيكات تحت التحصيل)', 'asset', false, 'notes_receivable'],
  ['1107', 'سلف وعهد', 'asset', false],
  ['1108', 'سلف الموظفين', 'asset', true, 'employee_advances_group'],
  ['12', 'الأصول الثابتة', 'asset', true],
  ['1201', 'أثاث وتجهيزات', 'asset', false],
  ['1202', 'أجهزة ومعدات', 'asset', false],
  ['1203', 'سيارات', 'asset', false],
  ['1209', 'مجمع الإهلاك', 'asset', false],
  ['2', 'الخصوم', 'liability', true],
  ['21', 'الخصوم المتداولة', 'liability', true],
  ['2101', 'الموردون', 'liability', false, 'ap'],
  ['2102', 'ضريبة القيمة المضافة - مخرجات', 'liability', false, 'vat_output'],
  ['2103', 'أوراق الدفع (شيكات صادرة)', 'liability', false, 'notes_payable'],
  ['2104', 'مصروفات مستحقة', 'liability', false],
  ['2105', 'جاري الشركاء', 'liability', false, 'partners_current'],
  ['2106', 'حسابات الشركاء الجارية', 'liability', true, 'partners_current_group'],
  ['3', 'حقوق الملكية', 'equity', true],
  ['31', 'رأس المال', 'equity', false, 'capital'],
  ['32', 'الأرباح المحتجزة', 'equity', false, 'retained'],
  ['33', 'أرصدة افتتاحية', 'equity', false, 'opening_equity'],
  ['34', 'رؤوس أموال الشركاء', 'equity', true, 'partners_capital_group'],
  ['35', 'توزيعات أرباح معلنة', 'equity', false, 'profit_distribution'],
  ['4', 'الإيرادات', 'revenue', true],
  ['41', 'المبيعات', 'revenue', false, 'sales'],
  ['42', 'مردودات المبيعات', 'revenue', false, 'sales_returns'],
  ['43', 'خصم مسموح به', 'revenue', false, 'sales_discount'],
  ['44', 'إيرادات أخرى', 'revenue', false, 'other_income'],
  ['5', 'المصروفات', 'expense', true],
  ['51', 'تكلفة البضاعة المباعة', 'expense', false, 'cogs'],
  ['52', 'المصروفات العمومية والإدارية', 'expense', true, 'expenses_group'],
  ['5201', 'إيجارات', 'expense', false],
  ['5202', 'رواتب وأجور', 'expense', false, 'salaries'],
  ['5203', 'كهرباء ومياه', 'expense', false],
  ['5204', 'اتصالات وإنترنت', 'expense', false],
  ['5205', 'نقل ومواصلات', 'expense', false],
  ['5206', 'صيانة', 'expense', false],
  ['5207', 'عمولات بنكية وعمولات الدفع', 'expense', false, 'payment_fees'],
  ['5208', 'عمولات المندوبين', 'expense', false, 'commissions'],
  ['5299', 'مصروفات متنوعة', 'expense', false, 'misc_expense'],
  ['53', 'فروقات جرد المخزون', 'expense', false, 'inventory_diff'],
  ['54', 'فروق تكلفة المرتجعات', 'expense', false, 'cost_variance'],
  ['55', 'عجز وزيادة الخزينة', 'expense', false, 'cash_over_short'],
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  company_name: 'شركتي',
  currency: 'EGP',
  currency_label: 'ج.م',
  default_tax_rate_bp: 1400,
  prices_include_tax: false,
  /** هل يُسمح بالبيع بكمية أكبر من الرصيد؟ الافتراضي لا — العملية تذهب للمراجعة */
  allow_negative_stock: false,
  /** هل يُسمح بالبيع الآجل بأكثر من الحد الائتماني؟ */
  enforce_credit_limit: true,
  /** أيام الاستحقاق الافتراضية للفواتير الآجلة (0 = بدون) */
  default_due_days: 0,
  /** لا يُسمح بترحيل أو إلغاء مستند بتاريخ حتى هذا اليوم (قفل الفترة) */
  locked_until: null,
};

export async function seed(db: Db, opts: { adminPassword?: string } = {}) {
  await db.tx(async (t) => {
    // قفل حتى لا يزرع خادمان البيانات الأولية معًا
    await t.query(`select pg_advisory_xact_lock(7341)`);
    const existing = await t.one(`select count(*)::int as n from roles`);
    if (existing && existing.n > 0) return;

    for (const r of DEFAULT_ROLES) {
      await t.query(`insert into roles (id, name, permissions, is_system) values ($1, $2, $3, true)`, [
        r.id,
        r.name,
        JSON.stringify(r.permissions),
      ]);
    }
    await t.query(
      `insert into users (id, username, full_name, password_hash, role_id) values ('user-admin', 'admin', 'مدير النظام', $1, 'role-admin')`,
      [await hashPassword(opts.adminPassword ?? 'admin123')],
    );

    const idByCode = new Map<string, string>();
    for (const [code, name, type, isGroup, key] of DEFAULT_ACCOUNTS) {
      const id = `acc-${code}`;
      const parentCode = [...idByCode.keys()].filter((c) => code.startsWith(c) && c !== code).sort((a, b) => b.length - a.length)[0];
      await t.query(
        `insert into accounts (id, code, name, parent_id, type, is_group, system_key) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, code, name, parentCode ? idByCode.get(parentCode) : null, type, isGroup, key ?? null],
      );
      idByCode.set(code, id);
    }

    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await t.query(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
    }
    await t.query(`insert into settings (key, value) values ('db_epoch', $1)`, [JSON.stringify(crypto.randomUUID())]);

    await t.query(`insert into warehouses (id, code, name) values ('wh-main', '1', 'المخزن الرئيسي')`);
    await t.query(`insert into accounts (id, code, name, parent_id, type) values ('acc-110101', '110101', 'الخزينة الرئيسية', 'acc-1101', 'asset')`);
    await t.query(`insert into cashboxes (id, name, kind, account_id) values ('cb-main', 'الخزينة الرئيسية', 'cash', 'acc-110101')`);
    await t.query(`insert into categories (id, name) values ('cat-general', 'عام')`);
    await t.query(`insert into parties (id, kind, code, name, group_id) values ('party-cash-customer', 'customer', '0', 'عميل نقدي', 'pg-cash')`);
  });
}
