import { createECDH, createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VapidPushSender } from '../src/notify/push.js';
import { FakePush, loginAs, makeApp, makeOffice, makeUser, prisma, testEnv, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const push = new FakePush();
let officeId: string;
const c: Record<'advisor' | 'quoter' | 'admin', string> = {} as never;
const ids: Record<string, string> = {};

const sub = (n = uniq()) => ({
  endpoint: `https://push.example/send/${n}`,
  keys: { p256dh: 'B'.padEnd(87, 'x'), auth: 'a'.repeat(22) },
});

beforeAll(async () => {
  ctx = await makeApp(undefined, undefined, undefined, undefined, undefined, testEnv(), push);
  officeId = (await makeOffice()).id;
  for (const [k, role] of [
    ['advisor', 'ADVISOR'],
    ['quoter', 'QUOTER'],
    ['admin', 'OFFICE_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[k] = u.id;
    c[k] = (await loginAs(ctx, u.email)).cookie!;
  }
});
afterAll(() => ctx.app.close());

describe('web push', () => {
  it('publishes the public key and validates subscriptions', async () => {
    expect((await ctx.http().get('/api/v1/push/key').set('Cookie', c.quoter).expect(200)).body).toEqual({
      publicKey: 'BTEST',
    });
    await ctx.http().get('/api/v1/push/key').expect(401);
    const bad = { ...sub(), endpoint: 'http://push.example/x' };
    await ctx.http().post('/api/v1/push/subscriptions').set('Cookie', c.quoter).send(bad).expect(400);
  });

  it('pushes the assignment to the quoter’s device, without prices, and drops dead devices', async () => {
    const phone = sub();
    const old = sub();
    for (const s of [phone, old])
      await ctx.http().post('/api/v1/push/subscriptions').set('Cookie', c.quoter).send(s).expect(204);
    push.gone.add(old.endpoint);

    const r = await prisma.travelRequest.create({
      data: {
        folio: `EE-2027-${uniq().toUpperCase()}`,
        officeId,
        requesterId: ids.advisor!,
        status: 'SUBMITTED',
        groupName: 'Push Lisboa',
        city: 'Lisboa',
        countryCode: 'PT',
        departureDate: new Date('2027-05-01'),
        returnDate: new Date('2027-05-08'),
        participants: 12,
      },
    });
    await ctx
      .http()
      .post(`/api/v1/requests/${r.id}/assign`)
      .set('Cookie', c.admin)
      .send({ assigneeId: ids.quoter, version: 1 })
      .expect(201);
    await expect.poll(() => push.sent.filter((p) => p.endpoint === phone.endpoint).length).toBe(1);
    const p = push.sent.find((x) => x.endpoint === phone.endpoint)!.payload;
    expect(p).toMatchObject({ url: `/solicitudes/${r.id}` });
    expect(p.title).toContain(r.folio);
    expect(p.body).toContain('Push Lisboa');
    await expect.poll(() => prisma.pushSubscription.count({ where: { endpoint: old.endpoint } })).toBe(0);
  });

  it('only removes the caller’s own subscription', async () => {
    const s = sub();
    await ctx.http().post('/api/v1/push/subscriptions').set('Cookie', c.quoter).send(s).expect(204);
    await ctx
      .http()
      .delete('/api/v1/push/subscriptions')
      .set('Cookie', c.advisor)
      .send({ endpoint: s.endpoint })
      .expect(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint: s.endpoint } })).toBe(1);
    await ctx
      .http()
      .delete('/api/v1/push/subscriptions')
      .set('Cookie', c.quoter)
      .send({ endpoint: s.endpoint })
      .expect(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint: s.endpoint } })).toBe(0);
  });

  it('derives the VAPID public key from the PEM secret', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const s = new VapidPushSender(
      privateKey.export({ format: 'pem', type: 'sec1' }).toString(),
      'mailto:a@b.example',
    );
    expect(s.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/); // 65-byte uncompressed point
    // web-push accepts the derived keys and encrypts for a real browser key pair (no network).
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const details = webpush.generateRequestDetails(
      {
        endpoint: 'https://push.example/x',
        keys: { p256dh: browser.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
      },
      'hola',
      {
        vapidDetails: {
          subject: 'mailto:a@b.example',
          publicKey: s.publicKey,
          privateKey: createPrivateKey(privateKey.export({ format: 'pem', type: 'sec1' })).export({
            format: 'jwk',
          }).d!,
        },
      },
    );
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=B/);
  });
});
