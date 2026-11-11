/** خطأ متوقع يُعرض للمستخدم ولا تُعاد محاولته */
export class AppError extends Error {
  constructor(
    message: string,
    public code: 'validation' | 'forbidden' | 'not_found' | 'state' | 'auth' = 'validation',
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * حالة تحتاج مراجعة بشرية بدل الرفض: مثل بيع كمية أكبر من الرصيد بعد مزامنة جهاز كان دون اتصال،
 * أو تجاوز الحد الائتماني. المستند يُحفظ بحالة «يحتاج مراجعة» ويُنشأ تعارض لمن لديه صلاحية حله.
 */
export class ReviewError extends Error {
  constructor(
    public kind: 'stock_shortage' | 'credit_limit',
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function pgErrorToApp(e: any): AppError | undefined {
  if (!e || typeof e !== 'object') return undefined;
  if (e.code === '23505') {
    const d = String(e.detail ?? e.message ?? '');
    if (d.includes('(code)') || d.includes('code')) return new AppError('الكود مستخدم من قبل');
    if (d.includes('barcode')) return new AppError('الباركود مستخدم لصنف آخر');
    if (d.includes('name')) return new AppError('الاسم مستخدم من قبل');
    return new AppError('قيمة مكررة: ' + d);
  }
  if (e.code === '23503') return new AppError('مرجع غير موجود (عنصر مرتبط غير موجود أو لم يُزامن بعد)');
  if (e.code === '23514') return new AppError('قيمة غير مسموح بها');
  return undefined;
}
