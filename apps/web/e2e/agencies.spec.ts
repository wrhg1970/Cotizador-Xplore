import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('an EE system admin registers an agency with its domain, office and admin', async ({ browser }) => {
  const admin = await userWithSession((await newOffice()).id, 'SYSTEM_ADMIN', 'Sara Agencias');
  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  const tag = randomUUID().slice(0, 6);
  const domain = `viajes-${tag}.example`;

  await page.goto('/administracion');
  const section = page.getByRole('region', { name: 'Agencias' });
  await section.getByLabel('Nombre', { exact: true }).fill(`Viajes ${tag}`);
  await section.getByLabel('Código', { exact: true }).fill(`V${tag}`.toUpperCase());
  await section.getByLabel('Dominios de Google Workspace').fill(domain);
  await section.getByLabel('Primera oficina').fill('Matriz');
  await section.getByLabel('Código de oficina').fill('MTZ');
  await section.getByLabel('Administrador (correo)').fill(`ana@${domain}`);
  await section.getByLabel('Nombre del administrador').fill('Ana');
  await section.getByRole('button', { name: 'Crear agencia' }).click();
  await expect(section.getByRole('status')).toContainText('creada');
  await expect(section.getByRole('row').filter({ hasText: `Viajes ${tag}` })).toContainText('Activa');

  const created = await prisma.user.findUniqueOrThrow({
    where: { email: `ana@${domain}` },
    include: { agency: true, officeRoles: true },
  });
  expect(created.agency.allowedDomains).toEqual([domain]);
  expect(created.officeRoles.map((r) => r.role)).toEqual(['SYSTEM_ADMIN']);
  await ctx.close();
});

test('the agencies section is only for EE system admins', async ({ browser }) => {
  const agency = await prisma.agency.create({
    data: {
      code: `X${randomUUID().slice(0, 6)}`.toUpperCase(),
      name: 'Otra',
      allowedDomains: ['e2e.example'],
    },
  });
  const office = await newOffice(agency.id);
  const admin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Otro Admin', agency.id);
  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/administracion');
  await expect(page.getByRole('heading', { name: 'Marca de la agencia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agencias' })).toHaveCount(0);
  await ctx.close();
});
