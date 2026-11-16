import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expiryFor, extractCode, licenseStatus, normalizeMachineId, signLicense, signReset, verifyLicense, verifyReset } from '../src/license';

const kp = crypto.generateKeyPairSync('ed25519');
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const PUB = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const M = 'A1B2-C3D4-E5F6-0718';
const day = (s: string) => new Date(`${s}T10:00:00Z`);

describe('activation codes', () => {
  it('normalises machine ids', () => {
    expect(normalizeMachineId('a1b2c3d4 e5f6-0718')).toBe(M);
  });

  it('a code signed with our key works only on its own machine', () => {
    const code = signLicense(PRIV, { m: M, e: null, n: 'محل النور', t: '2026-11-16' });
    expect(code.startsWith('ECO1-')).toBe(true);
    const ok = verifyLicense(code, M.toLowerCase(), PUB);
    expect(ok.ok && ok.payload.n).toBe('محل النور');
    expect(verifyLicense(code, 'FFFF-FFFF-FFFF-FFFF', PUB)).toMatchObject({ ok: false });
    // كود متوقّع بمفتاح تاني، أو حد غيّر فيه حرف
    expect(verifyLicense(signLicense(other, { m: M, e: null, n: 'x', t: '2026-11-16' }), M, PUB)).toMatchObject({ ok: false, error: 'الكود ده مش سليم.' });
    const [head, sig] = code.split('.');
    const tampered = head.slice(0, -2) + (head.endsWith('A') ? 'B' : 'A') + head.slice(-1) + '.' + sig;
    expect(verifyLicense(tampered, M, PUB).ok).toBe(false);
    expect(verifyLicense('كلام', M, PUB).ok).toBe(false);
  });

  it('7-day trial, then locked; an activation code opens it; an expired subscription locks again', () => {
    const base = { machineId: M, trialStart: '2026-11-16T09:00:00Z' };
    expect(licenseStatus(base, day('2026-11-16'), PUB)).toMatchObject({ status: 'trial', daysLeft: 7 });
    expect(licenseStatus(base, day('2026-11-22'), PUB)).toMatchObject({ status: 'trial', daysLeft: 1 });
    expect(licenseStatus(base, day('2026-11-23'), PUB)).toMatchObject({ status: 'expired', reason: 'trial' });

    const year = signLicense(PRIV, { m: M, e: '2027-11-16', n: 'محل', t: '2026-11-23' });
    expect(licenseStatus({ ...base, code: year }, day('2026-11-23'), PUB)).toMatchObject({ status: 'active', expiresAt: '2027-11-16' });
    expect(licenseStatus({ ...base, code: year }, day('2027-11-17'), PUB)).toMatchObject({ status: 'expired', reason: 'license' });
    // كود لجهاز تاني ما يفتحش
    const wrong = signLicense(PRIV, { m: 'FFFF-FFFF-FFFF-FFFF', e: null, n: 'x', t: '2026-11-23' });
    expect(licenseStatus({ ...base, code: wrong }, day('2026-11-23'), PUB).status).toBe('expired');
  });

  it('turning the clock back locks it; machines from before licensing stay open', () => {
    expect(licenseStatus({ machineId: M, trialStart: '2026-11-16T09:00:00Z', lastSeen: '2026-11-30T09:00:00Z' }, day('2026-11-17'), PUB)).toMatchObject({ status: 'expired', reason: 'clock' });
    expect(licenseStatus({ machineId: M, trialStart: '2020-01-01T00:00:00Z', legacy: true }, day('2026-11-17'), PUB).status).toBe('active');
  });

  it('subscription end dates', () => {
    const from = day('2026-11-16');
    expect(expiryFor('month', 0, from)).toBe('2026-12-16');
    expect(expiryFor('year', 0, from)).toBe('2027-11-16');
    expect(expiryFor('days', 10, from)).toBe('2026-11-26');
    expect(expiryFor('life', 0, from)).toBeNull();
  });
});

describe('recovery codes (new username and password for a forgotten login)', () => {
  it('works only on its machine, only for 24 hours, and only if signed with our key', () => {
    const exp = '2026-11-17T10:00:00Z';
    const code = signReset(PRIV, { m: M, u: 'ahmed', h: 'scrypt$hash', x: exp });
    expect(code.startsWith('ECOR-')).toBe(true);
    const ok = verifyReset(code, M, new Date('2026-11-16T12:00:00Z'), PUB);
    expect(ok.ok && ok.payload).toMatchObject({ u: 'ahmed', h: 'scrypt$hash' });
    expect(verifyReset(code, 'FFFF-FFFF-FFFF-FFFF', new Date('2026-11-16T12:00:00Z'), PUB).ok).toBe(false);
    expect(verifyReset(code, M, new Date('2026-11-17T10:00:01Z'), PUB)).toMatchObject({ ok: false });
    expect(verifyReset(signReset(other, { m: M, u: 'x', h: 'y', x: exp }), M, new Date('2026-11-16T12:00:00Z'), PUB).ok).toBe(false);
    // كود تفعيل مش بينفع ككود استرجاع
    expect(verifyReset(signLicense(PRIV, { m: M, e: null, n: 'x', t: '2026-11-16' }), M, new Date('2026-11-16T12:00:00Z'), PUB).ok).toBe(false);
  });
});

describe('pasting the whole message', () => {
  it('finds the code inside the WhatsApp message (Arabic text, username and password around it, broken lines)', () => {
    const code = signReset(PRIV, { m: M, u: 'yasser', h: 'h', x: '2026-11-17T10:00:00Z' });
    const msg = `بيانات الدخول الجديدة لـ Eco System:\nاسم المستخدم: yasser\nكلمة السر: Reset-55\n\nفي شاشة الدخول دوس «نسيت» والصق الكود ده (شغال 24 ساعة):\n${code.slice(0, 40)}\n${code.slice(40)}`;
    expect(extractCode(msg, 'ECOR-')).toBe(code);
    expect(verifyReset(msg, M, new Date('2026-11-16T12:00:00Z'), PUB).ok).toBe(true);
    const lic = signLicense(PRIV, { m: M, e: null, n: 'محل', t: '2026-11-16' });
    expect(verifyLicense(`كود تفعيل Eco System لـ «محل»:\n${lic}\n\nافتح البرنامج`, M, PUB).ok).toBe(true);
  });
});
