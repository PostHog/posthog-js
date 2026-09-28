import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['harness/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
