import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('the saved sheet hides concepts at 0 but keeps them in the editor', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Conceptos en cero',
      city: 'Toronto',
      countryCode: 'CA',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 12,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
  });
  const line = (
    position: number,
    category: 'PER_PARTICIPANT' | 'PER_STAFF',
    description: string,
    unitCost: number,
  ) => ({
    position,
    category,
    description,
    quantity: 1,
    unitCost,
    currency: 'MXN',
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      saleCurrency: 'MXN',
      participants: 12,
      chaperones: 0,
      staff: 1,
      createdById: quoter.user.id,
      lines: {
        create: [
          line(0, 'PER_PARTICIPANT', 'Precio neto', 2404),
          line(1, 'PER_PARTICIPANT', 'Transfer', 0),
          line(2, 'PER_STAFF', 'Costo chaperón', 1260),
          line(3, 'PER_STAFF', 'Gastos del viaje', 0),
        ],
      },
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/cotizaciones/${v.id}`);
  const concepts = page.getByRole('table', { name: 'Conceptos por estudiante' });
  const chaperones = page.getByRole('table', { name: 'Gastos de chaperones' });
  await expect(concepts).toContainText('Precio neto');
  await expect(concepts).not.toContainText('Transfer');
  await expect(concepts).toContainText('SubTotal 1');
  await expect(chaperones).toContainText('Costo chaperón');
  await expect(chaperones).not.toContainText('Gastos del viaje');
  await expect(chaperones).not.toContainText('Fondo de emergencia');
  await expect(chaperones).toContainText('Total chaperones');
  // The capture form still lists every concept so it can be filled in.
  await expect(page.locator('input[value="Transfer"]')).toHaveCount(1);
  await expect(page.locator('input[value="Gastos del viaje"]')).toHaveCount(1);
  await ctx.close();
});

test('an approved version still switches concept tabs and folds blocks, with fields locked', async ({
  browser,
}) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Aprobada en solo lectura',
      city: 'Toronto',
      countryCode: 'CA',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 12,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'APPROVED',
      saleCurrency: 'MXN',
      participants: 12,
      chaperones: 0,
      staff: 1,
      createdById: quoter.user.id,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Precio neto',
            quantity: 1,
            unitCost: 2404,
            currency: 'MXN',
          },
          {
            position: 1,
            category: 'PER_STAFF',
            description: 'Costo chaperón',
            quantity: 1,
            unitCost: 1260,
            currency: 'MXN',
          },
        ],
      },
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/cotizaciones/${v.id}`);
  await expect(page.locator('input[value="Precio neto"]')).toBeDisabled();
  const chaperonesTab = page.getByRole('tab', { name: /Chaperones EE/ });
  await chaperonesTab.click();
  await expect(chaperonesTab).toHaveAttribute('aria-selected', 'true');
  const staffLine = page.locator('input[value="Costo chaperón"]');
  await expect(staffLine).toBeVisible();
  await expect(staffLine).toBeDisabled();
  const fold = page.getByRole('button', { name: 'Chaperones EE', exact: true });
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(staffLine).toBeHidden();
  await expect(page.getByRole('button', { name: 'Agregar concepto: Chaperones EE' })).toBeHidden();
  await ctx.close();
});
