import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

/** Will, 2026-11-23: an approver corrects, signs and sends; a second approver completes it; approved ones are corrected into a new version. */
test('approver corrects a quote, signs it and a second approver authorizes it', async ({ browser }) => {
  const office = await newOffice();
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const aurora = await userWithSession(office.id, 'APPROVER', 'Aurora Autoriza');
  const beto = await userWithSession(office.id, 'APPROVER', 'Beto Autoriza');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      officeId: office.id,
      requesterId: quoter.user.id,
      assigneeId: quoter.user.id,
      status: 'QUOTING',
      groupName: 'Firmas 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-04-04'),
      participants: 10,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: req.id, name: 'Opción 1', createdById: quoter.user.id },
  });
  const version = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      saleCurrency: 'MXN',
      targetMarginRate: 0.18,
      participants: 10,
      chaperones: 0,
      staff: 0,
      validUntil: new Date('2026-12-31'),
      createdById: quoter.user.id,
      lines: {
        create: {
          position: 0,
          category: 'PER_PARTICIPANT',
          description: 'Precio neto',
          quantity: 1,
          unitCost: 41000,
          currency: 'MXN',
        },
      },
    },
  });
  const pageFor = async (cookie: typeof quoter.cookie) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([cookie]);
    return ctx.newPage();
  };

  const quo = await pageFor(quoter.cookie);
  await quo.goto(`/cotizaciones/${version.id}`);
  await quo.getByRole('tab', { name: 'Autorización' }).click();
  await quo.getByRole('button', { name: 'Enviar a autorización', exact: true }).click();
  await expect(quo.locator('.badge')).toHaveText('En revisión');

  // Aurora corrects it herself, then signs and sends it.
  const aur = await pageFor(aurora.cookie);
  await aur.goto(`/aprobaciones/${req.id}`);
  const card = aur.getByRole('region', { name: 'Opción 1 v1' });
  await expect(card.getByRole('button', { name: 'Devolver' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Rechazar' })).toHaveCount(0);
  aur.once('dialog', (d) => void d.accept('Ajusto el hotel'));
  await card.getByRole('button', { name: 'Corregir' }).click();
  await expect(aur).toHaveURL(new RegExp(`/cotizaciones/${version.id}`));
  await aur.getByRole('tab', { name: 'Autorización' }).click();
  await expect(aur.getByRole('button', { name: 'Devolver al cotizador' })).toBeVisible();
  await aur.getByRole('button', { name: 'Firmar y enviar a autorización' }).click();
  await expect(aur.locator('.badge')).toHaveText('En revisión');
  await expect(aur.getByRole('button', { name: 'Autorizar viaje' })).toHaveCount(0); // already signed

  // The tray shows the missing signature; Beto gives it.
  const bet = await pageFor(beto.cookie);
  await bet.goto('/aprobaciones');
  await expect(bet.getByRole('row', { name: new RegExp(req.folio) })).toContainText('Firmas 1/2');
  await bet.goto(`/aprobaciones/${req.id}`);
  const betCard = bet.getByRole('region', { name: 'Opción 1 v1' });
  await expect(betCard).toContainText('Aurora Autoriza (la preparó). Falta la firma de otro autorizador');
  await bet.screenshot({ path: 'test-results/firmas-dictaminar.png', fullPage: true });
  bet.once('dialog', (d) => void d.accept(''));
  await betCard.getByRole('button', { name: 'Aprobar v1' }).click();
  await expect(bet).toHaveURL(/\/solicitudes\//);

  // Approved: correcting it freezes v1 and opens v2 for Beto.
  await bet.goto(`/cotizaciones/${version.id}`);
  await bet.getByRole('tab', { name: 'Autorización' }).click();
  await bet.screenshot({ path: 'test-results/firmas-aprobada.png', fullPage: true });
  bet.once('dialog', (d) => void d.accept(''));
  await bet.getByRole('button', { name: 'Corregir' }).click();
  await expect(bet).not.toHaveURL(new RegExp(version.id));
  await expect(bet.locator('.badge')).toHaveText('Borrador');
  expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe(
    'SUPERSEDED',
  );
});
