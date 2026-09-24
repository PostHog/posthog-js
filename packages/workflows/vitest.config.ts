import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        exclude: [...configDefaults.exclude, 'dist/**'],
        // The CLI tests spawn the built CLI, which transpiles each fixture with jiti on first load.
        testTimeout: 30_000,
    },
})
