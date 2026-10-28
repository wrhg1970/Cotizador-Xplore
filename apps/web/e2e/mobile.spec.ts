import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

/** Every screen fits a 390 px phone in light and dark: nothing pushes the page sideways. */
test('phone width: no sideways scroll on any screen, and the menu folds', async ({ browser }) => {
  test.setTimeout(180_000);
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Ada Administradora General');
  await prisma.userOfficeRole.create({
    data: { userId: admin.user.id, officeId: office.id, role: 'OFFICE_ADMIN' },
  });
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomBytes(3).toString('hex').toUpperCase()}`,
      officeId: office.id,
      requesterId: admin.user.id,
      assigneeId: admin.user.id,
      status: 'QUOTING',
      groupName: 'Italia Spring Break 2027 con un nombre largo',
      clientName: 'Colegio Internacional de Monterrey',
      city: 'Roma, Florencia y Venecia',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-04-04'),
      participants: 20,
    },
  });
  const s = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'Opción 1', createdById: admin.user.id },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: s.id,
      number: 1,
      status: 'APPROVED',
      saleCurrency: 'EUR',
      targetMarginRate: 0.18,
      participants: 20,
      chaperones: 2,
      staff: 1,
      validUntil: new Date('2027-01-31'),
      createdById: admin.user.id,
      paymentPlan: { installments: 3, frequency: 'MONTHLY', firstDueDate: '2026-12-15' },
      lines: {
        create: {
          position: 0,
          category: 'PER_PARTICIPANT',
          description: 'Precio neto',
          quantity: 1,
          unitCost: 3900,
          currency: 'EUR',
        },
      },
    },
  });
  const token = randomBytes(32).toString('base64url');
  await prisma.proposalShare.create({
    data: {
      versionId: v.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
      createdById: admin.user.id,
    },
  });
  const pages = [
    '/inicio',
    '/solicitudes',
    '/solicitudes/nueva',
    `/solicitudes/${r.id}`,
    `/cotizaciones/${v.id}`,
    `/cotizaciones/${v.id}/propuesta`,
    '/aprobaciones',
    '/enviadas',
    '/colegios',
    '/tablero',
    '/usuarios',
    '/plantillas',
    '/proveedores',
    '/rubros',
    '/administracion',
    `/bitacora?requestId=${r.id}`,
    '/guia',
    '/historico',
  ];
  const wide: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme });
    const anon = await ctx.newPage();
    for (const p of ['/', '/login', `/p/${token}`]) {
      await anon.goto(p);
      await anon.waitForLoadState('networkidle');
      if (await anon.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        wide.push(`${colorScheme} ${p}`);
    }
    await ctx.addCookies([admin.cookie]);
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        wide.push(`${colorScheme} ${p}`);
    }
    await ctx.close();
  }
  expect(wide).toEqual([]);

  // The menu hides behind "Menú" on phones and opens on tap.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/inicio');
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Menú' }).click();
  await nav.getByRole('link', { name: 'Colegios' }).click();
  await expect(page).toHaveURL(/\/colegios$/);
  await expect(nav).toBeHidden();
  await ctx.close();
});
