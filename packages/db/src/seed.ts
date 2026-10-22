import { createPrismaClient } from './index.js';

/** Bootstraps the first office and SYSTEM_ADMIN; idempotent. Real admin emails come from env, never fixtures. */
const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
};

const prisma = createPrismaClient(required('DATABASE_URL'));
try {
  const office = await prisma.office.upsert({
    where: { code: required('SEED_OFFICE_CODE') },
    update: {},
    create: { code: required('SEED_OFFICE_CODE'), name: required('SEED_OFFICE_NAME') },
  });
  const email = required('SEED_ADMIN_EMAIL').toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: required('SEED_ADMIN_NAME') },
  });
  await prisma.userOfficeRole.upsert({
    where: { userId_officeId_role: { userId: user.id, officeId: office.id, role: 'SYSTEM_ADMIN' } },
    update: {},
    create: { userId: user.id, officeId: office.id, role: 'SYSTEM_ADMIN' },
  });
  await prisma.auditLog.create({
    data: {
      action: 'seed.system_admin',
      entityType: 'User',
      entityId: user.id,
      correlationId: 'seed',
      diff: { officeId: office.id, role: 'SYSTEM_ADMIN' },
    },
  });
  console.log(`Administrador ${email} listo en oficina ${office.code}`);
} finally {
  await prisma.$disconnect();
}
