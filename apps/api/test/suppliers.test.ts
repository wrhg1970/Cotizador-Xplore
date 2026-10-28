import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let sysAdmin: string;
let quoter: string;
let advisor: string;

beforeAll(async () => {
  ctx = await makeApp();
  const office = (await makeOffice()).id;
  const login = async (role: 'SYSTEM_ADMIN' | 'QUOTER' | 'ADVISOR') =>
    (await loginAs(ctx, (await makeUser([{ officeId: office, role }])).email)).cookie!;
  sysAdmin = await login('SYSTEM_ADMIN');
  quoter = await login('QUOTER');
  advisor = await login('ADVISOR');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
type Row = { id: string; rates: { id: string; unitCost: string }[] };

describe('supplier catalog', () => {
  it('system admins add suppliers and rates; quoters read active ones; price changes are audited', async () => {
    const name = `DMC Roma ${uniq()}`;
    const s = await api()
      .post('/api/v1/suppliers')
      .set('Cookie', sysAdmin)
      .send({ name, country: 'Italia', email: 'ventas@example.com' })
      .expect(201);
    await api().post('/api/v1/suppliers').set('Cookie', sysAdmin).send({ name }).expect(409);
    const rate = await api()
      .post(`/api/v1/suppliers/${s.body.id}/rates`)
      .set('Cookie', sysAdmin)
      .send({
        description: 'Hotel 3* por noche',
        category: 'PER_PARTICIPANT',
        unitCost: '85.5',
        currency: 'EUR',
        validUntil: '2027-03-31',
      })
      .expect(201);
    expect(rate.body).toMatchObject({ unitCost: '85.50', currency: 'EUR', validUntil: '2027-03-31' });
    await api()
      .patch(`/api/v1/supplier-rates/${rate.body.id}`)
      .set('Cookie', sysAdmin)
      .send({ unitCost: '90' })
      .expect(200);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: rate.body.id, action: 'supplier_rate.updated' },
    });
    expect(log.diff).toEqual({ unitCost: { from: '85.5', to: '90' } });

    const seen = (await api().get('/api/v1/suppliers').set('Cookie', quoter).expect(200)).body as Row[];
    expect(seen.find((x) => x.id === s.body.id)?.rates[0]?.unitCost).toBe('90.00');

    await api()
      .patch(`/api/v1/supplier-rates/${rate.body.id}`)
      .set('Cookie', sysAdmin)
      .send({ active: false })
      .expect(200);
    await api()
      .patch(`/api/v1/suppliers/${s.body.id}`)
      .set('Cookie', sysAdmin)
      .send({ active: false })
      .expect(200);
    const after = (await api().get('/api/v1/suppliers').set('Cookie', quoter)).body as Row[];
    expect(after.some((x) => x.id === s.body.id)).toBe(false);
    const forAdmin = (await api().get('/api/v1/suppliers').set('Cookie', sysAdmin)).body as Row[];
    expect(forAdmin.find((x) => x.id === s.body.id)?.rates).toHaveLength(1);
  });

  it('roles without internal costs cannot read; only system admins write; bad input rejected', async () => {
    await api().get('/api/v1/suppliers').set('Cookie', advisor).expect(403);
    await api().get('/api/v1/suppliers').expect(401);
    await api()
      .post('/api/v1/suppliers')
      .set('Cookie', quoter)
      .send({ name: `X ${uniq()}` })
      .expect(403);
    const s = await api()
      .post('/api/v1/suppliers')
      .set('Cookie', sysAdmin)
      .send({ name: `Y ${uniq()}` })
      .expect(201);
    const bad = { description: 'Bus', category: 'PER_GROUP', currency: 'MXN' };
    await api()
      .post(`/api/v1/suppliers/${s.body.id}/rates`)
      .set('Cookie', sysAdmin)
      .send({ ...bad, unitCost: '-1' })
      .expect(400);
    await api()
      .post(`/api/v1/suppliers/${s.body.id}/rates`)
      .set('Cookie', quoter)
      .send({ ...bad, unitCost: '1' })
      .expect(403);
    await api()
      .post('/api/v1/suppliers/00000000-0000-4000-8000-000000000000/rates')
      .set('Cookie', sysAdmin)
      .send({ ...bad, unitCost: '1' })
      .expect(404);
  });
});
