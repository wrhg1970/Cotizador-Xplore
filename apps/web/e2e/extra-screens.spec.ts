import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('approvals list, Kanban by stage and integrations status', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const approver = await userWithSession(office.id, 'APPROVER', 'Aurora');
  const sysadmin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sistemas');
  const groupName = `Pantallas extra ${randomUUID().slice(0, 4)}`;
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName,
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
      status: 'IN_REVIEW',
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

  const ctx = await browser.newContext();
  await ctx.addCookies([approver.cookie]);
  const page = await ctx.newPage();
  await page.goto('/aprobaciones');
  const row = page.getByRole('row', { name: new RegExp(req.folio) });
  await expect(row).toContainText('5000.00 EUR');
  await expect(row.getByRole('link', { name: 'Revisar y autorizar →' })).toBeVisible();

  await page.goto('/inicio');
  await page.getByRole('button', { name: 'Tablero por etapa' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Etapa Cotizada' })
      .getByRole('article', { name: new RegExp(req.folio) }),
  ).toBeVisible();
  await ctx.close();

  const admCtx = await browser.newContext();
  await admCtx.addCookies([sysadmin.cookie]);
  const adm = await admCtx.newPage();
  await adm.goto('/administracion');
  const integrations = adm.getByRole('region', { name: 'Integraciones' });
  await expect(integrations.getByRole('listitem').filter({ hasText: 'Wissify' })).toContainText('Pendiente');
  await admCtx.close();
});
