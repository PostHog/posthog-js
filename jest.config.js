module.exports = {
    testPathIgnorePatterns: ['/node_modules/', '/cypress/', '/react/', '/test_data/'],
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    setupFilesAfterEnv: ['given2/setup', './src/__tests__/setup.js'],
    modulePathIgnorePatterns: ['src/__tests__/setup.js'],
    clearMocks: true,
    testEnvironment: 'jsdom',
}
