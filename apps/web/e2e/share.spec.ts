import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('quoter creates a school link; the school opens it without an account; revoking kills it', async ({
  browser,
}) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Liga para el colegio',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
  });
  const version = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'APPROVED',
      saleCurrency: 'EUR',
      targetMarginRate: 0.18,
      participants: 10,
      chaperones: 0,
      staff: 0,
      validUntil: new Date('2026-12-31'),
      createdById: quoter.user.id,
      lines: {
        create: {
          position: 0,
          category: 'PER_PARTICIPANT',
          description: 'Precio neto',
          quantity: 1,
          unitCost: 4100,
          currency: 'EUR',
        },
      },
    },
  });

  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/cotizaciones/${version.id}`);
  const links = page.getByRole('region', { name: 'Liga para el colegio' });
  await links.getByLabel('Vigencia (días)').fill('7');
  await links.getByRole('button', { name: 'Crear liga' }).click();
  const url = await links.getByLabel('Liga creada').inputValue();
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);

  // The school: no cookies, no header, no costs.
  const school = await (await browser.newContext()).newPage();
  await school.goto(url);
  await expect(school.getByRole('heading', { name: 'Liga para el colegio' })).toBeVisible();
  await expect(school.getByText('5000.00 EUR')).toBeVisible();
  await expect(school.getByText(/Liga vigente hasta/)).toBeVisible();
  await expect(school.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
  await expect(school).toHaveURL(url);

  await page.reload();
  await expect(links.getByText(/Vigente hasta .* · 1 vista/)).toBeVisible();
  await links.getByRole('button', { name: 'Revocar' }).click();
  await expect(links.getByText(/Revocada/)).toBeVisible();
  await school.reload();
  await expect(school.locator('p.error')).toHaveText('Esta liga no existe o ya no está vigente');
  await ctx.close();
});
