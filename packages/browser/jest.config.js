module.exports = {
    testMatch: [
        '**/__tests__/**/*.test.[jt]s?(x)',
        '**/?(*.)+test.[jt]s?(x)',
        '**/functional_tests/**/*.test.[jt]s?(x)',
    ],
    testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/react/', '/test_data/', '/testcafe/'],
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    setupFilesAfterEnv: ['./src/__tests__/setup.js'],
    modulePathIgnorePatterns: ['src/__tests__/setup.js', 'src/__tests__/helpers/'],
    clearMocks: true,
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '\\.css$': 'identity-obj-proxy',
    },
}
