export const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://bos_app:bos_app@localhost:5432/bos_test',
  DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://bos_admin:bos_admin@localhost:5432/bos_test',
  ENCRYPTION_KEY: 'test-encryption-key-test-encryption-key',
  APP_URL: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
};
