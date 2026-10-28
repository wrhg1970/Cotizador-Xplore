import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Estudiantes Embajadores, created with this id by migration 20261028190000_agencies. */
export const EE_AGENCY_ID = '00000000-0000-4000-8000-0000000000ee';
