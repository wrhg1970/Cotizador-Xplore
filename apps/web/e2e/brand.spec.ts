import { expect, test } from '@playwright/test';
import { newAgency, newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test("an agency's system admin sets its brand and the menu shows it", async ({ browser }) => {
  const agency = await newAgency();
  const office = await newOffice(agency.id);
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sara Marca', agency.id);
  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();

  await page.goto('/administracion');
  const section = page.getByRole('region', { name: 'Marca de la agencia' });
  await section.getByLabel('Nombre que se muestra').fill('Viajes Marca E2E');
  await section
    .getByLabel('Pie de la propuesta (razón social, RNT, contacto)')
    .fill('Viajes Marca SA · RNT 1');
  const primary = section.getByRole('group', { name: 'Color principal' });
  await primary.getByLabel('Usar color propio').check();
  await primary.getByLabel('Color principal').fill('#123456');
  await section.getByRole('button', { name: 'Guardar marca' }).click();
  await expect(page.getByRole('status')).toContainText('Marca guardada');

  const saved = await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } });
  expect(saved).toMatchObject({ brandName: 'Viajes Marca E2E', primaryColor: '#123456' });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()),
    )
    .toBe('#123456');
  await ctx.close();
});
