import type { SystemAccount } from '@erp/shared';
import type { Db } from '../db';
import { AppError } from '../errors';

export async function sysAccount(t: Db, key: SystemAccount): Promise<string> {
  const r = await t.one<{ id: string }>(`select id from accounts where system_key = $1`, [key]);
  if (!r) throw new AppError(`الحساب النظامي ${key} غير موجود في دليل الحسابات`, 'state');
  return r.id;
}

export async function getSettings(t: Db): Promise<Record<string, any>> {
  const rows = await t.query<{ key: string; value: any }>(`select key, value from settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export interface JLine {
  account_id: string;
  party_id?: string | null;
  debit: number;
  credit: number;
  memo?: string | null;
}

/**
 * كتابة قيد يومية مزدوج: يُرفض أي قيد غير متوازن.
 * يحدّث أرصدة الأطراف (العملاء/الموردين) والخزائن المرتبطة في نفس المعاملة.
 */
export async function writeJournal(
  t: Db,
  e: { date: string; document_id?: string | null; memo?: string | null; lines: JLine[]; created_by?: string | null; reverses_id?: string | null },
): Promise<string | null> {
  const lines = e.lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) {
      throw new AppError('مبلغ غير صالح في القيد');
    }
    if (l.debit > 0 && l.credit > 0) throw new AppError('السطر الواحد لا يكون مدينًا ودائنًا معًا');
  }
  if (!lines.length) return null;
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr) throw new AppError(`القيد غير متوازن: مدين ${dr / 100} ≠ دائن ${cr / 100}`);

  const accIds = [...new Set(lines.map((l) => l.account_id))];
  const accs = await t.query(`select id, is_group, active, system_key from accounts where id = any($1)`, [accIds]);
  const accMap = new Map(accs.map((a) => [a.id, a]));
  for (const id of accIds) {
    const a = accMap.get(id);
    if (!a) throw new AppError('حساب غير موجود في القيد');
    if (a.is_group) throw new AppError('لا يمكن الترحيل على حساب رئيسي (تجميعي)');
  }

  const id = crypto.randomUUID();
  await t.query(
    `insert into journal_entries (id, date, document_id, memo, created_by, reverses_id) values ($1,$2,$3,$4,$5,$6)`,
    [id, e.date, e.document_id ?? null, e.memo ?? null, e.created_by ?? null, e.reverses_id ?? null],
  );
  for (const l of lines) {
    await t.query(`insert into journal_lines (entry_id, account_id, party_id, debit, credit, memo) values ($1,$2,$3,$4,$5,$6)`, [
      id,
      l.account_id,
      l.party_id ?? null,
      l.debit,
      l.credit,
      l.memo ?? null,
    ]);
    if (l.party_id) {
      await t.query(
        `update parties set balance = balance + case when kind = 'customer' then $2::bigint - $3::bigint else $3::bigint - $2::bigint end where id = $1`,
        [l.party_id, l.debit, l.credit],
      );
    }
    await t.query(`update cashboxes set balance = balance + $2::bigint - $3::bigint where account_id = $1`, [l.account_id, l.debit, l.credit]);
  }
  return id;
}

/** عكس كل القيود غير المعكوسة لمستند (عند الإلغاء) مع الاحتفاظ بالأصل */
export async function reverseDocumentJournals(t: Db, documentId: string, date: string, userId: string, memo: string) {
  const entries = await t.query(`select id from journal_entries where document_id = $1 and reversed_by_id is null and reverses_id is null`, [documentId]);
  for (const en of entries) {
    const lines = await t.query(`select account_id, party_id, debit, credit, memo from journal_lines where entry_id = $1`, [en.id]);
    const revId = await writeJournal(t, {
      date,
      document_id: documentId,
      memo,
      created_by: userId,
      reverses_id: en.id,
      lines: lines.map((l) => ({ account_id: l.account_id, party_id: l.party_id, debit: l.credit, credit: l.debit, memo: l.memo })),
    });
    await t.query(`update journal_entries set reversed_by_id = $2 where id = $1`, [en.id, revId]);
  }
}
