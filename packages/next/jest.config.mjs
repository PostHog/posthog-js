/** @type {import('jest').Config} */
export default {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    clearMocks: true,
    setupFilesAfterEnv: ['./tests/setup.ts'],
}
