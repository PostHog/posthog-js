import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` }],
  },
  test: {
    globals: true,
    setupFiles: ['../../tooling/vitest/setup-fake-timers.ts'],
    // `performance.now` is not in vitest's default `toFake` set, and span ageing
    // and durations read it, so a test that advances timers must move it too.
    fakeTimers: {
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
        'performance',
      ],
    },
    clearMocks: true,
    silent: true,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
