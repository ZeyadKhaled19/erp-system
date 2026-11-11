export * from './money';
export * from './calc';
export * from './permissions';
export * from './docs';
export * from './ops';

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export function todayISO(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
