import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/migrations.bundle';
import { setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;

const up = (entity: 'employee' | 'department' | 'job_title', id: string, data: any, base: number | null = null) =>
  A.op({ type: 'master.upsert', entity, id, base_version: base, data });

describe('الهيكل التنظيمي', () => {
  beforeAll(async () => {
    env = await setup();
    A = await env.login();
  });

  it('الإدارات: إدارة أم وأقسام تحتها، ومفيش دوائر', async () => {
    expect((await up('department', 'd-ops', { name: 'التشغيل' })).status).toBe('accepted');
    expect((await up('department', 'd-sales', { name: 'المبيعات', parent_id: 'd-ops' })).status).toBe('accepted');
    expect((await up('department', 'd-store', { name: 'المخازن', parent_id: 'd-sales' })).status).toBe('accepted');
    // التشغيل تحت المخازن = دايرة
    expect((await up('department', 'd-ops', { name: 'التشغيل', parent_id: 'd-store' }, 1)).status).not.toBe('accepted');
    expect((await up('department', 'd-ops', { name: 'التشغيل', parent_id: 'd-ops' }, 1)).status).not.toBe('accepted');
    expect((await up('department', 'd-x', { name: 'مجهولة', parent_id: 'no-such' })).status).not.toBe('accepted');
    const d = await env.db.one(`select parent_id from departments where id = 'd-ops'`);
    expect(d.parent_id).toBeNull();
  });

  it('الوظائف: قائمة بدون تكرار، وتغيير الاسم يتنقل للموظفين', async () => {
    expect((await up('job_title', 'jt-cashier', { name: 'كاشير' })).status).toBe('accepted');
    expect((await up('job_title', 'jt-dup', { name: ' كاشير ' })).status).not.toBe('accepted');
    expect((await up('employee', 'e-boss', { name: 'مدير المبيعات', salary: 900000, department_id: 'd-sales' })).status).toBe('accepted');
    expect((await up('employee', 'e-1', { name: 'كاشير أول', salary: 400000, department_id: 'd-sales', job_title_id: 'jt-cashier', manager_id: 'e-boss' })).status).toBe('accepted');
    let e = await env.db.one(`select job_title, job_title_id, department_id, manager_id from employees where id = 'e-1'`);
    expect(e).toMatchObject({ job_title: 'كاشير', job_title_id: 'jt-cashier', department_id: 'd-sales', manager_id: 'e-boss' });
    expect((await up('job_title', 'jt-cashier', { name: 'كاشير مبيعات' }, 1)).status).toBe('accepted');
    e = await env.db.one(`select job_title from employees where id = 'e-1'`);
    expect(e.job_title).toBe('كاشير مبيعات');
  });

  it('المدير المباشر: مش لنفسه، ومش واحد من اللي تحته', async () => {
    expect((await up('employee', 'e-boss', { name: 'مدير المبيعات', salary: 900000, manager_id: 'e-boss' }, 1)).status).not.toBe('accepted');
    expect((await up('employee', 'e-boss', { name: 'مدير المبيعات', salary: 900000, manager_id: 'e-1' }, 1)).status).not.toBe('accepted');
    expect((await up('employee', 'e-2', { name: 'تالت', salary: 1, manager_id: 'nobody' })).status).not.toBe('accepted');
    expect((await up('employee', 'e-2', { name: 'تالت', salary: 1, department_id: 'nowhere' })).status).not.toBe('accepted');
    expect((await up('employee', 'e-2', { name: 'تالت', salary: 1, job_title_id: 'no-title' })).status).not.toBe('accepted');
  });

  it('مدير الإدارة، وإيقاف إدارة فيها موظفين نشطين ممنوع', async () => {
    expect((await up('department', 'd-sales', { name: 'المبيعات', parent_id: 'd-ops', manager_id: 'e-boss' }, 1)).status).toBe('accepted');
    expect((await up('department', 'd-sales', { name: 'المبيعات', parent_id: 'd-ops', manager_id: 'e-boss', active: false }, 2)).status).not.toBe('accepted');
    expect((await up('department', 'd-ops', { name: 'التشغيل', active: false }, 1)).status).not.toBe('accepted');
    expect((await up('department', 'd-y', { name: 'فاضية', manager_id: 'nobody' })).status).not.toBe('accepted');
  });

  it('جهاز قديم بيبعت الموظف من غير حقول الهيكل ما بيمسحهاش', async () => {
    expect((await up('employee', 'e-1', { name: 'كاشير أول', salary: 450000 }, 1)).status).toBe('accepted');
    const e = await env.db.one(`select salary, department_id, job_title_id, manager_id from employees where id = 'e-1'`);
    expect(Number(e.salary)).toBe(450000);
    expect(e).toMatchObject({ department_id: 'd-sales', job_title_id: 'jt-cashier', manager_id: 'e-boss' });
  });

  it('الإدارات والوظائف بتتسحب للأجهزة، والنسخة الاحتياطية فيها الموظفين', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/sync/pull?cursor=0', headers: A.headers });
    const body = r.json();
    expect(body.changes.departments?.map((d: any) => d.id)).toEqual(expect.arrayContaining(['d-ops', 'd-sales', 'd-store']));
    expect(body.changes.job_titles?.map((d: any) => d.id)).toContain('jt-cashier');
    const { BACKUP_TABLES } = await import('../src/backup');
    const names = BACKUP_TABLES.map((t) => t.name);
    for (const t of ['departments', 'job_titles', 'employees', 'attendance']) expect(names).toContain(t);
    expect(names.indexOf('employees')).toBeLessThan(names.indexOf('documents'));
  });

  it('الترحيل 011 بيحوّل الوظائف المكتوبة نصًا لقائمة ويربطها', async () => {
    const sql = MIGRATIONS.find((m) => m.name === '011_org_structure.sql')!.sql;
    const insert = sql.slice(sql.indexOf('INSERT INTO job_titles'));
    await env.db.query(`insert into accounts (id, code, name, parent_id, type) values ('acc-old-emp', '110899', 'سلف قديم', 'acc-1108', 'asset')`);
    await env.db.query(`insert into employees (id, name, job_title, advance_account_id) values ('e-old', 'قديم', ' محاسب ', 'acc-old-emp')`);
    await env.db.exec(insert);
    const e = await env.db.one(`select e.job_title, j.name from employees e join job_titles j on j.id = e.job_title_id where e.id = 'e-old'`);
    expect(e.name).toBe('محاسب');
    expect(e.job_title).toBe(' محاسب ');
  });
});
