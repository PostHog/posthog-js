module.exports = {
    testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/react/', '/test_data/', '/testcafe/', '\\.d\\.ts$'],
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    setupFilesAfterEnv: ['./src/__tests__/setup.js'],
    modulePathIgnorePatterns: ['src/__tests__/setup.js', 'src/__tests__/helpers/'],
    clearMocks: true,
    testEnvironment: 'jsdom',
    prettierPath: null,
    moduleNameMapper: {
        '\\.css$': 'identity-obj-proxy',
        '^preact$': '<rootDir>/../../node_modules/.pnpm/preact@10.19.3/node_modules/preact/dist/preact.js',
        '^preact/hooks$': '<rootDir>/../../node_modules/.pnpm/preact@10.19.3/node_modules/preact/hooks/dist/hooks.js',
        '^preact/jsx-runtime$':
            '<rootDir>/../../node_modules/.pnpm/preact@10.19.3/node_modules/preact/jsx-runtime/dist/jsxRuntime.js',
        '^preact/test-utils$':
            '<rootDir>/../../node_modules/.pnpm/preact@10.19.3/node_modules/preact/test-utils/dist/testUtils.js',
        '^@testing-library/preact$':
            '<rootDir>/../../node_modules/.pnpm/@testing-library+preact@3.2.4_preact@10.19.3/node_modules/@testing-library/preact/dist/cjs/index.js',
    },
    transform: {
        '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: ['node_modules/(?!(@testing-library/preact|preact))'],
}
