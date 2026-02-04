/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path')

// Dynamically resolve package paths so config doesn't need updating on version bumps.
// We need explicit CJS paths because Jest doesn't handle ESM well without extra config.
// require.resolve returns the main entry point, so we navigate relative to that.
const preactMain = require.resolve('preact') // .../preact/dist/preact.js
const preactRoot = path.resolve(preactMain, '../..') // .../preact/

const testingLibraryPreactMain = require.resolve('@testing-library/preact') // .../dist/cjs/index.js
const testingLibraryPreactCjs = path.dirname(testingLibraryPreactMain) // .../dist/cjs/

module.exports = {
    testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/react/', '/test_data/', '/testcafe/'],
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    setupFilesAfterEnv: ['./src/__tests__/setup.js'],
    modulePathIgnorePatterns: ['src/__tests__/setup.js', 'src/__tests__/helpers/'],
    clearMocks: true,
    testEnvironment: 'jsdom',
    prettierPath: null,
    moduleNameMapper: {
        '\\.css$': 'identity-obj-proxy',
        '^preact$': path.join(preactRoot, 'dist/preact.js'),
        '^preact/hooks$': path.join(preactRoot, 'hooks/dist/hooks.js'),
        '^preact/jsx-runtime$': path.join(preactRoot, 'jsx-runtime/dist/jsxRuntime.js'),
        '^preact/test-utils$': path.join(preactRoot, 'test-utils/dist/testUtils.js'),
        '^@testing-library/preact$': path.join(testingLibraryPreactCjs, 'index.js'),
    },
    transform: {
        '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: ['/node_modules/(?!.*(query-selector-shadow-dom|@testing-library/preact|preact/))'],
}
