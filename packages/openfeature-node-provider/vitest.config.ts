import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
})
