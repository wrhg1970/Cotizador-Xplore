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
    .getByRole('article')
    .filter({ hasText: req.folio })
    .getByRole('link', { name: 'Registrar respuesta del colegio →' })
    .click();
  await expect(page.getByLabel('Propuesta vendida')).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Vendida' }).click();
  await expect(page.locator('.badge')).toHaveText('Vendida');
  await expect(page.getByText('Opción 1 · v1')).toBeVisible();
  await page.getByRole('tab', { name: 'Bitácora' }).click();
  await expect(page.getByText('Marcó la propuesta como vendida')).toBeVisible();
  await ctx.close();
});

test('Propuestas enviadas marks a proposal as sold and it moves to Propuestas vendidas', async ({
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
      status: 'SENT',
      groupName: 'Vendida Lisboa 2099',
      city: 'Lisboa',
      countryCode: 'PT',
      departureDate: new Date('2099-03-19'),
      returnDate: new Date('2099-03-25'),
      participants: 10,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'MXN',
      participants: 10,
      chaperones: 1,
      staff: 0,
      createdById: quoter.user.id,
    },
  });
  await prisma.proposalDelivery.create({
    data: {
      versionId: v.id,
      sentById: quoter.user.id,
      recipients: 'colegio@e2e.example',
      channel: 'EMAIL',
      sentOn: new Date('2026-11-01'),
    },
  });

  // The requester sees the delivery but may not record the outcome.
  const advCtx = await browser.newContext();
  await advCtx.addCookies([advisor.cookie]);
  const adv = await advCtx.newPage();
  await adv.goto('/enviadas');
  await expect(adv.getByRole('row').filter({ hasText: req.folio })).toBeVisible();
  await expect(adv.getByRole('button', { name: 'Marcar vendida' })).toHaveCount(0);
  await advCtx.close();

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto('/enviadas');
  const row = page.getByRole('row').filter({ hasText: req.folio });
  await row.getByRole('button', { name: 'Marcar vendida' }).click();
  await expect(row).toContainText('Vendida');
  await expect(row.getByRole('button', { name: 'Marcar vendida' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Propuestas vendidas' }).click();
  const sold = page.getByRole('row').filter({ hasText: req.folio });
  await expect(sold).toContainText('Opción 1 · v1');
  await expect(sold).toContainText('10 + 1');
  await ctx.close();
});
