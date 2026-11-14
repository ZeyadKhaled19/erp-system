import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;

beforeAll(async () => {
  env = await setup();
  A = await env.login();
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

describe('company brand', () => {
  it('serves name, system name and logo before login, and saves a custom system name', async () => {
    const before = await env.app.inject({ method: 'GET', url: '/api/brand' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ company_name: 'شركتي', system_name: '', logo: null });

    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const save = await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { company_name: 'محل التجربة', system_name: 'نظام محل التجربة', print_logo: logo } });
    expect(save.statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url: '/api/brand' })).json()).toEqual({ company_name: 'محل التجربة', system_name: 'نظام محل التجربة', logo });

    const tooLong = await env.app.inject({ method: 'POST', url: '/api/admin/settings', headers: A.headers, payload: { system_name: 'x'.repeat(61) } });
    expect(tooLong.statusCode).not.toBe(200);
  });
});
