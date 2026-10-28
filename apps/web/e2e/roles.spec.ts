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
  await row.getByText('1 oficina', { exact: true }).click();
  await row.getByRole('group', { name: 'Oficinas de Quique Oficinas' }).getByLabel(other.name).click();
  await expect(row.getByText('2 oficinas', { exact: true })).toBeVisible();
  const grants = await prisma.userOfficeRole.findMany({ where: { userId: quoter.user.id } });
  expect(grants.map((g) => g.officeId).sort()).toEqual([office.id, other.id].sort());
  await ctx.close();
});
