import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Integration tests run against the real database in DATABASE_URL. They are kept separate from the
// unit suite so `npm run test` stays fast and works with no database (CI, fresh clone).
const config = defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // One shared database, and the tests are not order-independent, so do not parallelise files.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

export default config
