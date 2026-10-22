import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL es obligatorio para las pruebas de integración');
const prisma = createPrismaClient(url);

afterAll(() => prisma.$disconnect());

describe('database (integration)', () => {
  it('enforces unique (user, office, role)', async () => {
    const suffix = crypto.randomUUID();
    const office = await prisma.office.create({ data: { code: `T-${suffix}`, name: 'Oficina prueba' } });
    const user = await prisma.user.create({ data: { email: `${suffix}@example.com`, name: 'Prueba' } });
    const data = { userId: user.id, officeId: office.id, role: 'QUOTER' as const };
    await prisma.userOfficeRole.create({ data });
    await expect(prisma.userOfficeRole.create({ data })).rejects.toThrow();
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
