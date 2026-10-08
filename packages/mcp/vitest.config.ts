import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` }],
  },
  test: {
    globals: true,
    clearMocks: true,
    silent: true,
    exclude: [...configDefaults.exclude, 'harness/**', 'src/__tests__/test-utils/**'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
