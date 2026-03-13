import { defineConfig } from 'vitest/config'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Dynamically resolve package paths so config doesn't need updating on version bumps.
const preactMain = require.resolve('preact')
const preactRoot = path.resolve(preactMain, '../..')
const testingLibraryPreactMain = require.resolve('@testing-library/preact')
const testingLibraryPreactCjs = path.dirname(testingLibraryPreactMain)

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        setupFiles: ['./src/__tests__/setup.ts'],
        exclude: [
            '**/node_modules/**',
            '**/cypress/**',
            '**/react/**',
            '**/test_data/**',
            '**/testcafe/**',
            '**/playwright/**',
        ],
        alias: {
            '\\.css$': 'identity-obj-proxy',
            '^preact$': path.join(preactRoot, 'dist/preact.js'),
            '^preact/hooks$': path.join(preactRoot, 'hooks/dist/hooks.js'),
            '^preact/jsx-runtime$': path.join(preactRoot, 'jsx-runtime/dist/jsxRuntime.js'),
            '^preact/test-utils$': path.join(preactRoot, 'test-utils/dist/testUtils.js'),
            '^@testing-library/preact$': path.join(testingLibraryPreactCjs, 'index.js'),
        },
    },
})
