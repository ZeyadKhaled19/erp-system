import { describe, expect, it } from 'vitest';
import { compareNames, findSimilarNames, nameKey } from './names';

describe('nameKey', () => {
  it('unifies Arabic spelling, case, spaces and punctuation', () => {
    expect(nameKey('  أُسْطُوانة   فرامل ')).toBe('اسطوانه فرامل');
    expect(nameKey('إطار-خلفى')).toBe('اطار خلفي');
    expect(nameKey('Oil  FILTER')).toBe('oil filter');
    expect(nameKey('كاوتـــش ١٠')).toBe('كاوتش 10');
  });
});

describe('compareNames', () => {
  it('exact duplicates after normalising', () => {
    expect(compareNames('فلتر زيت', 'فلتر زيت')).toBe('exact');
    expect(compareNames('فلتر  زيت ', 'فلتر زيت')).toBe('exact');
    expect(compareNames('Oil Filter', 'oil filter')).toBe('exact');
    expect(compareNames('بطارية أمامية', 'بطاريه اماميه')).toBe('exact');
    expect(compareNames('مرآة يمين', 'مراه يمين')).toBe('exact');
    expect(compareNames('كشاف إضاءة', 'كشّاف اضاءة')).toBe('exact');
    expect(compareNames('فلترزيت', 'فلتر-زيت')).toBe('exact');
    expect(compareNames('كاوتش ١٠ بوصة', 'كاوتش 10 بوصه')).toBe('exact');
  });

  it('near matches', () => {
    expect(compareNames('زيت فلتر', 'فلتر زيت')).toBe('similar'); // نفس الكلمات بترتيب آخر
    expect(compareNames('الكاوتش الامامي', 'كاوتش امامي')).toBe('similar'); // «ال»
    expect(compareNames('فلتر زيت', 'فلتر زيتي')).toBe('similar'); // أحدهما يحتوي الآخر
    expect(compareNames('كاربراتير سكوتر', 'كربراتير سكوتر')).toBe('similar'); // خطأ إملائي
    expect(compareNames('بوجيه', 'بوجيا')).toBe('similar');
    expect(compareNames('Brake cable', 'Brake cabel')).toBe('similar');
  });

  it('different items stay different', () => {
    expect(compareNames('طقم بلي', 'طقم بلف')).toBeNull(); // كلمتان قصيرتان مختلفتان
    expect(compareNames('كاوتش 10 بوصة', 'كاوتش 12 بوصة')).toBeNull(); // الأرقام تفرّق
    expect(compareNames('زيت 1 لتر', 'زيت 4 لتر')).toBeNull();
    expect(compareNames('مساعد امامي', 'مساعد خلفي')).toBeNull();
    expect(compareNames('فلتر', 'فلتر زيت')).toBeNull(); // جزء صغير فقط من الاسم
    expect(compareNames('سلك', 'سلم')).toBeNull();
    expect(compareNames('', 'فلتر')).toBeNull();
  });
});

describe('findSimilarNames', () => {
  const items = [
    { id: '1', name: 'فلتر زيت', code: '1001' },
    { id: '2', name: 'فلتر زيتي', code: '1002' },
    { id: '3', name: 'مساعد خلفي', code: '1003' },
  ];
  it('lists matches with exact first', () => {
    const r = findSimilarNames('فلتر زيتى', items);
    expect(r.map((x) => x.id)).toEqual(['2', '1']);
    expect(r[0].match).toBe('exact');
  });
  it('does not compare an item with itself when editing', () => {
    expect(findSimilarNames('مساعد خلفي', items, '3')).toEqual([]);
    expect(findSimilarNames('مساعد خلفى', items).map((x) => x.id)).toEqual(['3']);
  });
  it('nothing for an empty name', () => {
    expect(findSimilarNames('   ', items)).toEqual([]);
  });
});
