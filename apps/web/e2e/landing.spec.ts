import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('anonymous visitors see the landing; signed-in people go to their work', async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/');
  await expect(anon.getByRole('heading', { level: 1 })).toContainText('propuesta autorizada');
  await expect(anon.getByRole('link', { name: 'Entrar con Google' })).toHaveAttribute(
    'href',
    '/api/v1/auth/google/login',
  );
  await expect(anon).toHaveURL(/\/$/);

  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/inicio$/);
  await ctx.close();
});
