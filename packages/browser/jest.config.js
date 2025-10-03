module.exports = {
    testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/react/', '/test_data/', '/testcafe/'],
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    setupFilesAfterEnv: ['./src/__tests__/setup.js'],
    modulePathIgnorePatterns: ['src/__tests__/setup.js', 'src/__tests__/helpers/'],
    clearMocks: true,
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '\\.css$': 'identity-obj-proxy',
        '^preact$': '<rootDir>/node_modules/preact/dist/preact.js',
        '^preact/hooks$': '<rootDir>/node_modules/preact/hooks/dist/hooks.js',
        '^preact/test-utils$': '<rootDir>/node_modules/preact/test-utils/dist/testUtils.js',
        '^preact/jsx-runtime$': '<rootDir>/node_modules/preact/jsx-runtime/dist/jsxRuntime.js',
        '^@testing-library/preact$': '<rootDir>/node_modules/@testing-library/preact/dist/cjs/index.js',
    },
    transformIgnorePatterns: ['node_modules/(?!(preact|@testing-library)/)'],
}
