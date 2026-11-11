import { describe, expect, it } from 'vitest';
import { numberToArabicWords, tafqeetEGP } from './tafqeet';

describe('tafqeet', () => {
  it('numbers', () => {
    expect(numberToArabicWords(5)).toBe('خمسة');
    expect(numberToArabicWords(11)).toBe('أحد عشر');
    expect(numberToArabicWords(25)).toBe('خمسة وعشرون');
    expect(numberToArabicWords(100)).toBe('مائة');
    expect(numberToArabicWords(250)).toBe('مائتان وخمسون');
    expect(numberToArabicWords(1250)).toBe('ألف ومائتان وخمسون');
    expect(numberToArabicWords(2000)).toBe('ألفان');
    expect(numberToArabicWords(3000)).toBe('ثلاثة آلاف');
    expect(numberToArabicWords(15000)).toBe('خمسة عشر ألف');
    expect(numberToArabicWords(2_500_000)).toBe('مليونان وخمسمائة ألف');
  });
  it('currency', () => {
    expect(tafqeetEGP(125050)).toBe('فقط ألف ومائتان وخمسون جنيهًا مصريًا وخمسون قرشًا لا غير');
    expect(tafqeetEGP(100)).toBe('فقط جنيه مصري واحد لا غير');
    expect(tafqeetEGP(500)).toBe('فقط خمسة جنيهات مصرية لا غير');
    expect(tafqeetEGP(25)).toBe('فقط خمسة وعشرون قرشًا لا غير');
  });
});
