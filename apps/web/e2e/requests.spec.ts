import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('unauthenticated users are sent to login', async ({ page }) => {
  await page.goto('/solicitudes');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('link', { name: 'Entrar con Google' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('login errors are explained in Spanish', async ({ page }) => {
  await page.goto('/login?error=NOT_INVITED');
  await expect(page.locator('p[role=alert]')).toContainText('no ha sido invitada');
});

test('advisor creates and submits; admin assigns; quoter sees it in Mis tareas', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana Asesora');
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Carlos Coordinador');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique Cotizador');

  // Advisor
  const advCtx = await browser.newContext();
  await advCtx.addCookies([advisor.cookie]);
  const adv = await advCtx.newPage();
  await adv.goto('/solicitudes/nueva');
  await adv.getByLabel('Oficina').selectOption({ label: office.name });
  await adv.getByLabel('Nombre del grupo').fill('Verano Grupal UK 2027');
  await adv.getByLabel('Ciudad(es)').fill('Londres y Oxford');
  await expect(adv.getByLabel('País').locator('option', { hasText: 'Reino Unido' })).toHaveCount(1);
  await adv.getByLabel('País').selectOption('GB');
  await adv.getByLabel('Salida').fill('2027-07-01');
  await adv.getByLabel('Regreso').fill('2027-07-21');
  await adv.getByLabel('Participantes').fill('20');
  await adv.getByLabel('Chaperones').fill('2');
  await adv.getByLabel('El cliente indicó un presupuesto').check();
  await adv.getByLabel('Importe').fill('5150.00');
  await adv.getByLabel('Moneda').selectOption('GBP');
  await adv.getByRole('button', { name: 'Guardar borrador' }).click();

  await expect(adv.getByRole('heading', { level: 1 })).toContainText('Verano Grupal UK 2027');
  await expect(adv.locator('.badge')).toHaveText('Borrador');
  const folio = (await adv.getByRole('heading', { level: 1 }).textContent())!.split(' · ')[0]!;
  expect(folio).toMatch(/^EE-\d{4}-/);
  await expect(adv.getByText('5150.00 GBP por participante')).toBeVisible();

  await adv.getByRole('button', { name: 'Enviar a cotización' }).click();
  await expect(adv.locator('.badge')).toHaveText('Por asignar');
  const url = adv.url();

  // Office admin assigns
  const admCtx = await browser.newContext();
  await admCtx.addCookies([admin.cookie]);
  const adm = await admCtx.newPage();
  await adm.goto(url);
  await expect(
    adm
      .getByRole('combobox', { name: 'Cotizador', exact: true })
      .locator('option', { hasText: 'Quique Cotizador' }),
  ).toHaveCount(1);
  await adm
    .getByRole('combobox', { name: 'Cotizador', exact: true })
    .selectOption({ label: 'Quique Cotizador' });
  await adm.getByRole('button', { name: 'Asignar' }).click();
  await expect(adm.locator('.badge')).toHaveText('En cotización');
  await expect(adm.getByText('Asignó cotizador · Carlos Coordinador')).toBeVisible();

  // Quoter inbox
  const quoCtx = await browser.newContext();
  await quoCtx.addCookies([quoter.cookie]);
  const quo = await quoCtx.newPage();
  await quo.goto('/solicitudes?assignedToMe=true');
  await expect(quo.getByRole('heading', { name: 'Mis tareas' })).toBeVisible();
  await expect(quo.getByRole('link', { name: folio })).toBeVisible();

  // Advisor of the same office can't assign (no picker shown).
  await adv.reload();
  await expect(adv.getByRole('combobox', { name: 'Cotizador', exact: true })).toHaveCount(0);
});

test('server-side validation errors are shown on the form', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/solicitudes/nueva');
  await page.getByLabel('Oficina').selectOption({ label: office.name });
  await page.getByLabel('Nombre del grupo').fill('Grupo');
  await page.getByLabel('Ciudad(es)').fill('Madrid');
  await page.getByLabel('País').selectOption('ES');
  await page.getByLabel('Salida').fill('2027-07-21');
  await page.getByLabel('Regreso').fill('2027-07-01');
  await page.getByLabel('Participantes').fill('10');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('El regreso no puede ser anterior a la salida');
});
