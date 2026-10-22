import { expect, test } from '@playwright/test';

test('home loads in Spanish', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cotizador de Estudiantes Embajadores');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});
