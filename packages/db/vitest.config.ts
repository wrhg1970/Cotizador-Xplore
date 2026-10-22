import { defineConfig } from 'vitest/config';

// Integration tests need a migrated PostgreSQL (DATABASE_URL).
export default defineConfig({ test: { fileParallelism: false } });
