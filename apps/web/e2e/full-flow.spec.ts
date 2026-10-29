import { expect, type Browser, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

async function as(browser: Browser, cookie: Awaited<ReturnType<typeof userWithSession>>['cookie']) {
  const ctx = await browser.newContext();
  await ctx.addCookies([cookie]);
  return ctx.newPage();
}

/** The whole sale through the screens only: request → quote → authorization → send → won. */
test('full flow: login, quote, authorize, send and win', async ({ browser, page }) => {
  // Login: anonymous people land on the Google button (the Google exchange itself is covered by API tests).
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('link', { name: 'Entrar con Google' })).toHaveAttribute(
    'href',
    '/api/v1/auth/google/login',
  );

  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana Vende');
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Carlos Coordina');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique Cotiza');
  const approver = await userWithSession(office.id, 'APPROVER', 'Aurora Autoriza');

  // 1. Advisor captures and submits the request.
  const adv = await as(browser, advisor.cookie);
  await adv.goto('/solicitudes/nueva');
  await adv.getByLabel('Oficina solicitante *').selectOption({ label: office.name });
  await adv.getByLabel('Nombre del grupo *').fill('Flujo completo Madrid 2027');
  await adv.getByLabel('Ciudad destino *').fill('Madrid');
  await adv.getByLabel('País destino *').selectOption('ES');
  await adv.getByLabel('Fecha de salida *').fill('2027-06-01');
  await adv.getByLabel('Fecha de regreso *').fill('2027-06-10');
  await adv.getByLabel('Alumnos *').fill('10');
  await adv.getByRole('tab', { name: /Confirmación/ }).click();
  await adv.getByRole('button', { name: /Registrar solicitud/ }).click();
  await expect(adv.locator('.badge')).toHaveText('Por asignar');
  const requestUrl = adv.url();

  // 2. Coordinator assigns the quoter.
  const adm = await as(browser, admin.cookie);
  await adm.goto(requestUrl);
  await adm
    .getByRole('combobox', { name: 'Cotizador', exact: true })
    .selectOption({ label: 'Quique Cotiza' });
  await adm.getByRole('button', { name: 'Asignar' }).click();
  await expect(adm.locator('.badge')).toHaveText('En cotización');

  // 3. Quoter builds the scenario and sends it to authorization.
  const quo = await as(browser, quoter.cookie);
  await quo.goto(requestUrl);
  await quo.getByLabel('Nombre del escenario').fill('Opción 1');
  await quo.getByLabel('Moneda de venta').selectOption('EUR');
  await quo.getByRole('button', { name: 'Nuevo escenario' }).click();
  await expect(quo).toHaveURL(/\/cotizaciones\//); // a new scenario opens its sheet
  await quo.getByLabel('Costo 1', { exact: true }).fill('4100');
  await quo.getByLabel('% Comisión (sobre el precio final)').fill('18');
  await quo.getByLabel('Vigencia', { exact: true }).fill('2027-01-31');
  await quo.getByRole('button', { name: 'Guardar y calcular' }).click();
  const bar = quo.getByRole('region', { name: 'Totales del viaje' });
  await expect(bar).toContainText('Guardado');
  await expect(bar).toContainText('5000.00');
  await quo.getByRole('button', { name: 'Enviar a autorización' }).click();
  await expect(quo.locator('.badge')).toHaveText('En revisión');
  const quoteUrl = quo.url();

  // 4. Approver authorizes.
  const apr = await as(browser, approver.cookie);
  await apr.goto(quoteUrl);
  await apr.getByRole('button', { name: 'Autorizar viaje' }).click();
  await expect(apr.locator('.badge')).toHaveText('Aprobada');

  // 5. Quoter records the send.
  await quo.reload();
  await quo.getByLabel('Enviada a').fill('direccion@colegio.example');
  await quo.getByLabel('Medio').selectOption({ label: 'Correo' });
  await quo.getByRole('button', { name: 'Registrar envío al cliente' }).click();
  await expect(quo.locator('.badge')).toHaveText('Enviada');

  // 6. The school says yes.
  await quo.goto(requestUrl);
  await expect(quo.getByLabel('Propuesta aceptada')).toHaveValue(/.+/);
  await quo.getByRole('button', { name: 'Ganada' }).click();
  await expect(quo.locator('.badge')).toHaveText('Ganada');

  // The advisor sees it closed as won.
  await adv.reload();
  await expect(adv.locator('.badge')).toHaveText('Ganada');
});
