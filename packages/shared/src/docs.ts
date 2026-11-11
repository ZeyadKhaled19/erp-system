/** أنواع المستندات وخصائصها */
export type DocType =
  | 'sale_invoice'
  | 'sale_return'
  | 'purchase_invoice'
  | 'purchase_return'
  | 'receipt'
  | 'payment'
  | 'expense'
  | 'income'
  | 'stock_transfer'
  | 'stock_adjustment'
  | 'opening_stock'
  | 'party_opening'
  | 'journal_voucher'
  | 'cash_transfer'
  | 'quotation'
  | 'partner_capital'
  | 'partner_withdrawal'
  | 'profit_distribution';

export interface DocTypeInfo {
  label: string;
  module: 'sales' | 'purchases' | 'treasury' | 'inventory' | 'accounts' | 'partners';
  /** مستند لا يُرحّل محاسبيًا (عرض الأسعار) */
  noPosting?: boolean;
  prefix: string;
  hasLines: boolean;
  /** يحتاج طرف (عميل/مورد) */
  partyKind?: 'customer' | 'supplier' | 'any';
  /** مستند مخزني يحرك الكميات */
  stock?: 'out' | 'in' | 'transfer' | 'adjust';
  /** مستند يحتوي أسعار بيع/شراء وضرائب */
  priced?: boolean;
  refType?: DocType;
}

export const DOC_TYPES: Record<DocType, DocTypeInfo> = {
  sale_invoice: { label: 'فاتورة بيع', module: 'sales', prefix: 'S', hasLines: true, partyKind: 'customer', stock: 'out', priced: true },
  sale_return: { label: 'مرتجع بيع', module: 'sales', prefix: 'SR', hasLines: true, partyKind: 'customer', stock: 'in', priced: true, refType: 'sale_invoice' },
  purchase_invoice: { label: 'فاتورة شراء', module: 'purchases', prefix: 'P', hasLines: true, partyKind: 'supplier', stock: 'in', priced: true },
  purchase_return: { label: 'مرتجع شراء', module: 'purchases', prefix: 'PR', hasLines: true, partyKind: 'supplier', stock: 'out', priced: true, refType: 'purchase_invoice' },
  receipt: { label: 'سند قبض', module: 'treasury', prefix: 'RC', hasLines: false, partyKind: 'any' },
  payment: { label: 'سند صرف', module: 'treasury', prefix: 'PY', hasLines: false, partyKind: 'any' },
  expense: { label: 'مصروف', module: 'treasury', prefix: 'EX', hasLines: false },
  income: { label: 'إيراد', module: 'treasury', prefix: 'IN', hasLines: false },
  stock_transfer: { label: 'تحويل مخزني', module: 'inventory', prefix: 'TR', hasLines: true, stock: 'transfer' },
  stock_adjustment: { label: 'جرد وتسوية', module: 'inventory', prefix: 'AD', hasLines: true, stock: 'adjust' },
  opening_stock: { label: 'بضاعة أول المدة', module: 'inventory', prefix: 'OS', hasLines: true, stock: 'in' },
  party_opening: { label: 'رصيد افتتاحي لطرف', module: 'accounts', prefix: 'OB', hasLines: false, partyKind: 'any' },
  journal_voucher: { label: 'قيد يومية', module: 'accounts', prefix: 'JV', hasLines: false },
  cash_transfer: { label: 'تحويل بين الخزائن', module: 'treasury', prefix: 'CT', hasLines: false },
  quotation: { label: 'عرض أسعار', module: 'sales', prefix: 'Q', hasLines: true, partyKind: 'customer', priced: true, noPosting: true },
  partner_capital: { label: 'إيداع رأس مال شريك', module: 'partners', prefix: 'PC', hasLines: false },
  partner_withdrawal: { label: 'مسحوبات شريك', module: 'partners', prefix: 'PW', hasLines: false },
  profit_distribution: { label: 'توزيع أرباح', module: 'partners', prefix: 'PD', hasLines: false },
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: 'مسودة',
  posted: 'مُرحّل',
  cancelled: 'ملغي',
  pending_review: 'يحتاج مراجعة',
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

/** الأرقام النظامية للحسابات الأساسية التي يعتمد عليها الترحيل الآلي */
export type SystemAccount =
  | 'cash_group'
  | 'bank_group'
  | 'ar'
  | 'inventory'
  | 'vat_input'
  | 'ap'
  | 'vat_output'
  | 'partners_current'
  | 'capital'
  | 'retained'
  | 'opening_equity'
  | 'sales'
  | 'sales_returns'
  | 'sales_discount'
  | 'other_income'
  | 'cogs'
  | 'inventory_diff'
  | 'cost_variance'
  | 'expenses_group'
  | 'notes_receivable'
  | 'notes_payable'
  | 'payment_fees'
  | 'cash_over_short'
  | 'partners_capital_group'
  | 'partners_current_group'
  | 'profit_distribution';
