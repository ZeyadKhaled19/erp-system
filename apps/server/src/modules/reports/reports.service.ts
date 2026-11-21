import { Inject, Injectable } from '@nestjs/common';
import { DOC_TYPES, hasPermission } from '@erp/shared';
import type { AuthUser } from '../../auth';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import * as R from '../../reports';
import { assertCashboxScope, assertWarehouseScope, can } from '../../core/access';
import { DB } from '../../core/tokens';

const parseData = (d: unknown) => (typeof d === 'string' ? JSON.parse(d || '{}') : d ?? {});
const viewPermOf = (docType: string) => {
  const module = DOC_TYPES[docType as keyof typeof DOC_TYPES]?.module;
  return module === 'accounts' ? 'accounts.view' : module ? `${module}.view` : '';
};
/** أنواع المستندات اللي المستخدم يقدر يشوف وحدتها */
export const viewableDocTypes = (user: AuthUser) => Object.keys(DOC_TYPES).filter((t) => hasPermission(user.permissions, viewPermOf(t)));

/**
 * التقارير: الحساب نفسه في reports.ts (من القيود وحركات المخزون المرحّلة بس).
 * هنا بس نطاق المستخدم: المخازن والخزائن المسموحة، وإخفاء التكلفة والأرباح عن اللي ما عندهوش صلاحيتها.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private db: Db) {}

  async dashboard(user: AuthUser, today: string) {
    const d = await R.dashboard(this.db, today);
    // لا تُعرض أرقام لا يملك المستخدم صلاحية رؤيتها (الشكل نفسه، والقيمة null)
    if (!can(user, 'reports.profit')) d.month_gross_profit = null as any;
    if (!can(user, 'sales.view')) Object.assign(d, { today_sales: null, today_count: null, month_net_sales: null });
    if (!can(user, 'treasury.view')) d.cashboxes = [] as any;
    if (!can(user, 'parties.view')) Object.assign(d, { receivables: null, payables: null });
    if (!can(user, 'costs.view')) d.stock_value = null as any;
    if (!can(user, 'inventory.view')) d.reorder_count = null as any;
    return d;
  }

  cashboxMovement(user: AuthUser, id: string, range: { from?: string; to?: string }) {
    assertCashboxScope(user, id);
    return R.cashboxMovement(this.db, id, range);
  }

  /** تقارير المخزون بدون مخزن محدد مسموحة بس لمن يعمل على كل المخازن */
  private warehouseRequired(user: AuthUser, warehouseId: string | undefined) {
    assertWarehouseScope(user, warehouseId);
    if (!warehouseId && user.warehouse_ids !== null) throw new AppError('حدد مخزنًا من المخازن المسموح بها', 'forbidden');
  }

  async itemMovement(user: AuthUser, id: string, f: { from?: string; to?: string; warehouse_id?: string; doc_type?: string }) {
    this.warehouseRequired(user, f.warehouse_id);
    const r = await R.itemMovement(this.db, id, f);
    if (!can(user, 'costs.view')) r.moves.forEach((m: any) => (m.value = null));
    return r;
  }

  async warehouseStock(user: AuthUser, warehouseId: string | undefined, onlyNonZero: boolean) {
    this.warehouseRequired(user, warehouseId);
    const r = await R.warehouseStock(this.db, warehouseId || undefined, { onlyNonZero });
    if (!can(user, 'costs.view')) {
      r.rows.forEach((x: any) => (x.value = null));
      r.total_value = null as any;
    }
    return r;
  }

  async warehouseMovement(user: AuthUser, id: string, f: { from?: string; to?: string; item_id?: string }) {
    assertWarehouseScope(user, id);
    const result = await R.warehouseMovement(this.db, id, f);
    if (!can(user, 'costs.view')) result.moves.forEach((m: any) => (m.value = null));
    return result;
  }

  async documents(user: AuthUser, f: { from?: string; to?: string; types?: string; party_id?: string; user_id?: string; status?: string; warehouse_id?: string }) {
    const accessible = viewableDocTypes(user);
    const requested = f.types?.split(',').filter(Boolean);
    const docTypes = requested ? requested.filter((t) => accessible.includes(t)) : accessible;
    assertWarehouseScope(user, f.warehouse_id);
    const r = await R.documentsReport(this.db, {
      from: f.from, to: f.to, doc_types: docTypes, party_id: f.party_id, user_id: f.user_id, status: f.status, warehouse_id: f.warehouse_id,
      warehouse_ids: user.warehouse_ids, cashbox_ids: user.cashbox_ids,
    });
    if (!can(user, 'reports.profit')) {
      r.rows.forEach((x: any) => (x.cost = null));
      (r.totals as any).cost = null;
      (r.totals as any).profit = null;
    }
    return r;
  }

  /** تفاصيل مستند: صلاحية وحدته + نطاق المخازن والخزائن (حتى خزائن الدفعات) + فلترة المستندات المرتبطة بنفس القواعد */
  async documentDetail(user: AuthUser, id: string) {
    const target = await this.db.one(`select id, doc_type, warehouse_id, to_warehouse_id, cashbox_id, data from documents where id = $1`, [id]);
    if (!target) throw new AppError('المستند غير موجود', 'not_found');
    const permission = viewPermOf(target.doc_type);
    if (!permission || !hasPermission(user.permissions, permission)) throw new AppError('ليس لديك صلاحية عرض هذا المستند', 'forbidden');
    assertWarehouseScope(user, target.warehouse_id);
    assertWarehouseScope(user, target.to_warehouse_id);
    assertCashboxScope(user, target.cashbox_id);
    for (const payment of parseData(target.data).payments ?? []) assertCashboxScope(user, payment.cashbox_id);
    const r = await R.documentDetail(this.db, id);
    if (!can(user, 'costs.view')) {
      (r.doc as any).cost = null;
      r.lines.forEach((l: any) => (l.cost = null));
    }
    if (!can(user, 'accounts.view')) r.entries = [];
    if (!can(user, 'audit.view')) r.audit = [];
    const relatedRows = await this.db.query(`select id, doc_type, warehouse_id, to_warehouse_id, cashbox_id, data from documents where ref_doc_id = $1`, [id]);
    const inW = (w: string | null) => !w || !user.warehouse_ids || user.warehouse_ids.includes(w);
    const inC = (c: string | null) => !c || !user.cashbox_ids || user.cashbox_ids.includes(c);
    const allowed = new Set(
      relatedRows
        .filter((row: any) => {
          const p = viewPermOf(row.doc_type);
          if (!p || !hasPermission(user.permissions, p)) return false;
          if (!inW(row.warehouse_id) || !inW(row.to_warehouse_id) || !inC(row.cashbox_id)) return false;
          return (parseData(row.data).payments ?? []).every((payment: any) => !user.cashbox_ids || user.cashbox_ids.includes(payment.cashbox_id));
        })
        .map((row: any) => row.id),
    );
    r.related = r.related.filter((row: any) => allowed.has(row.id));
    return r;
  }

  /**
   * تعديل فاتورة شراء مرحّلة: المدفوعات المربوطة بيها وأقصى مبلغ ينفع يتخصص من كل واحدة على الفاتورة المعدّلة.
   * محتاج صلاحيات مشاهدة وتعديل وترحيل المشتريات، ونطاق المخزن والخزائن، وعرض الخزينة لو فيه مدفوعات.
   */
  async amendment(user: AuthUser, id: string) {
    const invoice = await this.db.one(`select id, doc_type, status, party_id, warehouse_id from documents where id = $1`, [id]);
    if (!invoice) throw new AppError('الفاتورة غير موجودة', 'not_found');
    if (invoice.doc_type !== 'purchase_invoice' || invoice.status !== 'posted') throw new AppError('تعديل الفاتورة متاح لفاتورة شراء مرحّلة فقط', 'state');
    if (!can(user, 'purchases.view') || !can(user, 'purchases.edit') || !can(user, 'purchases.post') || !can(user, 'purchases.cancel')) {
      throw new AppError('تحتاج إلى صلاحيات مشاهدة وتعديل وترحيل وإلغاء المشتريات', 'forbidden');
    }
    assertWarehouseScope(user, invoice.warehouse_id);
    const sources = await this.db.query(
      `select p.id as source_id, p.number, p.date, p.total, p.allocated, p.cashbox_id, c.name as cashbox_name,
              coalesce(sum(a.amount) filter (where a.invoice_id = $1 and not a.reversed), 0)::bigint as current_amount
         from documents p
         left join allocations a on a.source_id = p.id and not a.reversed
         left join cashboxes c on c.id = p.cashbox_id
        where p.doc_type = 'payment' and p.party_id = $2 and (p.ref_doc_id = $1 or a.invoice_id = $1)
        group by p.id, c.name
        order by p.date, p.created_at`,
      [id, invoice.party_id],
    );
    if (sources.length && !can(user, 'treasury.view')) throw new AppError('تعديل المدفوعات المرتبطة يحتاج صلاحية عرض الخزينة', 'forbidden');
    for (const source of sources) assertCashboxScope(user, source.cashbox_id);
    return {
      payment_allocations: sources.map((source: any) => {
        const current = Number(source.current_amount) || 0;
        const total = Number(source.total) || 0;
        const allocated = Number(source.allocated) || 0;
        return {
          source_id: source.source_id,
          number: source.number,
          date: source.date,
          total,
          current_amount: current,
          max_amount: Math.max(0, total - Math.max(0, allocated - current)),
          cashbox_name: source.cashbox_name,
        };
      }),
    };
  }

  async expiry(user: AuthUser, f: { warehouse_id?: string; until?: string }) {
    assertWarehouseScope(user, f.warehouse_id);
    const r = await R.expiryReport(this.db, { warehouse_id: f.warehouse_id, warehouse_ids: user.warehouse_ids, until: f.until });
    if (!can(user, 'costs.view')) r.rows.forEach((x: any) => (x.avg_cost = null));
    return r;
  }

  async salesAnalysis(user: AuthUser, f: { from?: string; to?: string; group?: string; kind?: string }) {
    const kind = f.kind === 'purchases' ? 'purchases' : 'sales';
    if (!can(user, `${kind}.view`)) throw new AppError('ليس لديك صلاحية عرض هذا التقرير', 'forbidden');
    const r = await R.salesAnalysis(this.db, { from: f.from, to: f.to, group: f.group ?? 'item', kind, warehouse_ids: user.warehouse_ids });
    if (!can(user, 'reports.profit')) r.rows.forEach((x: any) => ((x.cost = null), (x.profit = null)));
    return r;
  }

  treasuryAnalysis(user: AuthUser, f: { from?: string; to?: string; dir?: string; group?: string; cashbox_id?: string; user_id?: string; internal?: string }) {
    assertCashboxScope(user, f.cashbox_id);
    return R.treasuryAnalysis(this.db, {
      from: f.from, to: f.to, dir: f.dir === 'out' ? 'out' : 'in', group: f.group ?? 'item', cashbox_id: f.cashbox_id || undefined,
      cashbox_ids: user.cashbox_ids, user_id: f.user_id || undefined, internal: f.internal === '1',
    });
  }

  async daily(user: AuthUser, f: { from?: string; to?: string; user_id?: string }) {
    const r = await R.dailyMovement(this.db, { from: f.from, to: f.to, doc_types: viewableDocTypes(user), warehouse_ids: user.warehouse_ids, cashbox_ids: user.cashbox_ids, user_id: f.user_id || undefined });
    if (!can(user, 'treasury.view')) r.cashboxes = [];
    return r;
  }
}
