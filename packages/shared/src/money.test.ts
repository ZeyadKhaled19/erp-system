import { describe, expect, it } from 'vitest';
import { allocateByBp, computeDocument } from './calc';
import { formatMoney, formatQty, mulQtyPrice, parseMoney, parseQty, toBaseQty } from './money';

describe('money', () => {
  it('parses decimals without floating point errors', () => {
    expect(parseMoney('0.1') + parseMoney('0.2')).toBe(30);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('١٢٫٥')).toBe(1250);
    expect(parseMoney('10.005')).toBe(1001);
    expect(parseQty('2.5')).toBe(2500);
    expect(parseMoney('-3.2')).toBe(-320);
  });
  it('multiplies qty × price with rounding', () => {
    expect(mulQtyPrice(parseQty('3'), parseMoney('19.99'))).toBe(5997);
    expect(mulQtyPrice(parseQty('0.333'), parseMoney('10'))).toBe(333);
    expect(toBaseQty(parseQty('2'), parseQty('12'))).toBe(24000);
  });
  it('formats', () => {
    expect(formatMoney(123456789)).toBe('1,234,567.89');
    expect(formatMoney(-50)).toBe('-0.50');
    // جنيه صحيح من غير قروش، والكسور بتفضل برقمين
    expect(formatMoney(150000)).toBe('1,500');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(-30000)).toBe('-300');
    expect(formatMoney(148920)).toBe('1,489.20');
    expect(formatMoney(148905)).toBe('1,489.05');
    expect(formatMoney(150000, { currency: true })).toBe('1,500 ج.م');
    expect(formatQty(2500)).toBe('2.5');
  });
});

describe('computeDocument', () => {
  it('computes lines, discounts and VAT', () => {
    const r = computeDocument(
      [
        { qty: 2000, price: 10000, discount: 0, tax_rate_bp: 1400 },
        { qty: 1000, price: 5000, discount: 500, tax_rate_bp: 1400 },
      ],
      1000,
    );
    // gross 200 + 50 = 250 ; discounts 5 + 10 = 15 ; taxable 235 ; tax 32.90
    expect(r.gross).toBe(25000);
    expect(r.discount).toBe(1500);
    expect(r.tax).toBe(3290);
    expect(r.total).toBe(23500 + 3290);
    expect(r.lines.reduce((s, l) => s + l.doc_discount, 0)).toBe(1000);
  });
  it('rejects discount larger than total', () => {
    expect(() => computeDocument([{ qty: 1000, price: 100 }], 200)).toThrow();
  });
  it('allocates exactly', () => {
    const a = allocateByBp(10000, [
      { key: 'a', bp: 3333 },
      { key: 'b', bp: 3333 },
      { key: 'c', bp: 3334 },
    ]);
    expect(a.a + a.b + a.c).toBe(10000);
  });
});
