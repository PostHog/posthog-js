import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: `${fileURLToPath(new URL('../core/src', import.meta.url))}/$1`,
      },
      {
        find: '@posthog/core/testing',
        replacement: fileURLToPath(new URL('../core/src/testing/index.ts', import.meta.url)),
      },
      { find: '@posthog/core', replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
