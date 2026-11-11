import { z } from 'zod';

/**
 * كل كتابة في النظام عملية (Op) لها معرّف فريد opId.
 * الجهاز يحفظ العمليات في طابور محلي ويرسلها بالترتيب.
 * الخادم ينفذ كل عملية مرة واحدة فقط (idempotent) ويعيد نفس النتيجة إذا أعيد إرسالها.
 * معرفات الكيانات (عميل، صنف، مستند...) تولّد على الجهاز كـ UUID وتبقى هي نفسها مركزيًا،
 * فلا حاجة لاستبدال معرفات مؤقتة؛ رقم المستند الرسمي فقط يُعطى من الخادم عند القبول.
 */

const id = z.string().min(1).max(64);
const int = z.number().int();
const nonneg = int.min(0);

export const itemSchema = z.object({
  code: z.string().trim().min(1, 'كود الصنف مطلوب').max(50),
  name: z.string().trim().min(1, 'اسم الصنف مطلوب').max(200),
  barcode: z.string().trim().max(64).nullish(),
  category_id: id.nullish(),
  base_unit: z.string().trim().min(1).max(30).default('قطعة'),
  sale_price: nonneg.default(0),
  wholesale_price: nonneg.default(0),
  reorder_level: nonneg.default(0),
  tax_rate_bp: nonneg.max(10000).default(0),
  active: z.boolean().default(true),
  notes: z.string().max(1000).nullish(),
  units: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(30),
        factor: int.positive(),
        barcode: z.string().trim().max(64).nullish(),
        sale_price: nonneg.default(0),
        wholesale_price: nonneg.default(0),
        active: z.boolean().default(true),
      }),
    )
    .default([]),
});

export const partySchema = z.object({
  kind: z.enum(['customer', 'supplier']),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1, 'الاسم مطلوب').max(200),
  phone: z.string().trim().max(50).nullish(),
  address: z.string().trim().max(300).nullish(),
  tax_no: z.string().trim().max(50).nullish(),
  credit_limit: nonneg.default(0),
  price_list: z.enum(['retail', 'wholesale']).default('retail'),
  notes: z.string().max(1000).nullish(),
  active: z.boolean().default(true),
});

export const warehouseSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
});

export const cashboxSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['cash', 'bank']),
  active: z.boolean().default(true),
});

export const accountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  parent_id: id.nullish(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  is_group: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const MASTER_SCHEMAS = {
  item: itemSchema,
  party: partySchema,
  warehouse: warehouseSchema,
  category: categorySchema,
  cashbox: cashboxSchema,
  account: accountSchema,
} as const;
export type MasterEntity = keyof typeof MASTER_SCHEMAS;

export const docLineSchema = z.object({
  id,
  item_id: id,
  unit_name: z.string().min(1).max(30),
  unit_factor: int.positive(),
  qty: int,
  price: nonneg.default(0),
  discount: nonneg.default(0),
  tax_rate_bp: nonneg.max(10000).default(0),
  ref_line_id: id.nullish(),
  notes: z.string().max(300).nullish(),
});

export const journalLineSchema = z.object({
  account_id: id,
  party_id: id.nullish(),
  debit: nonneg.default(0),
  credit: nonneg.default(0),
  memo: z.string().max(300).nullish(),
});

export const docSchema = z.object({
  id,
  doc_type: z.enum([
    'sale_invoice', 'sale_return', 'purchase_invoice', 'purchase_return', 'receipt', 'payment', 'expense', 'income',
    'stock_transfer', 'stock_adjustment', 'opening_stock', 'party_opening', 'journal_voucher',
  ]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  party_id: id.nullish(),
  warehouse_id: id.nullish(),
  to_warehouse_id: id.nullish(),
  cashbox_id: id.nullish(),
  account_id: id.nullish(),
  payment_type: z.enum(['cash', 'credit']).nullish(),
  /** المبلغ المدفوع (فواتير) أو مبلغ السند */
  paid: nonneg.default(0),
  amount: nonneg.default(0),
  discount: nonneg.default(0),
  ref_doc_id: id.nullish(),
  /** للرصيد الافتتاحي للطرف: مدين = له علينا/عليه لنا */
  side: z.enum(['debit', 'credit']).nullish(),
  notes: z.string().max(1000).nullish(),
  local_number: z.string().max(40).nullish(),
  lines: z.array(docLineSchema).default([]),
  journal_lines: z.array(journalLineSchema).default([]),
});
export type DocInput = z.infer<typeof docSchema>;

export const opSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('master.upsert'),
    entity: z.enum(['item', 'party', 'warehouse', 'category', 'cashbox', 'account']),
    id,
    /** النسخة التي عدّل عليها الجهاز؛ null = إنشاء جديد */
    base_version: int.nullable(),
    data: z.record(z.any()),
  }),
  z.object({ type: z.literal('doc.save'), action: z.enum(['draft', 'post']), base_version: int.nullable(), doc: docSchema }),
  z.object({ type: z.literal('doc.post'), id, base_version: int.nullable() }),
  z.object({ type: z.literal('doc.cancel'), id, reason: z.string().trim().min(3, 'سبب الإلغاء مطلوب').max(500) }),
  z.object({
    type: z.literal('conflict.resolve'),
    id,
    resolution: z.enum(['keep_server', 'apply_client', 'post_anyway', 'discard']),
    note: z.string().max(500).nullish(),
  }),
]);

export const opEnvelopeSchema = z.object({
  op_id: z.string().uuid(),
  /** ترتيب العملية على الجهاز */
  seq: int.nonnegative(),
  created_at: z.string(),
  op: opSchema,
});
export type Op = z.infer<typeof opSchema>;
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export type OpStatus = 'accepted' | 'rejected' | 'conflict';
export interface OpResult {
  op_id: string;
  status: OpStatus;
  /** رسالة للمستخدم */
  message?: string;
  /** بيانات إضافية مثل رقم المستند المركزي */
  result?: Record<string, unknown>;
  /** خطأ مؤقت (شبكة/خادم) يجب إعادة المحاولة */
  retry?: boolean;
}

/** الجداول التي تُسحب للجهاز */
export const SYNC_TABLES = [
  'settings',
  'roles',
  'users',
  'accounts',
  'warehouses',
  'categories',
  'items',
  'item_units',
  'stock_balances',
  'parties',
  'cashboxes',
  'documents',
  'document_lines',
  'sync_conflicts',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
