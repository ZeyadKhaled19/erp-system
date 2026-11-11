/**
 * تفقيط المبالغ بالعربية (كتابة المبلغ بالحروف) للسندات والعقود.
 * مثال: 1250.50 ج.م → «فقط ألف ومائتان وخمسون جنيهًا مصريًا وخمسون قرشًا لا غير»
 */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const u = r % 10;
      const t = Math.floor(r / 10);
      parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

const SCALES: [number, string, string, string][] = [
  // [القيمة، المفرد، المثنى، الجمع (3-10)]
  [1_000_000_000, 'مليار', 'ملياران', 'مليارات'],
  [1_000_000, 'مليون', 'مليونان', 'ملايين'],
  [1_000, 'ألف', 'ألفان', 'آلاف'],
];

export function numberToArabicWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('رقم غير صالح');
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  let rest = n;
  for (const [value, one, two, plural] of SCALES) {
    const count = Math.floor(rest / value);
    rest %= value;
    if (!count) continue;
    if (count === 1) parts.push(one);
    else if (count === 2) parts.push(two);
    else if (count <= 10) parts.push(`${below1000(count)} ${plural}`);
    else parts.push(`${below1000(count)} ${one}`);
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' و');
}

/** المبلغ بالقرش → نص الجنيهات والقروش */
export function tafqeetEGP(piasters: number): string {
  const neg = piasters < 0;
  const abs = Math.abs(piasters);
  const pounds = Math.floor(abs / 100);
  const qirsh = abs % 100;
  const poundWord = (n: number) => (n === 1 ? 'جنيه مصري واحد' : n === 2 ? 'جنيهان مصريان' : n % 100 >= 3 && n % 100 <= 10 ? `${numberToArabicWords(n)} جنيهات مصرية` : `${numberToArabicWords(n)} جنيهًا مصريًا`);
  const qirshWord = (n: number) => (n === 1 ? 'قرش واحد' : n === 2 ? 'قرشان' : n >= 3 && n <= 10 ? `${numberToArabicWords(n)} قروش` : `${numberToArabicWords(n)} قرشًا`);
  let text = '';
  if (pounds && qirsh) text = `${poundWord(pounds)} و${qirshWord(qirsh)}`;
  else if (pounds) text = poundWord(pounds);
  else if (qirsh) text = qirshWord(qirsh);
  else text = 'صفر جنيه';
  return `فقط ${neg ? 'سالب ' : ''}${text} لا غير`;
}
