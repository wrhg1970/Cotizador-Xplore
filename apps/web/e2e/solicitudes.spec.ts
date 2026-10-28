import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

const folio = () => `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

test('Solicitudes: stage tabs, search and Filas / Tarjetas / Kanban', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Carla Coordinadora');
  const base = {
    officeId: office.id,
    requesterId: admin.user.id,
    countryCode: 'US',
    departureDate: new Date('2027-07-01'),
    returnDate: new Date('2027-07-15'),
    participants: 25,
    chaperones: 2,
  };
  for (const [status, groupName, city] of [
    ['QUOTING', 'Inmersión Boston', 'Boston'],
    ['SENT', 'Campamento Vancouver', 'Vancouver'],
    ['LOST', 'Verano Londres', 'Londres'],
  ] as const)
    await prisma.travelRequest.create({
      data: {
        ...base,
        folio: folio(),
        status,
        groupName,
        city,
        ...(status === 'LOST' && { lostReason: 'Precio', closedAt: new Date() }),
      },
    });

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes?officeId=${office.id}`);
  await expect(page.getByRole('heading', { name: 'Expedientes (3)' })).toBeVisible();
  const row = page.getByRole('row', { name: /Inmersión Boston/ });
  await expect(row).toContainText('25 + 2 chap.');
  await expect(row).toContainText('01. Solicitada');
  await expect(row.getByRole('link', { name: 'Cotizar' })).toBeVisible();

  await page.getByRole('button', { name: 'Enviadas / negociación' }).click();
  await expect(page.getByRole('heading', { name: 'Expedientes (1)' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Campamento Vancouver/ })).toContainText('04. Enviada');

  await page.getByRole('button', { name: /^Todas/ }).click();
  // Each step builds on the URL the previous one left, so wait for it to land.
  await expect(page.getByRole('heading', { name: 'Expedientes (3)' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('londres');
  await page.getByRole('searchbox', { name: 'Buscar' }).press('Enter');
  await expect(page).toHaveURL(/q=londres/);
  await expect(page.getByRole('heading', { name: 'Expedientes (1)' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Buscar' }).fill('');
  await page.getByRole('searchbox', { name: 'Buscar' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Expedientes (3)' })).toBeVisible();
  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page).toHaveURL(/vista=KANBAN/);
  await expect(page.getByRole('region', { name: 'Etapa Cerrada' })).toContainText('Verano Londres');
  await expect(page.getByRole('region', { name: 'Etapa Enviada / negociación' })).toContainText('Vancouver');

  await page.getByRole('button', { name: 'Tarjetas' }).click();
  await expect(page.getByRole('article', { name: /Inmersión Boston/ })).toContainText('Boston, US');
  await ctx.close();
});

test('SuperAdmin views the app as another user, read only, and goes back', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Will Admin');
  await userWithSession(office.id, 'ADVISOR', 'Ana Asesora');

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/inicio');
  await page.getByText('Ver como…').click();
  await page.getByLabel('Simular usuario').selectOption({ label: 'Ana Asesora — Asesor (crea solicitudes)' });
  await expect(page.getByRole('status').filter({ hasText: 'Estás viendo la app como' })).toContainText(
    'Ana Asesora',
  );
  // The advisor's menu: no Administración.
  await expect(page.getByRole('navigation', { name: 'Principal' })).not.toContainText('Administración');
  await expect(page.getByText('Ver como…')).toHaveCount(0);

  await page.getByRole('button', { name: /Volver a mi usuario/ }).click();
  await expect(page.getByText('Estás viendo la app como')).toHaveCount(0);
  await expect(page.getByText('Ver como…')).toBeVisible();
  await ctx.close();
});
