/** @type {import('jest').Config} */
export default {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.json',
            },
        ],
    },
}
