import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('admin publishes an official rate and the quoter prefills a quote with it', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sofía');
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/administracion');
  const form = page.getByRole('region', { name: 'Tipos de cambio oficiales' });
  await form.getByRole('combobox', { name: 'De', exact: true }).selectOption('USD');
  await form.getByRole('combobox', { name: 'A', exact: true }).selectOption('EUR');
  await form.getByLabel('Tipo de cambio', { exact: true }).fill('0.92');
  await form.getByLabel('Fecha', { exact: true }).fill('2026-10-28');
  await form.getByLabel('Fuente', { exact: true }).fill('BCE');
  await form.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByRole('status')).toHaveText('Tipo de cambio USD→EUR publicado');
  await expect(page.getByRole('table', { name: 'Tipos de cambio vigentes' })).toContainText('BCE');

  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Tipos oficiales',
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
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      saleCurrency: 'EUR',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: quoter.user.id,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Vuelo',
            quantity: 1,
            unitCost: 900,
            currency: 'USD',
          },
        ],
      },
    },
  });

  await ctx.clearCookies();
  await ctx.addCookies([quoter.cookie]);
  await page.goto(`/cotizaciones/${v.id}`);
  await page.getByRole('button', { name: 'Usar tipos de cambio oficiales' }).click();
  await expect(page.getByLabel('Tipo de cambio', { exact: true })).toHaveValue('0.92');
  await expect(page.getByLabel('Fuente', { exact: true })).toHaveValue('Tabla oficial EE · BCE');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect
    .poll(async () => (await prisma.quoteFxRate.findFirst({ where: { versionId: v.id } }))?.source)
    .toBe('Tabla oficial EE · BCE');
  await ctx.close();
});

test('the request form keeps the trip specifications', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/solicitudes/nueva');
  await page.getByRole('combobox', { name: 'Oficina solicitante *', exact: true }).selectOption(office.id);
  await page.getByLabel('Nombre del grupo *').fill('Especificaciones 2027');
  await page.getByLabel('Ciudad destino *').fill('Dublín');
  await page.getByRole('combobox', { name: 'País' }).selectOption('IE');
  await page.getByLabel('Fecha de salida *').fill('2027-07-01');
  await page.getByLabel('Fecha de regreso *').fill('2027-07-21');
  await page.getByLabel('Alumnos *').fill('15');
  await page.getByRole('button', { name: 'Siguiente paso' }).click();
  await page.getByLabel('Tipo de alojamiento').fill('Familias anfitrionas');
  await page.getByLabel('Agregar a servicios no incluidos').fill('Vuelos internacionales');
  await page.getByRole('button', { name: 'Agregar', exact: true }).nth(1).click();
  await page.getByLabel('Nombre del campo').fill('Rango de edad');
  await page.getByLabel('Valor del campo').fill('14 a 18 años');
  await page.getByRole('button', { name: '+ Añadir campo' }).click();
  await page.getByRole('button', { name: 'Siguiente paso' }).click();
  await page.getByRole('button', { name: /Registrar solicitud/ }).click();
  await expect(page.getByRole('heading', { name: 'Especificaciones del viaje' })).toBeVisible();
  await expect(page.getByText('Familias anfitrionas')).toBeVisible();
  await expect(page.getByText('Vuelos internacionales')).toBeVisible();
  await expect(page.getByText('Rango de edad: 14 a 18 años')).toBeVisible();
  await ctx.close();
});

test('a hand-typed rate is saved for the missing currency and survives a reload', async ({ browser }) => {
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
      groupName: 'Tipo manual',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByLabel('Nombre del escenario').fill('Opción 1');
  await page.getByLabel('Moneda de venta').selectOption('EUR');
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await expect(page).toHaveURL(/\/cotizaciones\//); // the first scenario opens its sheet
  await page.getByLabel('Moneda 1', { exact: true }).selectOption('USD');
  await page.getByLabel('Costo 1', { exact: true }).fill('1000');
  const bar = page.getByRole('region', { name: 'Totales del viaje' });
  await expect(bar).toContainText('Falta tipo de cambio USD → EUR');

  // "Agregar" proposes the missing currency with a source, so the save is accepted.
  await page.getByRole('button', { name: 'Agregar tipo de cambio' }).click();
  await expect(page.getByRole('combobox', { name: 'De', exact: true })).toHaveValue('USD');
  await page.getByLabel('Tipo de cambio', { exact: true }).fill('0.9');
  await expect(bar).toContainText('900.00');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect(bar).toContainText('Guardado');

  await page.reload();
  await expect(page.getByLabel('Tipo de cambio', { exact: true })).toHaveValue('0.9');
  await expect(page.getByLabel('Fuente', { exact: true })).toHaveValue('Captura manual');
  await ctx.close();
});
