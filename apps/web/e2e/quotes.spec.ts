import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('quoter builds Finance sheet "Opción 1" and duplicates it', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Italia Spring Break 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-04-04'),
      participants: 10,
      staff: 2,
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByLabel('Nombre del escenario').fill('Opción 1');
  await page.getByLabel('Moneda de venta').selectOption('EUR');
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await page.getByRole('link', { name: 'Opción 1' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opción 1 · v1');

  const lines: [string, string, string, string][] = [
    ['PER_PARTICIPANT', 'Precio neto', '1', '3900'],
    ['PER_PARTICIPANT', 'Kit, promoción, envío y operación', '1', '120'],
    ['PER_STAFF', 'Viáticos', '16', '50'],
    ['PER_STAFF', 'Kit chaperón', '1', '50'],
    ['CONTINGENCY', 'Fondo de emergencia', '1', '150'],
  ];
  for (const [i, [cat, desc, qty, cost]] of lines.entries()) {
    await page.getByRole('button', { name: 'Agregar concepto' }).click();
    await page.getByLabel(`Tipo ${i + 1}`).selectOption(cat);
    await page.getByLabel(`Concepto ${i + 1}`).fill(desc);
    await page.getByLabel(`Cantidad ${i + 1}`).fill(qty);
    await page.getByLabel(`Costo ${i + 1}`).fill(cost);
  }
  await page.getByLabel('Margen sobre venta (%)').fill('18');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect(page.getByText('5128.05 EUR')).toBeVisible();

  await page.getByRole('link', { name: /Italia Spring Break 2027/ }).click();
  page.once('dialog', (d) => d.accept('Opción 2'));
  await page.getByRole('button', { name: 'Duplicar' }).click();
  await expect(page.getByRole('link', { name: 'Opción 2' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '5128.05 EUR' })).toHaveCount(2);

  // Advisors never see internal costs.
  const advCtx = await browser.newContext();
  await advCtx.addCookies([advisor.cookie]);
  const adv = await advCtx.newPage();
  await adv.goto(`/solicitudes/${req.id}`);
  await expect(adv.getByRole('heading', { name: 'Datos' })).toBeVisible();
  await expect(adv.getByRole('heading', { name: 'Escenarios' })).toHaveCount(0);
});
