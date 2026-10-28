import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('sent proposals trace one row per delivery with recipient, channel and outcome', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2026-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'SENT',
      groupName: 'Inmersión Académica Boston & MIT',
      clientName: 'Colegio Altamira',
      contactName: 'Mtra. Laura Pineda',
      city: 'Boston',
      countryCode: 'US',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  for (const name of ['Opción 1', 'Opción 2', 'Opción 3']) {
    const scenario = await prisma.quoteScenario.create({
      data: { requestId: req.id, name, createdById: quoter.user.id },
    });
    await prisma.quoteVersion.create({
      data: {
        scenarioId: scenario.id,
        number: 1,
        status: 'SENT',
        saleCurrency: 'USD',
        targetMarginRate: 0.18,
        participants: 10,
        chaperones: 0,
        staff: 0,
        validUntil: new Date('2026-12-31'),
        createdById: quoter.user.id,
        deliveries: {
          create: {
            sentById: quoter.user.id,
            recipients: 'coordinacion.internacional@colegioaltamira.edu.mx',
            channel: 'EMAIL',
            sentOn: new Date('2026-10-22'),
          },
        },
      },
    });
  }

  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/enviadas');
  await expect(
    page.getByRole('heading', { name: 'Control de propuestas enviadas y aceptaciones' }),
  ).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(req.folio) });
  await expect(row).toContainText('Colegio Altamira — Inmersión Académica Boston & MIT');
  await expect(row).toContainText('v1 (3 esc.)');
  await expect(row).toContainText('Mtra. Laura Pineda');
  await expect(row).toContainText('coordinacion.internacional@colegioaltamira.edu.mx');
  await expect(row).toContainText('Correo electrónico (registro manual)');
  await expect(row).toContainText('En revisión con escuela');
  await page.getByRole('button', { name: 'Tarjetas comprimidas' }).click();
  await expect(page.getByRole('article', { name: req.folio })).toContainText('v1 (3 esc.)');
  await page.getByRole('article', { name: req.folio }).getByRole('link', { name: 'Ver detalle →' }).click();
  await expect(page).toHaveURL(new RegExp(`/solicitudes/${req.id}`));
  await ctx.close();
});
