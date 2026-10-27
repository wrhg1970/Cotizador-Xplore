import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('"Mi trabajo" lists what is waiting on the user and links to it', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const folio = `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const req = await prisma.travelRequest.create({
    data: {
      folio,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Tablero Roma 2027',
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
  await page.goto('/');
  await expect(page).toHaveURL(/\/inicio$/);
  const row = page.getByRole('row').filter({ hasText: folio });
  await expect(row).toContainText('Tablero Roma 2027');
  await expect(page.getByRole('row', { name: `${office.code} · Oficina E2E` })).toHaveText(
    `${office.code} · Oficina E2E0010000`,
  );
  await row.getByRole('link', { name: 'Cotizar' }).click();
  await expect(page).toHaveURL(new RegExp(`/solicitudes/${req.id}$`));
  await ctx.close();
});

test('system admin changes a role policy and creates an office', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sofía');
  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/administracion');

  const limit = page.getByLabel('Tope de autorización en pesos');
  await limit.fill('750000');
  await limit.blur();
  await expect(page.getByRole('status')).toHaveText('Permisos de Autorizar viaje guardados');
  await expect(limit).toHaveValue('750000.00');
  // Restore: policies are global.
  await limit.fill('');
  await limit.blur();
  await expect(limit).toHaveValue('');

  const code = `E2E${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await page.getByLabel('Código').fill(code);
  await page.getByLabel('Nombre', { exact: true }).fill('Oficina Monterrey');
  await page.getByRole('button', { name: 'Agregar oficina' }).click();
  await expect(page.getByRole('status')).toHaveText(`Oficina ${code} creada`);
  await expect(page.getByText(`${code} · Oficina Monterrey`)).toBeVisible();
  await ctx.close();
});
