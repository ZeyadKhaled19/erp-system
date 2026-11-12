/**
 * طريقة الدفع الفعلية لمستند من مدفوعاته: الخزينة النقدية تظهر «نقدي»،
 * والخزائن البنكية/المحافظ تظهر باسمها (Visa، instapay، فودافون كاش…)، والباقي «آجل».
 * عرض فقط: لا يغير أي قيمة.
 */
export interface PayPart {
  id: string;
  name: string;
  amount: number;
  kind: 'cash' | 'bank' | string;
}

export function payParts(doc: any, cbs: Map<string, any>): PayPart[] {
  const raw: any[] = doc?.data?.payments ?? [];
  const parts = raw
    .filter((p) => p && p.amount > 0)
    .map((p) => {
      const cb = cbs.get(p.cashbox_id);
      return { id: p.cashbox_id, name: cb?.kind === 'cash' ? 'نقدي' : cb?.name ?? 'خزينة', amount: p.amount, kind: cb?.kind ?? 'cash' };
    });
  if (!parts.length && doc?.cashbox_id && (doc.paid ?? 0) > 0 && ['sale_invoice', 'purchase_invoice', 'sale_return', 'purchase_return'].includes(doc.doc_type)) {
    const cb = cbs.get(doc.cashbox_id);
    parts.push({ id: doc.cashbox_id, name: cb?.kind === 'cash' ? 'نقدي' : cb?.name ?? 'خزينة', amount: doc.paid, kind: cb?.kind ?? 'cash' });
  }
  // دمج نفس الطريقة لو تكررت
  const merged = new Map<string, PayPart>();
  for (const p of parts) {
    const k = p.kind === 'cash' ? 'cash' : p.id;
    const cur = merged.get(k);
    merged.set(k, cur ? { ...cur, amount: cur.amount + p.amount } : p);
  }
  return [...merged.values()];
}

/** المتبقي آجل على فاتورة بيع/شراء (0 لغيرها) */
export function creditPart(doc: any): number {
  if (!['sale_invoice', 'purchase_invoice'].includes(doc?.doc_type) || doc.status === 'cancelled') return 0;
  return Math.max(0, (doc.total ?? 0) - (doc.paid ?? 0));
}

export function payMethodLabel(doc: any, cbs: Map<string, any>): string {
  const parts = payParts(doc, cbs);
  const names = parts.map((p) => p.name);
  if (creditPart(doc) > 0) names.push('آجل');
  return names.length ? names.join(' + ') : '—';
}
