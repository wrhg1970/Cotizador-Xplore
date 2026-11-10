import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

// Will, 2026-11-10: narrow columns, zero concepts hidden, differences vs the approved (or first) scenario.
test('scenario comparison highlights differences and hides zero concepts', async ({ browser }) => {
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
      participants: 12,
      staff: 1,
      chaperones: 2,
    },
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByLabel('Nombre del escenario').fill('Opción 1');
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await expect(page).toHaveURL(/\/cotizaciones\//);
  const costs: [string, number, string][] = [
    ['Conceptos por estudiante', 1, '2404'],
    ['Conceptos por estudiante', 4, '50'],
    ['Conceptos por estudiante', 8, '40'],
    ['Chaperones EE', 14, '30'],
  ];
  for (const [block, i, cost] of costs) {
    await page.getByRole('tab', { name: block }).click();
    await page.getByLabel(`Costo ${i}`, { exact: true }).fill(cost);
  }
  await page.getByLabel('% Comisión (sobre el precio final)').fill('15');
  await page.getByLabel('Tipo de cambio a MXN (aproximado)').fill('21');
  await page.getByRole('button', { name: 'Guardar y calcular' }).click();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  for (const [name, neto] of <[string, string][]>[
    ['Opción 1 (+5 est.)', '2300'],
    ['Opción 2', '2404'],
  ]) {
    await page.goto(`/solicitudes/${req.id}`);
    page.once('dialog', (d) => d.accept(name));
    await page.getByRole('button', { name: 'Duplicar' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${name} · v1`);
    await page.getByRole('tab', { name: 'Conceptos por estudiante' }).click();
    await page.getByLabel('Costo 1', { exact: true }).fill(neto);
    if (name === 'Opción 2') await page.getByLabel('% Comisión (sobre el precio final)').fill('18');
    await page.getByRole('button', { name: 'Guardar y calcular' }).click();
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  }
  await page.goto(`/solicitudes/${req.id}`);
  const cmp = page.getByRole('table', { name: 'Comparar escenarios' });
  await expect(cmp.getByRole('row', { name: /^Precio neto/ })).toContainText('2,300.00−104.00');
  await expect(cmp.getByRole('row', { name: /^Precio \/ estudiante/ })).toContainText('3,099.00 EUR+109.00');
  await expect(cmp.getByRole('rowheader', { name: 'Transfer' })).toHaveCount(0);
  await expect(cmp.getByText('8 conceptos en 0 ocultos')).toBeVisible();
  await page.getByLabel('Ocultar conceptos en 0').uncheck();
  await expect(cmp.getByRole('rowheader', { name: 'Transfer' }).first()).toBeVisible();
  await page.getByLabel('Solo diferencias').check();
  await expect(cmp.getByRole('rowheader', { name: 'Kit EE' })).toHaveCount(0);
  await expect(cmp.getByRole('rowheader', { name: 'Precio neto' })).toBeVisible();
  await page.getByRole('button', { name: /Conceptos por estudiante/ }).click();
  await expect(cmp.getByRole('rowheader', { name: 'Precio neto' })).toHaveCount(0);
});
