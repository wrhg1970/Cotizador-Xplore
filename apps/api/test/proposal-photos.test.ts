import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pexelsImage, type StockPhotos, toStockPhoto } from '../src/integrations/pexels.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma, testEnv, uniq } from './helpers.js';

/** Up to 5 proposal photos: Pexels or own uploads (Will, 2026-11-13). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

class FakePexels implements StockPhotos {
  async search(query: string) {
    return {
      photos: [
        {
          id: 7,
          thumb: 'https://images.pexels.com/7.jpg',
          alt: query,
          photographer: 'Ana',
          url: 'https://www.pexels.com/photo/7/',
        },
      ],
      hasNext: false,
    };
  }
  async download(id: number) {
    return { content: Buffer.from(JPEG), credit: id === 7 ? 'Ana / Pexels' : 'Otro / Pexels' };
  }
}

let ctx: Awaited<ReturnType<typeof makeApp>>;
let off: Awaited<ReturnType<typeof makeApp>>;
let quoter: string;
let advisor: string;
let requestId: string;
let otherRequestId: string;

async function makeRequest(officeId: string, userId: string) {
  return (
    await prisma.travelRequest.create({
      data: {
        folio: `EE-2030-${uniq().toUpperCase().slice(0, 6)}`,
        officeId,
        requesterId: userId,
        assigneeId: userId,
        status: 'QUOTING',
        groupName: 'Grupo fotos',
        city: 'Montreal',
        countryCode: 'CA',
        departureDate: new Date('2031-06-25'),
        returnDate: new Date('2031-07-02'),
        participants: 12,
      },
    })
  ).id;
}

beforeAll(async () => {
  ctx = await makeApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    testEnv(),
    undefined,
    new FakePexels(),
  );
  off = await makeApp();
  const office = (await makeOffice()).id;
  const q = await makeUser([{ officeId: office, role: 'QUOTER' }]);
  quoter = (await loginAs(ctx, q.email)).cookie!;
  advisor = (await loginAs(ctx, (await makeUser([{ officeId: office, role: 'AUDITOR' }])).email)).cookie!;
  requestId = await makeRequest(office, q.id);
  otherRequestId = await makeRequest(office, q.id);
});
afterAll(async () => {
  await ctx.app.close();
  await off.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
const upload = (id: string, fileName: string, content: Buffer) =>
  api()
    .post(`/api/v1/requests/${id}/attachments`)
    .set('Cookie', quoter)
    .send({ fileName, fileBase64: content.toString('base64') })
    .expect(201);

describe('Pexels mapping', () => {
  it('only ever trusts images.pexels.com over https', () => {
    expect(pexelsImage('https://images.pexels.com/photos/1/a.jpeg?w=940')).toContain('images.pexels.com');
    expect(pexelsImage('http://images.pexels.com/a.jpg')).toBeNull();
    expect(pexelsImage('https://evil.example/a.jpg')).toBeNull();
    expect(toStockPhoto({ id: 1, src: { medium: 'https://evil.example/a.jpg' } })).toBeNull();
    expect(
      toStockPhoto({ id: 1, src: { medium: 'https://images.pexels.com/1.jpg' }, url: 'javascript:x' }),
    ).toMatchObject({
      url: 'https://www.pexels.com/',
      photographer: 'Pexels',
    });
  });
});

describe('proposal photos', () => {
  it('searches Pexels and copies the picked photo with its credit; without key it says so', async () => {
    const found = await api().get('/api/v1/stock-photos?q=Montreal').set('Cookie', quoter).expect(200);
    expect(found.body.photos[0]).toMatchObject({ id: 7, photographer: 'Ana' });
    await api().get('/api/v1/stock-photos?q=').set('Cookie', quoter).expect(400);
    await api().get('/api/v1/stock-photos?q=Montreal').expect(401);
    const login = (
      await loginAs(off, (await makeUser([{ officeId: (await makeOffice()).id, role: 'QUOTER' }])).email)
    ).cookie!;
    const offRes = await off.http().get('/api/v1/stock-photos?q=Montreal').set('Cookie', login).expect(503);
    expect(offRes.body.code).toBe('STOCK_OFF');

    const picked = await api()
      .post(`/api/v1/requests/${requestId}/attachments/stock`)
      .set('Cookie', quoter)
      .send({ photoId: 7 })
      .expect(201);
    expect(picked.body).toMatchObject({
      fileName: 'pexels-7.jpg',
      mimeType: 'image/jpeg',
      credit: 'Ana / Pexels',
    });
    // Read-only roles cannot add files.
    await api()
      .post(`/api/v1/requests/${requestId}/attachments/stock`)
      .set('Cookie', advisor)
      .send({ photoId: 7 })
      .expect(403);
  });

  it('keeps up to 5 photos of the same request, the first as cover, and serves them by position', async () => {
    const stock = (
      await api()
        .post(`/api/v1/requests/${requestId}/attachments/stock`)
        .set('Cookie', quoter)
        .send({ photoId: 7 })
    ).body.id as string;
    const own = (await upload(requestId, 'mia.png', PNG)).body.id as string;
    const foreign = (await upload(otherRequestId, 'otra.png', PNG)).body.id as string;
    const pdf = (await upload(requestId, 'doc.pdf', Buffer.from('%PDF-1.4 x'))).body.id as string;
    const v = (
      await api()
        .post(`/api/v1/requests/${requestId}/scenarios`)
        .set('Cookie', quoter)
        .send({ name: 'Opción 1', saleCurrency: 'CAD' })
        .expect(201)
    ).body.latest;
    const patch = (photoIds: string[], rowVersion: number) =>
      api().patch(`/api/v1/quotes/${v.id}`).set('Cookie', quoter).send({ photoIds, rowVersion });

    await patch([foreign], 1).expect(400);
    await patch([pdf], 1).expect(400);
    await patch([own, own], 1).expect(400);
    await patch(
      [own, stock, own, stock, own, stock].map(() => crypto.randomUUID()),
      1,
    ).expect(400);

    const saved = (await patch([own, stock], 1).expect(200)).body;
    expect(saved).toMatchObject({ photoIds: [own, stock], coverAttachmentId: own });
    const p = (await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', quoter).expect(200)).body;
    expect(p).toMatchObject({ hasCover: true, photos: 2, photoCredits: ['Ana / Pexels'] });
    const second = await api()
      .get(`/api/v1/quotes/${v.id}/proposal/photos/1`)
      .set('Cookie', quoter)
      .expect(200);
    expect(second.headers['content-type']).toContain('image/jpeg');
    await api().get(`/api/v1/quotes/${v.id}/proposal/photos/2`).set('Cookie', quoter).expect(404);
    await api().get(`/api/v1/quotes/${v.id}/proposal/photos/1`).expect(401);

    // A photo in use cannot be deleted from the files.
    const del = await api()
      .delete(`/api/v1/requests/${requestId}/attachments/${stock}`)
      .set('Cookie', quoter);
    expect(del.status).toBe(409);

    // Clearing removes the cover too.
    expect((await patch([], 2).expect(200)).body).toMatchObject({ photoIds: [], coverAttachmentId: null });
  });
});
