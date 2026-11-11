import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

// Will, 2026-11-11: rename a scenario in place from the scenario bar.
test('renames the current scenario from its tab: Enter saves, Esc cancels', async ({ browser }) => {
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
      returnDate: new Date('2027-03-28'),
      participants: 30,
      staff: 1,
      chaperones: 2,
    },
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByLabel('Nombre del escenario').fill('Opción 1');
  await page.getByRole('button', { name: 'Nuevo escenario' }).click();
  await expect(page).toHaveURL(/\/cotizaciones\//);

  const bar = page.getByRole('navigation', { name: 'Escenarios de la solicitud' });
  await expect(bar).toContainText('Opción 1');
  if (process.env.SHOTS)
    await page.locator('.scenario-bar').screenshot({ path: `${process.env.SHOTS}/1-barra.png` });

  await bar.getByRole('button', { name: 'Cambiar nombre del escenario' }).click();
  const input = bar.getByLabel('Nombre del escenario');
  await input.fill('Algo que no se guarda');
  await input.press('Escape');
  await expect(bar).toContainText('Opción 1');

  await bar.getByText('Opción 1').dblclick();
  await bar.getByLabel('Nombre del escenario').fill('Hotel céntrico con 2 museos');
  if (process.env.SHOTS)
    await page.locator('.scenario-bar').screenshot({ path: `${process.env.SHOTS}/2-editando.png` });
  await bar.getByLabel('Nombre del escenario').press('Enter');
  await expect(bar).toContainText('Hotel céntrico con 2 museos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hotel céntrico con 2 museos · v1');
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/3-guardado.png` });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hotel céntrico con 2 museos · v1');
  await page.goto(`/solicitudes/${req.id}`);
  await expect(page.getByText('Hotel céntrico con 2 museos').first()).toBeVisible();
  await ctx.close();
});
