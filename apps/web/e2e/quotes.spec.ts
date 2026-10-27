import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('quoter builds Finance sheet "Opción 1" and duplicates it', async ({ browser }) => {
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
      groupName: 'Italia Spring Break 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-04-04'),
      participants: 10,
      staff: 2,
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByLabel('Nombre del escenario').fill('Opción 1');
  await page.getByLabel('Moneda de venta').selectOption('EUR');
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await page.getByRole('link', { name: 'Opción 1' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opción 1 · v1');

  // The scenario starts with the EE sheet's base concepts; fill Finance's "Opción 1" costs.
  await expect(page.getByLabel('Concepto 1', { exact: true })).toHaveValue('Precio neto');
  const costs: [number, string, string][] = [
    [1, 'Precio neto', '3900'],
    [4, 'Kit EE', '50'],
    [6, 'Promoción', '20'],
    [7, 'Costo envío de kits', '10'],
    [8, 'Operación', '40'],
    [14, 'Gastos por día', '50'],
    [17, 'Kit', '50'],
    [18, 'Fondo de emergencia', '150'],
  ];
  for (const [i, name, cost] of costs) {
    await expect(page.getByLabel(`Concepto ${i}`, { exact: true })).toHaveValue(name);
    await page.getByLabel(`Costo ${i}`, { exact: true }).fill(cost);
  }
  // Allowances start at the trip's days: return − departure + 1.
  await expect(page.getByLabel('Cantidad 14', { exact: true })).toHaveValue('17');
  await expect(page.getByText('este viaje: 17')).toBeVisible();
  await page.getByLabel('% Comisión (sobre el precio final)').fill('18');
  await page.getByLabel('Tipo de cambio a MXN (aproximado)').fill('20.39');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  // 4020 + (17 × 50 + 50) × 2 ÷ 10 + 150 ÷ 10 = 4215 → 4215 / 0.82 = 5140.24 → 5141
  const finalPrice = page.getByRole('row', { name: /PRECIO FINAL/ });
  await expect(finalPrice).toContainText('5141.00');
  await expect(page.getByRole('row', { name: /Gastos del líder/ })).toContainText('195.00');
  await expect(page.getByText('104825.00 MXN')).toBeVisible();

  // Typing the final price derives the %.
  await page.getByLabel('Precio final por estudiante').fill('5200');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect(finalPrice).toContainText('5200.00');
  await expect(page.getByLabel('% Comisión (sobre el precio final)')).toHaveValue('18.9423');

  // Proposal extras: 15% registration + 6 monthly payments, free places, itinerary, exclusions.
  await page.getByLabel('Ofrecer plan de pagos').check();
  await page.getByLabel('Tipo de inscripción').selectOption('rate');
  await page.getByLabel('1 lugar por cada (estudiantes)').fill('5');
  await page.getByRole('button', { name: 'Agregar día' }).click();
  await page.getByLabel('Título').fill('Llegada a Roma');
  await page.getByLabel('Un concepto por línea').fill('Vuelo internacional\nGastos personales');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  const schedule = page.getByRole('table', { name: 'Plan de pagos por estudiante' });
  await expect(schedule.getByRole('row', { name: /Inscripción/ })).toContainText('780.00'); // 15% of 5200
  await expect(schedule.getByRole('row', { name: /Pago 6 de 6/ })).toContainText('736.70');
  await expect(page.getByText('Lugares liberados: 2')).toBeVisible();

  await page.getByRole('link', { name: 'Ver propuesta para compartir' }).click();
  await expect(page.getByRole('heading', { name: 'Plan de pagos por estudiante' })).toBeVisible();
  await expect(page.getByText('Día 1: Llegada a Roma')).toBeVisible();
  await expect(page.getByText('Vuelo internacional')).toBeVisible();
  await page.goBack();

  page.once('dialog', (d) => d.accept('Italia base'));
  await page.getByRole('button', { name: 'Guardar como plantilla' }).click();
  await expect(page.getByText('Plantilla "Italia base" guardada para la oficina')).toBeVisible();

  await page.getByRole('link', { name: /Italia Spring Break 2027/ }).click();
  page.once('dialog', (d) => d.accept('Opción 2'));
  await page.getByRole('button', { name: 'Duplicar' }).click();
  await expect(page.getByRole('link', { name: 'Opción 2' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '5200.00 EUR' })).toHaveCount(2);

  // A new scenario from the template starts with its concepts and %.
  await page.getByLabel('Nombre del escenario').fill('Opción 3');
  await page.getByLabel('Empezar desde').selectOption({ label: 'Plantilla: Italia base' });
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await expect(page.getByRole('link', { name: 'Opción 3' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '5200.00 EUR' })).toHaveCount(3);

  // Advisors never see internal costs.
  const advCtx = await browser.newContext();
  await advCtx.addCookies([advisor.cookie]);
  const adv = await advCtx.newPage();
  await adv.goto(`/solicitudes/${req.id}`);
  await expect(adv.getByRole('heading', { name: 'Datos' })).toBeVisible();
  await expect(adv.getByRole('heading', { name: 'Escenarios' })).toHaveCount(0);
});
