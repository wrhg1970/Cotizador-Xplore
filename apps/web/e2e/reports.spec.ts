import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('Reportes: KPI, tabs by office, country, supplier and month', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Olga');
  const supplier = `Escuela E2E ${randomUUID().slice(0, 4)}`;
  const today = new Date().toISOString().slice(0, 10);
  const trip = async (status: 'SUBMITTED' | 'WON' | 'LOST', countryCode: string) => {
    const r = await prisma.travelRequest.create({
      data: {
        folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
        officeId: office.id,
        requesterId: advisor.user.id,
        status: status === 'SUBMITTED' ? 'SUBMITTED' : 'SENT',
        groupName: 'Reportes E2E',
        city: 'Toronto',
        countryCode,
        departureDate: new Date(today),
        returnDate: new Date(today),
        participants: 10,
      },
    });
    if (status === 'SUBMITTED') return;
    const scenario = await prisma.quoteScenario.create({
      data: { requestId: r.id, name: 'Opción 1', createdById: advisor.user.id },
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
        createdById: advisor.user.id,
        lines: {
          create: [
            {
              position: 0,
              category: 'PER_PARTICIPANT',
              description: 'Curso',
              quantity: 1,
              unitCost: 20000,
              currency: 'MXN',
              costSource: supplier,
            },
          ],
        },
        deliveries: {
          create: {
            sentOn: new Date(today),
            channel: 'EMAIL',
            sentById: advisor.user.id,
            recipients: 'x@colegio.example',
          },
        },
      },
    });
    await prisma.travelRequest.update({
      where: { id: r.id },
      data:
        status === 'WON'
          ? { status: 'WON', wonVersionId: v.id, closedAt: new Date() }
          : { status: 'LOST', lostReason: 'Precio', closedAt: new Date() },
    });
  };
  await trip('WON', 'CA');
  await trip('LOST', 'US');
  await trip('SUBMITTED', 'CA');

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/reportes');
  await page.locator('select').and(page.getByLabel('Oficina')).selectOption(office.id);
  const kpis = page.getByRole('region', { name: 'Indicadores' });
  await expect(kpis).toContainText('Solicitudes3');
  await expect(kpis).toContainText('Vendidas1');
  await expect(kpis).toContainText('Conversión50%');
  await expect(kpis).toContainText('$200 mil');
  await expect(kpis).toContainText('Comisión');
  await expect(page.getByText('Perdidas: 1 (Precio 1)')).toBeVisible();

  await page.getByRole('tab', { name: 'Por país' }).click();
  await expect(page.getByRole('row', { name: /Canadá/ })).toContainText('$200,000');

  await page.getByRole('tab', { name: 'Por proveedor' }).click();
  await expect(page.getByRole('row', { name: new RegExp(supplier) })).toContainText('$200,000');

  await page.getByRole('tab', { name: 'Por fecha de salida' }).click();
  await expect(page.getByRole('img', { name: 'Solicitudes y vendidas por mes' })).toBeVisible();

  // A fixed later period leaves nothing to report.
  await page.getByLabel('Desde').fill('2035-01-01');
  await page.getByLabel('Hasta').fill('2035-12-31');
  await page.getByRole('tab', { name: 'Por oficina' }).click();
  await expect(page.getByText('Sin solicitudes en el periodo.')).toBeVisible();
  await ctx.close();
});

test('Reportes refuses roles without the executive view', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/reportes');
  await expect(page.getByText('Solo coordinadores, auditores y administradores')).toBeVisible();
  await ctx.close();
});
