import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('the office admin reads the audit log of their office, filtered by record', async ({ browser }) => {
  const office = await newOffice();
  const admin = await userWithSession(office.id, 'OFFICE_ADMIN', 'Carla');
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      status: 'SUBMITTED',
      groupName: 'Bitácora Roma 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: advisor.user.id,
      action: 'request.submitted',
      entityType: 'TravelRequest',
      entityId: req.id,
      diff: { status: ['DRAFT', 'SUBMITTED'] },
      correlationId: 'e2e',
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([admin.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByRole('link', { name: /Bitácora detallada/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'Envió a cotización' });
  await expect(row).toContainText('Ana');
  await expect(row).toContainText(office.code);
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/solicitudes/${req.id}$`));
  await ctx.close();
});
