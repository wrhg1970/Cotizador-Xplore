import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EE_AGENCY_ID } from '@ee/db';
import { mailBrand } from '../src/agency/brand.js';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let admin: string;
let quoter: string;
let agencyId: string;
let eeAdmin: string;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const brand = (domain: string | null = null) => ({
  brandName: 'Viajes Prueba',
  primaryColor: '#123456',
  accentColor: '#abcdef',
  proposalFooter: 'Viajes Prueba SA de CV · RNT 123',
  mailFromName: 'Cotizador Viajes Prueba',
  customDomain: domain,
});

beforeAll(async () => {
  ctx = await makeApp();
  agencyId = (await makeAgency()).id;
  const office = (await makeOffice(agencyId)).id;
  const login = async (role: 'SYSTEM_ADMIN' | 'QUOTER', agency = agencyId, officeId = office) =>
    (await loginAs(ctx, (await makeUser([{ officeId, role }], 'INVITED', agency)).email)).cookie!;
  admin = await login('SYSTEM_ADMIN');
  quoter = await login('QUOTER');
  eeAdmin = await login('SYSTEM_ADMIN', EE_AGENCY_ID, (await makeOffice()).id);
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();

describe('agency branding', () => {
  it('only its system admin changes it, validated and audited; everyone in the agency reads it', async () => {
    const domain = `cotizador-${uniq()}.example.com`;
    await api().put('/api/v1/agency/brand').set('Cookie', quoter).send(brand()).expect(403);
    await api()
      .put('/api/v1/agency/brand')
      .set('Cookie', admin)
      .send({ ...brand(), primaryColor: 'red' })
      .expect(400);
    await api()
      .put('/api/v1/agency/brand')
      .set('Cookie', admin)
      .send({ ...brand(), customDomain: 'https://x.com/a' })
      .expect(400);
    await api().put('/api/v1/agency/brand').set('Cookie', admin).send(brand(domain)).expect(200);
    const seen = (await api().get('/api/v1/agency/brand').set('Cookie', quoter).expect(200)).body;
    expect(seen).toMatchObject({ ...brand(domain), logoUrl: null });
    await prisma.auditLog.findFirstOrThrow({
      where: { action: 'agency.brand_updated', entityId: agencyId, agencyId },
    });
    // Another agency can't take the same domain, and its own brand is untouched.
    await api().put('/api/v1/agency/brand').set('Cookie', eeAdmin).send(brand(domain)).expect(409);
    expect(
      (await api().get('/api/v1/agency/brand').set('Cookie', eeAdmin).expect(200)).body.brandName,
    ).not.toBe('Viajes Prueba');
  });

  it('the login page gets the brand of its hostname, EE by default, without internal fields', async () => {
    const domain = `login-${uniq()}.example.com`;
    await api().put('/api/v1/agency/brand').set('Cookie', admin).send(brand(domain)).expect(200);
    const mine = (await api().get('/api/v1/branding').set('X-Forwarded-Host', domain).expect(200)).body;
    expect(mine).toMatchObject({ brandName: 'Viajes Prueba', primaryColor: '#123456' });
    expect(mine).not.toHaveProperty('proposalFooter');
    expect(mine).not.toHaveProperty('mailFromName');
    const other = (await api().get('/api/v1/branding').set('X-Forwarded-Host', 'unknown.example').expect(200))
      .body;
    expect(other.name).toBe('Estudiantes Embajadores');
  });

  it('logo: PNG or JPG only, served publicly with its type, removable', async () => {
    const upload = (fileName: string, bytes: Buffer) =>
      api()
        .put('/api/v1/agency/logo')
        .set('Cookie', admin)
        .send({ fileName, fileBase64: bytes.toString('base64') });
    await upload('logo.svg', Buffer.from('<svg onload="alert(1)"/>')).expect(400);
    await upload('logo.pdf', Buffer.from('%PDF-1.4 x')).expect(400);
    const { logoUrl } = (await upload('logo.png', PNG).expect(200)).body as { logoUrl: string };
    expect(logoUrl).toMatch(new RegExp(`^/api/v1/agencies/${agencyId}/logo\\?v=\\d+$`));
    const res = await api().get(logoUrl).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body as Buffer)).toEqual(PNG);
    await api().delete('/api/v1/agency/logo').set('Cookie', admin).expect(200);
    await api().get(logoUrl).expect(404);
  });

  it("emails carry the agency sender name, signature and own domain; EE keeps today's text", () => {
    const base = { name: 'Agencia', brandName: null, mailFromName: null, customDomain: null };
    expect(mailBrand({ ...base } as never, 'https://cotizador.xploretogether.travel')).toEqual({
      fromName: undefined,
      origin: 'https://cotizador.xploretogether.travel',
      signature: 'Cotizador de Agencia. Aviso automático, no respondas este correo.',
    });
    expect(
      mailBrand(
        { ...base, brandName: 'Viajes', mailFromName: 'Viajes', customDomain: 'cot.viajes.mx' } as never,
        'https://x',
      ),
    ).toMatchObject({
      fromName: 'Viajes',
      origin: 'https://cot.viajes.mx',
      signature: expect.stringContaining('Viajes'),
    });
  });
});
