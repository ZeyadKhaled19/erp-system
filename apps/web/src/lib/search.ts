/**
 * بحث ذكي عن الأصناف بالكلام: أي جزء من الكلمة، أكثر من كلمة بأي ترتيب،
 * ومع توحيد الحروف العربية (أ/إ/آ/ا، ة/ه، ى/ي، والتشكيل) حتى لا تفشل كتابة سريعة.
 */
export function normalizeAr(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // التشكيل والتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** يعيد درجة التطابق (أكبر = أقرب) أو -1 إذا لم يطابق */
export function matchScore(q: string, fields: (string | null | undefined)[]): number {
  const nq = normalizeAr(q);
  if (!nq) return 0;
  const hay = fields.map(normalizeAr);
  const all = hay.join(' ');
  const tokens = nq.split(' ');
  if (!tokens.every((t) => all.includes(t))) return -1;
  let score = 1;
  // تطابق كامل مع الكود أو الباركود أولًا، ثم بداية الاسم، ثم بداية أي كلمة
  if (hay.slice(1).some((h) => h === nq)) score += 100;
  if (hay[0]?.startsWith(nq)) score += 40;
  else if (hay[0]?.includes(nq)) score += 20;
  for (const t of tokens) if (all.split(' ').some((w) => w.startsWith(t))) score += 5;
  return score;
}

/** فلترة وترتيب قائمة أصناف حسب نص البحث (الاسم أولًا ثم الكود والباركود) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function searchItems<T extends Record<string, any>>(items: T[], q: string, extra?: (i: T) => (string | null | undefined)[]): T[] {
  if (!normalizeAr(q)) return items;
  return items
    .map((i) => ({ i, s: matchScore(q, [i.name, i.code, i.barcode, ...(extra ? extra(i) : [])]) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || String(a.i.name ?? '').localeCompare(String(b.i.name ?? ''), 'ar'))
    .map((x) => x.i);
}
