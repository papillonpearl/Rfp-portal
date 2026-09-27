import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // `server-only` throws outside a React Server Component build; the
      // modules it guards are plain server code under test.
      'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    // Database tests share one database and truncate it, so files run one
    // at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://rfp:rfp@localhost:5432/rfp_test',
    },
  },
})
