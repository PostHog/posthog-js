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
    },
    transform: {
        '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: [
        'node_modules/(?:(?=\\.pnpm/).pnpm/[^/]+/node_modules/|(?!\\.pnpm/))(?!(sinon|@testing-library/preact|preact|until-async)/)',
    ],
}
