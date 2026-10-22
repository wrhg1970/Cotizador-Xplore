import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Not env(): generate/build must work without a database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
