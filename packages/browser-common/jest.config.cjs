module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.spec.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    module: 'CommonJS',
                    moduleResolution: 'node',
                    target: 'ES2022',
                    ignoreDeprecations: '6.0',
                    esModuleInterop: true,
                    verbatimModuleSyntax: false,
                },
            },
        ],
    },
}
