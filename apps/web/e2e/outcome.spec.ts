import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('the quoter records which sent proposal the client accepted', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'SENT',
      groupName: 'Resultado Roma 2027',
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
  await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'MXN',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: quoter.user.id,
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto('/inicio');
  await page
    .getByRole('row')
    .filter({ hasText: req.folio })
    .getByRole('link', { name: 'Registrar respuesta del cliente' })
    .click();
  await expect(page.getByLabel('Propuesta aceptada')).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Ganada' }).click();
  await expect(page.locator('.badge')).toHaveText('Ganada');
  await expect(page.getByText('Opción 1 · v1')).toBeVisible();
  await expect(page.getByText('Registró la solicitud como ganada')).toBeVisible();
  await ctx.close();
});
