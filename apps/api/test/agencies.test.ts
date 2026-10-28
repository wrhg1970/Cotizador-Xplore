import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EE_AGENCY_ID } from '@ee/db';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let platform: string;
let otherAdmin: string;
const domain = `viajes-${uniq()}.example`;
const adminEmail = `ana@${domain}`;
let created: { id: string; officeId: string; adminId: string };

beforeAll(async () => {
  ctx = await makeApp();
  platform = (
    await loginAs(ctx, (await makeUser([{ officeId: (await makeOffice()).id, role: 'SYSTEM_ADMIN' }])).email)
  ).cookie!;
  const other = await makeAgency();
  const office = await makeOffice(other.id);
  otherAdmin = (
    await loginAs(
      ctx,
      (await makeUser([{ officeId: office.id, role: 'SYSTEM_ADMIN' }], 'INVITED', other.id)).email,
    )
  ).cookie!;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
const body = () => ({
  code: `VX-${uniq()}`.toUpperCase().slice(0, 20),
  name: 'Viajes X',
  allowedDomains: [domain],
  officeCode: 'MTY',
  officeName: 'Monterrey',
  adminEmail,
  adminName: 'Ana Admin',
});

describe('agencies (platform)', () => {
  it('only an EE system admin registers agencies; the admin email must be of its domains', async () => {
    await api().get('/api/v1/agencies').set('Cookie', otherAdmin).expect(403);
    await api().post('/api/v1/agencies').set('Cookie', otherAdmin).send(body()).expect(403);
    await api()
      .post('/api/v1/agencies')
      .set('Cookie', platform)
      .send({ ...body(), adminEmail: 'ana@gmail.com' })
      .expect(400);
    created = (await api().post('/api/v1/agencies').set('Cookie', platform).send(body()).expect(201)).body;
    await api()
      .post('/api/v1/agencies')
      .set('Cookie', platform)
      .send({ ...body(), code: 'OTRO' })
      .expect(409);

    const listed = (await api().get('/api/v1/agencies').set('Cookie', platform).expect(200)).body as {
      id: string;
      offices: number;
      users: number;
    }[];
    expect(listed.find((a) => a.id === created.id)).toMatchObject({ offices: 1, users: 1 });
    // Starts with EE's concept catalog as its own copy.
    expect(await prisma.conceptTemplate.count({ where: { agencyId: created.id } })).toBe(
      await prisma.conceptTemplate.count({ where: { agencyId: EE_AGENCY_ID, active: true } }),
    );
    await prisma.auditLog.findFirstOrThrow({ where: { action: 'agency.created', entityId: created.id } });
  });

  it("the new agency's admin signs in with its Google domain and invites only that domain", async () => {
    const { cookie } = await loginAs(ctx, adminEmail);
    expect(cookie).toBeDefined();
    const me = (await api().get('/api/v1/me').set('Cookie', cookie!).expect(200)).body;
    expect(me).toMatchObject({ agencyId: created.id, platformAdmin: false });
    const invite = (email: string) =>
      api()
        .post('/api/v1/users')
        .set('Cookie', cookie!)
        .send({ email, name: 'Nuevo', officeId: created.officeId, role: 'QUOTER' });
    await invite(`luis@${domain}`).expect(201);
    await invite(`luis-${uniq()}@ee-test.example`).expect(400);
  });

  it('login: unknown domain, known but not invited, and an account outside its agency domains', async () => {
    const reason = async (email: string) =>
      new URL((await loginAs(ctx, email)).response.headers.location as string).searchParams.get('error');
    expect(await reason(`x-${uniq()}@nadie.example`)).toBe('DOMAIN_NOT_ALLOWED');
    expect(await reason(`x-${uniq()}@${domain}`)).toBe('NOT_INVITED');
    // A user of the new agency whose address is EE's domain: valid Workspace, wrong agency.
    const stray = await prisma.user.create({
      data: { agencyId: created.id, email: `stray-${uniq()}@ee-test.example`, name: 'X' },
    });
    expect(await reason(stray.email)).toBe('DOMAIN_NOT_ALLOWED');
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.login_rejected', agencyId: created.id },
    });
    expect(row.entityId).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('a deactivated agency is locked out at once; EE cannot be deactivated', async () => {
    const { cookie } = await loginAs(ctx, adminEmail);
    await api()
      .patch(`/api/v1/agencies/${EE_AGENCY_ID}`)
      .set('Cookie', platform)
      .send({ active: false })
      .expect(403);
    await api()
      .patch(`/api/v1/agencies/${created.id}`)
      .set('Cookie', platform)
      .send({ active: false })
      .expect(200);
    await api().get('/api/v1/me').set('Cookie', cookie!).expect(401);
    const again = await loginAs(ctx, adminEmail);
    expect(new URL(again.response.headers.location as string).searchParams.get('error')).toBe('DISABLED');
    await api()
      .patch(`/api/v1/agencies/${created.id}`)
      .set('Cookie', platform)
      .send({ active: true })
      .expect(200);
  });

  it("login opened on an agency's own domain returns to that domain", async () => {
    const own = `cot-${uniq()}.example.com`;
    await prisma.agency.update({ where: { id: created.id }, data: { customDomain: own } });
    const { response, cookie } = await loginAs(ctx, adminEmail, undefined, own);
    expect(ctx.oidc.redirectUri).toBe(`https://${own}/api/v1/auth/google/callback`);
    expect(response.headers.location).toBe(`https://${own}`);
    expect(cookie).toBeDefined();
    // Any other host keeps the default deployment.
    await loginAs(ctx, adminEmail, undefined, 'evil.example');
    expect(ctx.oidc.redirectUri).toBeUndefined();
  });
});
