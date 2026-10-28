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
  await page.getByRole('combobox', { name: 'Oficina', exact: true }).selectOption(office.id);
  await page.getByLabel('Nombre del grupo').fill('Especificaciones 2027');
  await page.getByLabel('Ciudad(es)').fill('Dublín');
  await page.getByRole('combobox', { name: 'País' }).selectOption('IE');
  await page.getByLabel('Salida').fill('2027-07-01');
  await page.getByLabel('Regreso').fill('2027-07-21');
  await page.getByLabel('Participantes').fill('15');
  await page.getByText('Especificaciones del viaje').click();
  await page.getByLabel('Alojamiento').fill('Familias anfitrionas');
  await page.getByLabel('Servicios no incluidos').fill('Vuelos internacionales');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByRole('heading', { name: 'Especificaciones del viaje' })).toBeVisible();
  await expect(page.getByText('Familias anfitrionas')).toBeVisible();
  await expect(page.getByText('Vuelos internacionales')).toBeVisible();
  await ctx.close();
});
