import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let sysAdmin: string;
let quoter: string;
let advisor: string;
let office: string;
let quoterId: string;
let otherQuoter: string;

beforeAll(async () => {
  ctx = await makeApp();
  office = (await makeOffice()).id;
  const login = async (role: 'SYSTEM_ADMIN' | 'QUOTER' | 'ADVISOR', officeId = office) => {
    const u = await makeUser([{ officeId, role }]);
    if (role === 'QUOTER' && officeId === office) quoterId = u.id;
    return (await loginAs(ctx, u.email)).cookie!;
  };
  sysAdmin = await login('SYSTEM_ADMIN');
  quoter = await login('QUOTER');
  otherQuoter = await login('QUOTER', (await makeOffice()).id);
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

  it('ficha: tax data, contacts and quote usage limited to offices whose costs I see', async () => {
    const name = `DMC Ficha ${uniq()}`;
    const s = (
      await api()
        .post('/api/v1/suppliers')
        .set('Cookie', sysAdmin)
        .send({ name, taxId: 'abc010101xy9', website: 'https://dmc.example' })
        .expect(201)
    ).body;
    await api()
      .patch(`/api/v1/suppliers/${s.id}`)
      .set('Cookie', sysAdmin)
      .send({ website: 'dmc.example' })
      .expect(400);
    const contact = { name: 'Kate Moore', role: 'Ventas', email: 'kate@example.com' };
    await api().post(`/api/v1/suppliers/${s.id}/contacts`).set('Cookie', quoter).send(contact).expect(403);
    const cid = (
      await api().post(`/api/v1/suppliers/${s.id}/contacts`).set('Cookie', sysAdmin).send(contact).expect(201)
    ).body.id;
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: cid } });
    expect(JSON.stringify(log.diff)).not.toContain('Kate');

    const r = await prisma.travelRequest.create({
      data: {
        folio: `EE-2027-${uniq().toUpperCase()}`,
        officeId: office,
        requesterId: quoterId,
        status: 'SENT',
        groupName: 'Viaje Roma',
        clientName: 'Colegio X',
        city: 'Roma',
        countryCode: 'IT',
        departureDate: new Date('2027-03-01'),
        returnDate: new Date('2027-03-08'),
        participants: 10,
      },
    });
    const sc = await prisma.quoteScenario.create({
      data: { requestId: r.id, name: 'A', createdById: quoterId },
    });
    await prisma.quoteVersion.create({
      data: {
        scenarioId: sc.id,
        number: 1,
        saleCurrency: 'EUR',
        participants: 10,
        chaperones: 0,
        staff: 0,
        createdById: quoterId,
        lines: {
          create: [0, 1].map((position) => ({
            position,
            category: 'PER_PARTICIPANT' as const,
            description: `Hotel ${position}`,
            quantity: 1,
            unitCost: 85,
            currency: 'EUR',
            costSource: name,
          })),
        },
      },
    });
    const row = ((await api().get('/api/v1/suppliers').set('Cookie', quoter)).body as Row[]).find(
      (x) => x.id === s.id,
    ) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({ taxId: 'ABC010101XY9', quotes12m: 1, wissifyId: null });
    expect(row.contacts).toEqual([expect.objectContaining({ id: cid, name: 'Kate Moore' })]);
    const usage = (await api().get(`/api/v1/suppliers/${s.id}/usage`).set('Cookie', quoter).expect(200)).body;
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ unitCost: '85.00', request: { folio: r.folio } });
    // A quoter of another office sees the supplier but not this office's quotes.
    expect((await api().get(`/api/v1/suppliers/${s.id}/usage`).set('Cookie', otherQuoter)).body).toEqual([]);
    await api().get(`/api/v1/suppliers/${s.id}/usage`).set('Cookie', advisor).expect(403);
    await api().delete(`/api/v1/supplier-contacts/${cid}`).set('Cookie', quoter).expect(403);
    await api().delete(`/api/v1/supplier-contacts/${cid}`).set('Cookie', sysAdmin).expect(200);
    // Used by a quote: cannot be deleted.
    await api().delete(`/api/v1/suppliers/${s.id}`).set('Cookie', sysAdmin).expect(409);
  });

  it('system admins delete unused suppliers with their rates and contacts', async () => {
    const s = (
      await api()
        .post('/api/v1/suppliers')
        .set('Cookie', sysAdmin)
        .send({ name: `Vacío ${uniq()}` })
    ).body;
    await api()
      .post(`/api/v1/suppliers/${s.id}/rates`)
      .set('Cookie', sysAdmin)
      .send({ description: 'Bus', category: 'PER_GROUP', unitCost: '10', currency: 'MXN' })
      .expect(201);
    await api()
      .post(`/api/v1/suppliers/${s.id}/contacts`)
      .set('Cookie', sysAdmin)
      .send({ name: 'Ana' })
      .expect(201);
    const listed = ((await api().get('/api/v1/suppliers').set('Cookie', sysAdmin)).body as Row[]).find(
      (x) => x.id === s.id,
    ) as unknown as { quotesEver: number };
    expect(listed.quotesEver).toBe(0);
    await api().delete(`/api/v1/suppliers/${s.id}`).set('Cookie', quoter).expect(403);
    await api().delete(`/api/v1/suppliers/${s.id}`).set('Cookie', sysAdmin).expect(200);
    expect(await prisma.supplier.findUnique({ where: { id: s.id } })).toBeNull();
    await prisma.auditLog.findFirstOrThrow({ where: { entityId: s.id, action: 'supplier.deleted' } });
    await api().delete(`/api/v1/suppliers/${s.id}`).set('Cookie', sysAdmin).expect(404);
  });
});
