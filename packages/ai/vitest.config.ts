import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { include: /\.[cm]?[jt]sx?$/ },
  test: {
    exclude: [...configDefaults.exclude, 'harness/**'],
    globals: true,
    clearMocks: true,
    silent: true,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
