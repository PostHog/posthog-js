module.exports = {
    overrides: [
        {
            files: './src/**/*',
            rules: {
                'no-restricted-globals': ['error', 'document', 'window'],
            },
            parserOptions: {
                ecmaVersion: 2018,
                sourceType: 'module',
                project: true,
            },
        },
        {
            files: './src/__tests__/**/*',
            // the same set of config as in the root
            // but excluding the 'plugin:compat/recommended' rule
            // we don't mind using the latest features in our tests
            // extends: extend.filter((s) => s !== 'plugin:compat/recommended'),
            rules: {
                'no-console': 'off',
                'no-restricted-globals': 'off',
                'compat/compat': 'off',
                'posthog-js/no-direct-object-keys': 'off',
            },
        },
        {
            files: './playground/cypress/**/*',
            globals: {
                cy: true,
                Cypress: true,
            },
        },
        {
            files: './testcafe/**/*',
            globals: {
                __dirname: true,
                fixture: true,
            },
            env: {
                node: true,
            },
        },
        {
            files: './playwright/**/*',
            rules: {
                'posthog-js/no-direct-array-check': 'off',
                'posthog-js/no-direct-undefined-check': 'off',
                'posthog-js/no-direct-null-check': 'off',
                'posthog-js/no-direct-object-keys': 'off',
                '@typescript-eslint/naming-convention': 'off',
                'compat/compat': 'off',
                '@typescript-eslint/no-unsafe-function-type': 'off',
                'no-empty-pattern': 'off',
                '@typescript-eslint/no-empty-object-type': 'off',
            },
            env: {
                node: true,
            },
            parserOptions: {
                project: true,
            },
        },
        {
            files: './playwright/mock-server.mjs',
            rules: {
                'no-console': 'off',
            },
            env: {
                node: true,
            },
            parserOptions: {
                ecmaVersion: 2018,
                sourceType: 'module',
                project: true,
            },
        },
        {
            files: './playground/**/*',
            rules: {
                'no-console': 'off',
                '@typescript-eslint/no-require-imports': 'off',
                'no-undef': 'off',
                'posthog-js/no-direct-array-check': 'off',
                'posthog-js/no-direct-undefined-check': 'off',
                'posthog-js/no-direct-null-check': 'off',
            },
            env: {
                node: true,
            },
            parserOptions: {
                project: null,
            },
        },
    ],
    ignorePatterns: ['./playground/error-tracking/**/*'],
}
