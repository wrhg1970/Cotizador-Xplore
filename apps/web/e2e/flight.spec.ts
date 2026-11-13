import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('Avión: added to the course or shown apart in its own currency', async ({ browser }) => {
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
      groupName: 'Con avión',
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
      saleCurrency: 'CAD',
      targetMarginRate: '0.2',
      participants: 12,
      chaperones: 2,
      staff: 1,
      createdById: quoter.user.id,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Precio neto',
            quantity: 1,
            unitCost: 2400,
            currency: 'CAD',
          },
        ],
      },
      fxRates: {
        create: {
          fromCurrency: 'USD',
          toCurrency: 'CAD',
          rate: '1.36',
          rateDate: new Date('2026-11-11'),
          source: 'Manual',
          capturedById: quoter.user.id,
        },
      },
    },
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/cotizaciones/${v.id}`);
  await page.getByRole('tab', { name: /Avión/ }).click();
  await page.getByRole('button', { name: '+ Agregar avión' }).click();
  const panel = page.getByRole('tabpanel', { name: /Avión/ });
  await panel.getByLabel('Proveedor').fill('Aeroméxico');
  await panel.getByLabel('Precio neto por boleto').fill('480');
  await panel.getByLabel('Moneda del boleto').selectOption('USD');
  await panel.getByLabel(/Precio final por estudiante/).fill('650');
  // 12 students + 2 school + 1 EE = 15 tickets × 480 USD × 1.36.
  await expect(panel).toContainText('9,792.00 CAD');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();

  const box = page.getByRole('group', { name: 'Precio por estudiante y total del grupo' });
  // Course 2400 / 0.8 = 3000, plus 650 USD × 1.36 = 884 → 3884.
  await expect(box).toContainText('3,884.00 CAD');
  await expect(box).toContainText('Curso');
  await expect(box).toContainText('3,000.00 CAD');
  await expect(box).toContainText('884.00 CAD');
  await expect(page.getByRole('table', { name: 'Avión' })).toContainText('Costo aéreo del grupo');
  await expect(page.getByRole('table', { name: 'Avión' })).toContainText('Aeroméxico');

  await page.getByRole('tab', { name: /Avión/ }).click();
  await panel.getByRole('group', { name: 'Sumar al curso' }).getByRole('button', { name: 'No' }).click();
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect(box).toContainText('3,000.00 CAD');
  await expect(box).toContainText('Avión (aparte)');
  await expect(box).toContainText('650.00 USD');
  await expect(box).not.toContainText('3,884.00');
  await ctx.close();
});
