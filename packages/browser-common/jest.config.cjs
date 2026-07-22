module.exports = {
    testEnvironment: 'node',
    maxWorkers: 1,
    testMatch: ['<rootDir>/tests/**/*.spec.ts'],
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
