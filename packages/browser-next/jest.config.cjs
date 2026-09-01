module.exports = {
    testEnvironment: 'node',
    maxWorkers: 1,
    testMatch: ['<rootDir>/tests/**/*.spec.ts'],
    moduleNameMapper: {
        '^@posthog/browser-common/tests/client-conformance$':
            '<rootDir>/../browser-common/tests/helpers/client-conformance.ts',
    },
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    module: 'CommonJS',
                    moduleResolution: 'node',
                    target: 'ES2022',
                    esModuleInterop: true,
                    verbatimModuleSyntax: false,
                },
            },
        ],
    },
}
