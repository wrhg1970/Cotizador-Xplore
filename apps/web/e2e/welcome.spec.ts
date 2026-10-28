import { expect, test } from '@playwright/test';
import { newOffice, userWithSession } from './seed';

test('first visit shows the tour for the person’s roles once; the guide lists every role', async ({
  browser,
}) => {
  const office = await newOffice();
  const quoter = await userWithSession(office.id, 'QUOTER', 'Carla Cotiza');
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();

  await page.goto('/inicio');
  const tour = page.getByRole('dialog', { name: 'Como cotizador' });
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Enviar a autorización');
  await tour.getByRole('button', { name: 'Empezar' }).click();
  await expect(tour).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: /Carla/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('link', { name: 'Ayuda' }).click();
  await expect(page.getByRole('heading', { name: 'Guía de uso' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Cotizador/ })).toContainText('Tu rol');
  for (const name of ['Vendedor / asesor', 'Aprobador', 'Finanzas / auditor']) {
    await expect(page.getByRole('heading', { name: new RegExp(name.replace('/', '\\/')) })).toBeVisible();
  }
  await ctx.close();
});
