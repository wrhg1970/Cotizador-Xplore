import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('Clientes: a school from requests gets its ficha, tabs and Wissify placeholder', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const school = `Colegio Ficha ${randomUUID().slice(0, 4)}`;
  await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      status: 'SENT',
      groupName: 'Canadá 2027',
      clientName: school,
      city: 'Toronto',
      countryCode: 'CA',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 24,
    },
  });
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/colegios?q=${encodeURIComponent(school)}`);
  await expect(page.getByRole('heading', { name: 'Clientes', level: 1 })).toBeVisible();
  await expect(page.getByText('Mostrando 1 de')).toBeVisible();
  await page.getByRole('link', { name: school }).click();

  await page.getByLabel('RFC').fill('cam850101ab1');
  await page.getByLabel('Ciudad').fill('Monterrey');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status')).toHaveText('Datos guardados');

  await page.getByRole('tab', { name: /Contactos/ }).click();
  await page.getByLabel('Nombre').fill('Laura Garza');
  await page.getByLabel('Cargo').fill('Coordinadora');
  await page.getByRole('button', { name: 'Agregar contacto' }).click();
  await expect(page.getByRole('cell', { name: /Laura Garza/ })).toBeVisible();

  await page.getByRole('tab', { name: /Viajes/ }).click();
  await expect(page.getByRole('cell', { name: 'Canadá 2027' })).toBeVisible();
  await page.getByRole('tab', { name: 'Wissify' }).click();
  await expect(page.getByLabel('Estado')).toHaveValue('Sin vincular');

  await page.getByRole('link', { name: '← Clientes' }).click();
  await page.goto(`/colegios?q=${encodeURIComponent('CAM850101AB1')}`);
  await expect(page.getByRole('row', { name: new RegExp(school) })).toContainText('Laura Garza');
  await ctx.close();
});

test('Proveedores: list with filters, ficha with rates and usage', async ({ browser }) => {
  const office = await newOffice();
  const sysadmin = await userWithSession(office.id, 'SYSTEM_ADMIN', 'Sistemas');
  const name = `DMC Ficha ${randomUUID().slice(0, 4)}`;
  const ctx = await browser.newContext();
  await ctx.addCookies([sysadmin.cookie]);
  const page = await ctx.newPage();
  await page.goto('/proveedores');
  await page.getByRole('button', { name: '+ Nuevo proveedor' }).click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('País').fill('Canadá');
  await page.getByRole('button', { name: 'Crear proveedor' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  await page.getByRole('tab', { name: /Tarifas/ }).click();
  const form = page.getByRole('form', { name: `Nueva tarifa de ${name}` });
  await form.getByRole('textbox', { name: 'Concepto' }).fill('Hotel Toronto 4 noches');
  await form.getByLabel('Costo unitario').fill('412');
  await form.getByRole('button', { name: 'Agregar tarifa' }).click();
  await expect(page.getByRole('cell', { name: 'Hotel Toronto 4 noches', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Uso en cotizaciones/ }).click();
  await expect(page.getByText('Ninguna cotización de tus oficinas usa este proveedor.')).toBeVisible();

  await page.goto(`/proveedores?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Sin vincular');

  // Unused: the system admin deletes it after typing its name.
  await page.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('button', { name: 'Borrar definitivamente' })).toBeDisabled();
  await confirm.getByLabel('Escribe el nombre para confirmar').fill(name);
  await confirm.getByRole('button', { name: 'Borrar definitivamente' }).click();
  await expect(page).toHaveURL(/\/proveedores$/);
  await expect(page.getByRole('link', { name })).toHaveCount(0);
  await ctx.close();
});
