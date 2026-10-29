import { expect, test } from '@playwright/test';
import { newOffice, prisma, userWithSession } from './seed';

test.afterAll(() => prisma.$disconnect());

test('requester builds the team and attaches a file', async ({ browser }) => {
  const office = await newOffice();
  const advisor = await userWithSession(office.id, 'ADVISOR', 'Ana');
  const colleague = await userWithSession(office.id, 'ADVISOR', 'Carlos');
  const quoter = await userWithSession(office.id, 'QUOTER', 'Quique');
  const req = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      officeId: office.id,
      requesterId: advisor.user.id,
      status: 'SUBMITTED',
      groupName: 'Equipo y archivos',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([advisor.cookie]);
  const page = await ctx.newPage();
  await page.goto(`/solicitudes/${req.id}`);
  await page.getByRole('tab', { name: 'Equipo' }).click();
  const team = page.getByRole('region', { name: 'Equipo' });
  await team
    .getByRole('combobox', { name: 'Ejecutivo comercial' })
    .selectOption({ label: colleague.user.name });
  await team.getByRole('checkbox', { name: quoter.user.name }).click();
  await expect(team.getByRole('checkbox', { name: quoter.user.name })).toBeChecked();
  await expect.poll(() => prisma.requestMember.count({ where: { requestId: req.id } })).toBe(2);

  await page.getByRole('tab', { name: 'Documentos' }).click();
  const files = page.getByRole('region', { name: 'Archivos' });
  await files.getByLabel(/Agregar archivo/).setInputFiles({
    name: 'carta.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n'),
  });
  await files.getByRole('button', { name: 'Subir' }).click();
  await expect(files.getByRole('link', { name: 'carta.pdf' })).toBeVisible();

  await files.getByLabel(/Agregar archivo/).setInputFiles({
    name: 'virus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]),
  });
  await files.getByRole('button', { name: 'Subir' }).click();
  await expect(files.getByRole('alert')).toContainText('Solo se aceptan');
  await ctx.close();
});
