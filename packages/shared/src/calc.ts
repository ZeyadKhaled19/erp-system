import { applyBp, mulQtyPrice, mulDiv } from './money';

export interface LineInput {
  /** الكمية بالوحدة المختارة (milli) */
  qty: number;
  /** سعر الوحدة المختارة بالقرش */
  price: number;
  /** خصم السطر بالقرش */
  discount?: number;
  /** نسبة الضريبة بنقاط الأساس */
  tax_rate_bp?: number;
}

export interface LineResult {
  gross: number;
  line_discount: number;
  doc_discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface DocTotals {
  gross: number;
  discount: number;
  tax: number;
  total: number;
  lines: LineResult[];
}

/**
 * حساب المستند:
 * إجمالي السطر = الكمية × السعر
 * الصافي قبل الضريبة = الإجمالي − خصم السطر − نصيبه من خصم الفاتورة (يُوزّع بالتناسب)
 * الضريبة = الصافي × النسبة
 * الإجمالي = الصافي + الضريبة
 */
export function computeDocument(lines: LineInput[], docDiscount = 0): DocTotals {
  const prelim = lines.map((l) => {
    const gross = mulQtyPrice(l.qty, l.price);
    const line_discount = l.discount ?? 0;
    if (line_discount < 0) throw new Error('الخصم لا يكون سالبًا');
    if (line_discount > gross) throw new Error('خصم السطر أكبر من قيمته');
    return { gross, line_discount, net: gross - line_discount };
  });
  const netSum = prelim.reduce((s, l) => s + l.net, 0);
  if (docDiscount < 0) throw new Error('الخصم لا يكون سالبًا');
  if (docDiscount > netSum) throw new Error('خصم الفاتورة أكبر من صافيها');

  let remaining = docDiscount;
  const lastIdx = prelim.reduce((idx, l, i) => (l.net > 0 ? i : idx), -1);
  const results: LineResult[] = prelim.map((l, i) => {
    let doc_discount = 0;
    if (docDiscount > 0 && netSum > 0) {
      doc_discount = i === lastIdx ? remaining : mulDiv(docDiscount, l.net, netSum);
      doc_discount = Math.min(doc_discount, l.net, remaining);
      remaining -= doc_discount;
    }
    const taxable = l.net - doc_discount;
    const tax = applyBp(taxable, lines[i].tax_rate_bp ?? 0);
    return { gross: l.gross, line_discount: l.line_discount, doc_discount, taxable, tax, total: taxable + tax };
  });

  return {
    gross: results.reduce((s, l) => s + l.gross, 0),
    discount: results.reduce((s, l) => s + l.line_discount + l.doc_discount, 0),
    tax: results.reduce((s, l) => s + l.tax, 0),
    total: results.reduce((s, l) => s + l.total, 0),
    lines: results,
  };
}

/** توزيع مبلغ على حصص بنسب (نقاط أساس) مع ضمان أن المجموع يساوي المبلغ تمامًا */
export function allocateByBp(amount: number, shares: { key: string; bp: number }[]): Record<string, number> {
  const totalBp = shares.reduce((s, x) => s + x.bp, 0);
  if (totalBp <= 0) throw new Error('مجموع النسب صفر');
  const out: Record<string, number> = {};
  let used = 0;
  shares.forEach((s, i) => {
    const v = i === shares.length - 1 ? amount - used : mulDiv(amount, s.bp, totalBp);
    out[s.key] = v;
    used += v;
  });
  return out;
}
