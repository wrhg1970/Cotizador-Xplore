import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createPrismaClient, type Role } from '@ee/db';

export const prisma = createPrismaClient(process.env.DATABASE_URL!);

/** Creates an ACTIVE user with a live session; Google login itself is covered by API tests. */
export async function userWithSession(officeId: string, role: Role, name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@e2e.example`,
      name,
      status: 'ACTIVE',
      officeRoles: { create: { officeId, role } },
    },
  });
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { user, cookie: { name: 'ee_session', value: token, domain: 'localhost', path: '/' } };
}

export const newOffice = () =>
  prisma.office.create({
    data: { code: `E2E-${randomUUID().slice(0, 6)}`.toUpperCase(), name: `Oficina E2E` },
  });
