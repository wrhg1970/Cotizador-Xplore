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
  const card = page.getByRole('article', { name: `${folio} Tablero Roma 2027` });
  await expect(card).toContainText('Etapa actual: 01. Solicitada');
  await expect(card).toContainText('Rol: Cotizador titular');
  await expect(card).toContainText('Requiere tu acción');
  await page.getByRole('button', { name: 'Comité / apoyo (0)' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: /^Mi turno hoy/ }).click();
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(folio.toLowerCase());
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Tarjetas comprimidas' }).click();
  await expect(card.getByText('Requiere tu acción')).toBeHidden();
  await expect(page.getByRole('row', { name: `${office.code} · Oficina E2E` })).toHaveText(
    `${office.code} · Oficina E2E0010000—`,
  );
  await card.getByRole('link', { name: 'Cotizar →' }).click();
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
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row).toContainText('Oficina Monterrey');

  // Edit, deactivate and, since it is empty, delete.
  await row.getByRole('button', { name: `Editar ${code}` }).click();
  const edit = page.locator('form').filter({ has: page.getByRole('button', { name: 'Guardar' }) });
  await edit.getByLabel('Nombre').fill('Monterrey Centro');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toHaveText(`Oficina ${code} guardada`);
  await expect(row).toContainText('Monterrey Centro');
  await row.getByRole('button', { name: `Desactivar ${code}` }).click();
  await expect(row).toContainText('Desactivada');
  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: `Borrar ${code}` }).click();
  await expect(page.getByRole('status')).toHaveText(`Oficina ${code} borrada`);
  await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
  await ctx.close();
});

test('executive dashboard: office admins see the indicators, advisors get no link', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Olga');
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/inicio');
  await expect(page.getByRole('link', { name: 'Mi trabajo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard ejecutivo' })).toHaveCount(0);
  await ctx.clearCookies();
  await ctx.addCookies([admin.cookie]);
  await page.goto('/inicio');
  await page.getByRole('link', { name: 'Dashboard ejecutivo' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard ejecutivo' })).toBeVisible();
  await expect(page.getByLabel('Indicadores')).toContainText('Conversión');
  await page.getByLabel('Creadas desde').fill('2020-01-01');
  await page.getByLabel('hasta', { exact: true }).fill('2020-12-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByLabel('Indicadores')).toContainText('Solicitudes0');
  await ctx.close();
});
