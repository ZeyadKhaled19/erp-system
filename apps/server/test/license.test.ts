import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expiryFor, licenseStatus, normalizeMachineId, signLicense, verifyLicense } from '../src/license';

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
