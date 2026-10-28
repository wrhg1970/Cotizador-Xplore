import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, EE_AGENCY_ID } from '../src/index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL es obligatorio para las pruebas de integración');
const prisma = createPrismaClient(url);

afterAll(() => prisma.$disconnect());

describe('database (integration)', () => {
  it('enforces unique (user, office, role)', async () => {
    const suffix = crypto.randomUUID();
    const office = await prisma.office.create({
      data: { agencyId: EE_AGENCY_ID, code: `T-${suffix}`, name: 'Oficina prueba' },
    });
    const user = await prisma.user.create({
      data: { agencyId: EE_AGENCY_ID, email: `${suffix}@example.com`, name: 'Prueba' },
    });
    const data = { userId: user.id, officeId: office.id, role: 'QUOTER' as const };
    await prisma.userOfficeRole.create({ data });
    await expect(prisma.userOfficeRole.create({ data })).rejects.toThrow();
  });

  it("keeps office roles inside the user's agency", async () => {
    const suffix = crypto.randomUUID();
    const other = await prisma.agency.create({ data: { code: `A-${suffix}`, name: 'Otra agencia' } });
    const office = await prisma.office.create({ data: { agencyId: other.id, code: 'X', name: 'Ajena' } });
    const user = await prisma.user.create({
      data: { agencyId: EE_AGENCY_ID, email: `${suffix}@example.com`, name: 'EE' },
    });
    await expect(
      prisma.userOfficeRole.create({ data: { userId: user.id, officeId: office.id, role: 'QUOTER' } }),
    ).rejects.toThrow(/different agencies/);
  });

  it('audit log is append-only', async () => {
    const entry = await prisma.auditLog.create({
      data: { action: 'test.created', entityType: 'Test', entityId: 'x', correlationId: 'c-1' },
    });
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });
});
