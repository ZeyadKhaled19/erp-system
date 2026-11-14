/**
 * الدقة المالية:
 * - المبالغ تُخزّن كأعداد صحيحة بالقرش (1 جنيه = 100 قرش). لا نستخدم أرقام عشرية floating point.
 * - الكميات ومعاملات تحويل الوحدات تُخزّن كأعداد صحيحة بالجزء من الألف (milli): 1.5 = 1500.
 * - النسب (الضريبة/العمولة) بنقاط الأساس basis points: 14% = 1400.
 * - العمليات الوسيطة تتم بـ BigInt ثم تُقرّب لأقرب وحدة (تقريب نصف لأعلى بعيدًا عن الصفر).
 */

export const MONEY_SCALE = 100;
export const QTY_SCALE = 1000;
export const BP_SCALE = 10000;

/** قسمة BigInt مع تقريب النصف بعيدًا عن الصفر */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('division by zero');
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an + ad / 2n) / ad;
  return neg ? -q : q;
}

function toSafe(b: bigint): number {
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('المبلغ أكبر من الحد المسموح');
  }
  return Number(b);
}

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} يجب أن يكون عددًا صحيحًا`);
}

/** قيمة = الكمية (milli) × السعر (قرش) ÷ 1000 */
export function mulQtyPrice(qtyMilli: number, price: number): number {
  assertInt(qtyMilli, 'الكمية');
  assertInt(price, 'السعر');
  return toSafe(divRound(BigInt(qtyMilli) * BigInt(price), BigInt(QTY_SCALE)));
}

/** نسبة من مبلغ بنقاط الأساس */
export function applyBp(amount: number, bp: number): number {
  assertInt(amount, 'المبلغ');
  assertInt(bp, 'النسبة');
  return toSafe(divRound(BigInt(amount) * BigInt(bp), BigInt(BP_SCALE)));
}

/** a × b ÷ c بتقريب */
export function mulDiv(a: number, b: number, c: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(c, 'c');
  return toSafe(divRound(BigInt(a) * BigInt(b), BigInt(c)));
}

/** تحويل كمية بوحدة فرعية إلى الوحدة الأساسية: qty(milli) × factor(milli) ÷ 1000 */
export function toBaseQty(qtyMilli: number, factorMilli: number): number {
  return mulDiv(qtyMilli, factorMilli, QTY_SCALE);
}

/** تحويل نص عشري إلى عدد صحيح بمقياس معين، بدون floating point */
export function parseScaled(input: string | number, scale: number): number {
  let s = String(input).trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  s = s.replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  if (!/^-?\d*(\.\d*)?$/.test(s)) throw new Error(`قيمة غير صالحة: ${input}`);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [intPart = '0', fracPart = ''] = s.split('.');
  const digits = Math.round(Math.log10(scale));
  const frac = (fracPart + '0'.repeat(digits)).slice(0, digits);
  const rest = fracPart.slice(digits);
  let v = BigInt(intPart || '0') * BigInt(scale) + BigInt(frac || '0');
  if (rest.length && Number(rest[0]) >= 5) v += 1n;
  return toSafe(neg ? -v : v);
}

export const parseMoney = (v: string | number) => parseScaled(v, MONEY_SCALE);
export const parseQty = (v: string | number) => parseScaled(v, QTY_SCALE);
export const parsePercentBp = (v: string | number) => parseScaled(v, 100);

/** عرض عدد صحيح بمقياس كنص عشري (بدون floating point) */
export function scaledToString(v: number, scale: number, minFrac = 0): string {
  const digits = Math.round(Math.log10(scale));
  const neg = v < 0;
  const abs = BigInt(Math.abs(v));
  const intPart = abs / BigInt(scale);
  let frac = (abs % BigInt(scale)).toString().padStart(digits, '0');
  while (frac.length > minFrac && frac.endsWith('0')) frac = frac.slice(0, -1);
  return (neg ? '-' : '') + intPart.toString() + (frac ? '.' + frac : '');
}

const groupInt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatMoney(piasters: number, opts: { currency?: boolean } = {}): string {
  if (piasters === null || piasters === undefined) piasters = 0;
  if (!Number.isSafeInteger(piasters)) return '—';
  const s = scaledToString(piasters, MONEY_SCALE, 2);
  const neg = s.startsWith('-');
  const [i, f] = (neg ? s.slice(1) : s).split('.');
  // من غير قروش لما المبلغ جنيه صحيح (1,500 مش 1,500.00)؛ لو فيه قروش فعلًا بتظهر برقمين (1,489.20)
  const out = (neg ? '-' : '') + groupInt(i) + (f && f !== '00' ? '.' + f.padEnd(2, '0') : '');
  return opts.currency ? `${out} ج.م` : out;
}

export function formatQty(milli: number): string {
  if (milli === null || milli === undefined) milli = 0;
  if (!Number.isSafeInteger(milli)) return '—';
  const s = scaledToString(milli, QTY_SCALE, 0);
  const neg = s.startsWith('-');
  const [i, f] = (neg ? s.slice(1) : s).split('.');
  return (neg ? '-' : '') + groupInt(i) + (f ? '.' + f : '');
}

export const moneyInput = (p: number) => scaledToString(p ?? 0, MONEY_SCALE, 0);
export const qtyInput = (q: number) => scaledToString(q ?? 0, QTY_SCALE, 0);
export const bpToPercent = (bp: number) => scaledToString(bp ?? 0, 100, 0);
