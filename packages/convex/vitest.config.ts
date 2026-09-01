import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // Exercise workspace dependency sources without requiring their dist artifacts.
      {
        find: '@posthog/core',
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
      {
        find: /^@\/(.*)$/,
        replacement: `${fileURLToPath(new URL('../core/src', import.meta.url))}/$1`,
      },
      {
        find: 'posthog-node/edge',
        replacement: fileURLToPath(new URL('../node/src/entrypoints/index.edge.ts', import.meta.url)),
      },
      // posthog-node's version module is generated at build time; resolve its package metadata in tests instead.
      {
        find: /^\.\/version$/,
        replacement: fileURLToPath(new URL('./test-support/posthog-node-version.ts', import.meta.url)),
      },
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      { find: '@posthog/convex/test', replacement: fileURLToPath(new URL('./src/test.ts', import.meta.url)) },
      {
        find: /^@posthog\/convex\/convex\.config(?:\.js)?$/,
        replacement: fileURLToPath(new URL('./dist/component/convex.config.js', import.meta.url)),
      },
      { find: '@posthog/convex', replacement: fileURLToPath(new URL('./src/client/index.ts', import.meta.url)) },
    ],
  },
  test: {
    globals: true,
    clearMocks: true,
    silent: true,
    include: ['src/**/*.test.ts', '../../examples/example-convex/convex/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/test.ts'],
    setupFiles: ['../../tooling/vitest/setup-fake-timers.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
