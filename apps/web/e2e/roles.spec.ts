import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('the system admin picks the offices a user works in', async ({ browser }) => {
  const office = await newOffice();
  const other = await prisma.office.update({
    where: { id: (await newOffice()).id },
    data: { name: `Oficina destino ${Date.now()}` },
  });
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sara');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique Oficinas');

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/administracion');
  await expect(page.getByRole('checkbox', { name: 'Crear: Asesor (crea solicitudes)' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Borrar (cancelar): Cotizador' })).not.toBeChecked();

  await page.goto('/usuarios');
  await page.getByRole('combobox', { name: 'Oficina', exact: true }).selectOption(office.id);
  const row = page.getByRole('row').filter({ hasText: 'Quique Oficinas' });
  await row.getByRole('button', { name: 'Editar Quique Oficinas' }).click();
  const offices = page.getByRole('group', { name: 'Oficinas de Quique Oficinas' });
  await offices.getByLabel(other.name).click();
  await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  const grants = await prisma.userOfficeRole.findMany({ where: { userId: quoter.user.id } });
  expect(grants.map((g) => g.officeId).sort()).toEqual([office.id, other.id].sort());

  // "Todas las oficinas" in one click, and back to just the office on screen.
  const all = offices.getByLabel('Todas las oficinas');
  await all.click();
  await expect(all).toBeChecked();
  await expect(offices.getByLabel(other.name)).toBeChecked();
  await all.click();
  await expect(row.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  const after = await prisma.userOfficeRole.findMany({ where: { userId: quoter.user.id } });
  expect(after.map((g) => g.officeId)).toEqual([office.id]);
  await ctx.close();
});
