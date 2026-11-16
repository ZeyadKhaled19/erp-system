/**
 * توحيد الكتابة العربية للبحث والمقارنة: أ/إ/آ/ا، ة/ه، ى/ي، ؤ/و، ئ/ي، حذف التشكيل والتطويل،
 * والأرقام العربية تتحول لأرقام عادية، والمسافات الزائدة تُحذف.
 */
export function normalizeAr(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // التشكيل والتطويل (بدون الأرقام العربية ٠-٩)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** شكل الاسم للمقارنة: موحد عربيًا، وعلامات الترقيم مثل - / . ( ) تعامل كمسافة */
export function nameKey(s: string | null | undefined): string {
  return normalizeAr(String(s ?? '').replace(/[\-_.,،/\\()[\]{}|+*"'`:;!?#]+/g, ' '));
}

/** عدد التعديلات (إضافة/حذف/تغيير حرف) بين نصين، ويتوقف مبكرًا إذا تجاوز max */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // حرفان متجاوران مقلوبان يُحسبان خطأ واحدًا
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** أخطاء الكتابة تُقبل فقط في الكلمات الطويلة: «بلي» و«بلف» كلمتان مختلفتان، أما «كاربراتير» و«كربراتير» فخطأ إملائي */
function allowedEdits(len: number) {
  if (len < 5) return 0;
  if (len < 9) return 1;
  return 2;
}

const numbersOf = (k: string) => (k.match(/\d+/g) ?? []).join(',');
/** حذف «ال» من أول الكلمة: «الكاوتش الامامي» = «كاوتش امامي» */
const stripAl = (w: string) => (w.length > 4 && w.startsWith('ال') ? w.slice(2) : w);

export type NameMatch = 'exact' | 'similar';

/**
 * هل الاسمان متشابهان لدرجة أن يكونا نفس الصنف؟
 * - نفس الاسم بعد توحيد الحروف والمسافات وعلامات الترقيم → exact
 * - نفس الكلمات بترتيب مختلف أو بـ«ال» أو بدونها، أو خطأ إملائي في كلمة طويلة،
 *   أو أحدهما يحتوي الآخر ويغطي معظمه → similar
 * الأرقام تفرّق بين الأصناف: «كاوتش 10 بوصة» و«كاوتش 12 بوصة» ليسا متشابهين.
 */
export function compareNames(a: string | null | undefined, b: string | null | undefined): NameMatch | null {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return null;
  const sa = ka.replace(/ /g, '');
  const sb = kb.replace(/ /g, '');
  if (sa === sb) return 'exact';
  const na = numbersOf(ka);
  const nb = numbersOf(kb);
  if (na && nb && na !== nb) return null;
  const ta = ka.split(' ').map(stripAl);
  const tb = kb.split(' ').map(stripAl);
  if ([...ta].sort().join(' ') === [...tb].sort().join(' ')) return 'similar';
  // الأقصر جزء من الأطول ويغطي معظمه (مثل «فلتر زيت» و«فلتر زيتي»)
  const short = sa.length <= sb.length ? sa : sb;
  const long = sa.length <= sb.length ? sb : sa;
  if (short.length >= 4 && long.includes(short) && short.length / long.length >= 0.8) return 'similar';
  // خطأ إملائي في كلمة واحدة طويلة وباقي الكلمات كما هي
  if (ta.length === tb.length) {
    const diff = ta.map((w, i) => [w, tb[i]] as const).filter(([x, y]) => x !== y);
    if (diff.length === 1) {
      const [x, y] = diff[0];
      const max = allowedEdits(Math.min(x.length, y.length));
      if (max > 0 && editDistance(x, y, max) <= max) return 'similar';
    }
  }
  return null;
}

/**
 * الأصناف الموجودة التي يشبه اسمها الاسم الجديد (المطابق تمامًا أولًا).
 * exceptId: الصنف الجاري تعديله حتى لا يُقارن بنفسه.
 */
export function findSimilarNames<T extends { id: string; name: string }>(name: string, items: readonly T[], exceptId?: string | null, limit = 5): (T & { match: NameMatch })[] {
  if (!nameKey(name)) return [];
  const out: (T & { match: NameMatch })[] = [];
  for (const it of items) {
    if (it.id === exceptId) continue;
    const m = compareNames(name, it.name);
    if (m) out.push({ ...it, match: m });
  }
  out.sort((x, y) => (x.match === y.match ? 0 : x.match === 'exact' ? -1 : 1));
  return out.slice(0, limit);
}
