module.exports = {
    roots: ['src'],
    testPathIgnorePatterns: ['/node_modules/', 'dist'],
    clearMocks: true,
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['given2/setup'],
}
