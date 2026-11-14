import { beforeAll, describe, expect, it } from 'vitest';
import { doc, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;
const E1 = 'emp-1';
const E2 = 'emp-2';

const employee = (id: string, name: string, salary: number) => ({ type: 'master.upsert' as const, entity: 'employee' as const, id, base_version: null, data: { name, job_title: 'كاشير', salary } });

describe('قسم الموظفين', () => {
  beforeAll(async () => {
    env = await setup();
    A = await env.login();
    const rs = await A.push([A.envelope(employee(E1, 'أحمد سعيد', 600000)), A.envelope(employee(E2, 'محمد علي', 450000))]);
    expect(rs.map((r) => r.status)).toEqual(['accepted', 'accepted']);
  });

  it('كل موظف له حساب سلف فرعي تحت «سلف الموظفين»', async () => {
    const e = await env.db.one(`select e.*, a.name as acc_name, p.system_key as parent_key from employees e join accounts a on a.id = e.advance_account_id join accounts p on p.id = a.parent_id where e.id = $1`, [E1]);
    expect(e.acc_name).toBe('سلف أحمد سعيد');
    expect(e.parent_key).toBe('employee_advances_group');
  });

  it('الحضور: سجل واحد لكل موظف في اليوم (التعديل يحدّث نفس السجل)', async () => {
    const att = (status: string, base: number | null) => ({ type: 'master.upsert' as const, entity: 'attendance' as const, id: `${E1}:2026-11-03`, base_version: base, data: { employee_id: E1, date: '2026-11-03', status } });
    expect((await A.op(att('absent', null))).status).toBe('accepted');
    expect((await A.op(att('present', 1))).status).toBe('accepted');
    const other = await A.op({ type: 'master.upsert', entity: 'attendance', id: 'another-id', base_version: null, data: { employee_id: E1, date: '2026-11-03', status: 'late' } });
    expect(other.status).not.toBe('accepted');
    const rows = await env.db.query(`select * from attendance where employee_id = $1 and date = '2026-11-03'`, [E1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('present');
  });

  it('السلفة: تُصرف من الخزينة وتزيد رصيد سلف الموظف', async () => {
    const before = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    const r = await A.op(doc({ doc_type: 'employee_advance', employee_id: E1, cashbox_id: 'cb-main', amount: 100000 }));
    expect(r.status).toBe('accepted');
    const e = await env.db.one(`select advance_balance from employees where id = $1`, [E1]);
    expect(Number(e.advance_balance)).toBe(100000);
    const after = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    expect(Number(after.balance)).toBe(Number(before.balance) - 100000);
  });

  it('المسير: يخصم الغياب والسلفة ويرحّل الرواتب والقيد متوازن', async () => {
    const before = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    const r = await A.op(doc({
      doc_type: 'payroll', date: '2026-11-30', cashbox_id: 'cb-main', period_from: '2026-11-01', period_to: '2026-11-30',
      payroll_rows: [
        { employee_id: E1, salary: 600000, absent_days: 1, absence_deduction: 20000, bonus: 0, other_deduction: 0, advance_deduction: 50000 },
        { employee_id: E2, salary: 450000, absent_days: 0, absence_deduction: 0, bonus: 10000, other_deduction: 0, advance_deduction: 0 },
      ],
    }));
    expect(r.status).toBe('accepted');
    const d = await env.db.one(`select * from documents where id = $1`, [r.result.id]);
    // 600000 − 20000 − 50000 + 450000 + 10000
    expect(Number(d.total)).toBe(990000);
    const e = await env.db.one(`select advance_balance from employees where id = $1`, [E1]);
    expect(Number(e.advance_balance)).toBe(50000);
    const after = await env.db.one(`select balance from cashboxes where id = 'cb-main'`);
    expect(Number(after.balance)).toBe(Number(before.balance) - 990000);
    const j = await env.db.one(`select sum(debit)::bigint as dr, sum(credit)::bigint as cr from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = $1`, [r.result.id]);
    expect(Number(j.dr)).toBe(Number(j.cr));
    const sal = await env.db.one(`select sum(l.debit)::bigint as v from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where e.document_id = $1 and a.system_key = 'salaries'`, [r.result.id]);
    expect(Number(sal.v)).toBe(1040000);
  });

  it('المسير: لا يُكرر لنفس الشهر، ولا يخصم سلفة أكبر من الرصيد', async () => {
    const dup = await A.op(doc({ doc_type: 'payroll', date: '2026-11-30', cashbox_id: 'cb-main', period_from: '2026-11-01', period_to: '2026-11-30', payroll_rows: [{ employee_id: E2, salary: 450000 }] }));
    expect(dup.status).not.toBe('accepted');
    const big = await A.op(doc({ doc_type: 'payroll', date: '2026-12-31', cashbox_id: 'cb-main', period_from: '2026-12-01', period_to: '2026-12-31', payroll_rows: [{ employee_id: E1, salary: 600000, advance_deduction: 90000 }] }));
    expect(big.status).not.toBe('accepted');
  });

  it('صلاحية: من لا يملك صلاحيات الموظفين لا يضيف موظفًا', async () => {
    await env.db.query(`insert into roles (id, name, permissions) values ('role-nohr', 'بلا موظفين', '["sales.view"]')`);
    const { hashPassword } = await import('../src/auth');
    await env.db.query(`insert into users (id, username, full_name, password_hash, role_id) values ('u-nohr', 'nohr', 'بلا موظفين', $1, 'role-nohr')`, [await hashPassword('pass1234')]);
    const B = await env.login('nohr', 'pass1234', 'device-B-0001');
    const r = await B.op(employee('emp-x', 'ممنوع', 1000));
    expect(r.status).not.toBe('accepted');
  });
});
