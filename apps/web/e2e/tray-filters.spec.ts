import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('Propuestas enviadas and Aprobaciones filter like Cotizaciones', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const sent = async (groupName: string, assigneeId: string | null, versionStatus: 'SENT' | 'IN_REVIEW') => {
    const req = await prisma.travelRequest.create({
      data: {
        folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        officeId: office.id,
        requesterId: advisor.user.id,
        assigneeId,
        status: versionStatus === 'SENT' ? 'SENT' : 'QUOTING',
        groupName,
        city: 'Lisboa',
        countryCode: 'PT',
        departureDate: new Date('2099-03-19'),
        returnDate: new Date('2099-03-25'),
        participants: 10,
      },
    });
    const scenario = await prisma.quoteScenario.create({
      data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
    });
    const v = await prisma.quoteVersion.create({
      data: {
        scenarioId: scenario.id,
        number: 1,
        status: versionStatus,
        saleCurrency: 'MXN',
        participants: 10,
        chaperones: 1,
        staff: 0,
        createdById: quoter.user.id,
      },
    });
    if (versionStatus === 'SENT')
      await prisma.proposalDelivery.create({
        data: {
          versionId: v.id,
          sentById: quoter.user.id,
          recipients: 'colegio@e2e.example',
          channel: 'EMAIL',
          sentOn: new Date('2026-11-01'),
        },
      });
    return req;
  };
  const mine = await sent('Filtro Mío Lisboa', quoter.user.id, 'SENT');
  const other = await sent('Filtro Ajeno León', null, 'SENT');
  const review = await sent('Filtro Revisión', quoter.user.id, 'IN_REVIEW');

  const ctx = await browser.newContext();
  await ctx.addCookies([quoter.cookie]);
  const page = await ctx.newPage();
  await page.goto('/enviadas');
  const row = (folio: string) => page.getByRole('row').filter({ hasText: folio });
  await expect(row(mine.folio)).toBeVisible();
  await expect(row(other.folio)).toBeVisible();

  // Search ignores accents; "Filtros avanzados" shows the filters and counts the active ones.
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('leon');
  await page.getByRole('searchbox', { name: 'Buscar' }).press('Enter');
  await expect(row(other.folio)).toBeVisible();
  await expect(row(mine.folio)).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('');
  await expect(row(mine.folio)).toBeVisible();

  await page.getByRole('button', { name: 'Filtros avanzados' }).click();
  // The box follows the URL, so it ticks once the address changes.
  await page.getByLabel('Solo asignadas a mí').click();
  await expect(page.getByLabel('Solo asignadas a mí')).toBeChecked();
  await expect(row(mine.folio)).toBeVisible();
  await expect(row(other.folio)).toHaveCount(0);
  await expect(page).toHaveURL(/mias=1/);
  await page.getByLabel('Resultado').selectOption('LOST');
  await expect(page.getByText('Nada coincide con estos filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(row(other.folio)).toBeVisible();

  // Same bar in Aprobaciones, with its own filters; the URL keeps them on reload.
  await page.goto('/aprobaciones?mias=1');
  await expect(row(review.folio)).toBeVisible();
  await expect(page.getByLabel('Solo las que puedo dictaminar')).toBeVisible();
  await page.getByLabel('Estado').selectOption('APPROVED');
  await expect(row(review.folio)).toHaveCount(0);
  await ctx.close();
});
