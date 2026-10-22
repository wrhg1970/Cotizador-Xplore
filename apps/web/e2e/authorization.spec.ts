import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('admin grants "Autorizar viaje"; legend shows until the trip is authorized', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Carla Coordinadora');
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const approver = await userWithSession(office.id, 'ADVISOR', 'Aurora Autoriza');

  // Admin gives Aurora the privilege and invites a new person with it.
  const admCtx = await browser.newContext();
  await admCtx.addCookies([admin.cookie]);
  const adm = await admCtx.newPage();
  await adm.goto('/usuarios');
  await adm.getByLabel('Agregar privilegio a Aurora Autoriza').selectOption({ label: 'Autorizar viaje' });
  await expect(adm.getByRole('row', { name: /Aurora Autoriza/ })).toContainText('Autorizar viaje');
  await adm.getByLabel('Nombre', { exact: true }).fill('Nuevo Autorizador');
  await adm.getByLabel('Correo de Google').fill(`${randomUUID()}@e2e.example`);
  await adm.getByLabel('Privilegio', { exact: true }).selectOption({ label: 'Autorizar viaje' });
  await adm.getByRole('button', { name: 'Invitar' }).click();
  await expect(adm.getByRole('row', { name: /Nuevo Autorizador/ })).toContainText('Autorizar viaje');

  // A ready version, built by the quoter.
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Italia Spring Break 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-04-04'),
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

  // Advisor shares before authorization: legend everywhere.
  const advCtx = await browser.newContext();
  await advCtx.addCookies([advisor.cookie]);
  const adv = await advCtx.newPage();
  await adv.goto(`/solicitudes/${req.id}`);
  await expect(adv.getByRole('cell', { name: 'VIAJE CON AUTORIZACIÓN PENDIENTE' })).toBeVisible();
  await adv.getByRole('link', { name: 'Opción 1 · v1' }).click();
  await expect(adv.getByText('VIAJE CON AUTORIZACIÓN PENDIENTE')).toHaveCount(2);
  await expect(adv.getByText('5000.00 EUR')).toBeVisible();

  // Quoter submits.
  const quoCtx = await browser.newContext();
  await quoCtx.addCookies([quoter.cookie]);
  const quo = await quoCtx.newPage();
  await quo.goto(`/cotizaciones/${version.id}`);
  await quo.getByRole('button', { name: 'Enviar a autorización' }).click();
  await expect(quo.locator('.badge')).toHaveText('En revisión');
  await expect(quo.getByRole('button', { name: 'Autorizar viaje' })).toHaveCount(0);

  // Approver authorizes.
  const aprCtx = await browser.newContext();
  await aprCtx.addCookies([approver.cookie]);
  const apr = await aprCtx.newPage();
  await apr.goto(`/cotizaciones/${version.id}`);
  await apr.getByRole('button', { name: 'Autorizar viaje' }).click();
  await expect(apr.locator('.badge')).toHaveText('Aprobada');
  await expect(apr.getByText('Autorizó · Aurora Autoriza')).toBeVisible();

  // Legend gone for the advisor.
  await adv.reload();
  await expect(adv.getByRole('heading', { name: 'Italia Spring Break 2027' })).toBeVisible();
  await expect(adv.getByText('VIAJE CON AUTORIZACIÓN PENDIENTE')).toHaveCount(0);

  // Quoter downloads the internal Excel and records the send.
  await quo.reload();
  const download = quo.waitForEvent('download');
  await quo.getByRole('link', { name: 'Descargar Excel interno' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await quo.getByLabel('Enviada a').fill('direccion@colegio.example');
  await quo.getByLabel('Medio').selectOption({ label: 'WhatsApp' });
  await quo.getByRole('button', { name: 'Registrar envío al cliente' }).click();
  await expect(quo.locator('.badge')).toHaveText('Enviada');
  await expect(quo.getByText(/por WhatsApp a direccion@colegio\.example · Quique/)).toBeVisible();
});
