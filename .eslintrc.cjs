// https://eslint.org/docs/v8.x/use/configure/configuration-files
const rules = {
    'prettier/prettier': 'error',
    'prefer-spread': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error'],
    '@typescript-eslint/no-unused-expressions': 'off',
    'no-prototype-builtins': 'off',
    'no-empty': 'off',
    'no-console': 'error',
    'no-only-tests/no-only-tests': 'error',
    'posthog-js/no-external-replay-imports': 'error',
    '@typescript-eslint/naming-convention': [
        'error',
        {
            selector: ['memberLike'],
            modifiers: ['private'],
            format: null,
            leadingUnderscore: 'require',
        },
    ],
    'no-restricted-imports': [
        'error',
        {
            patterns: [
                {
                    group: ['@posthog/core/*'],
                    message: 'Do not import from subpaths of "@posthog/core". Use "@posthog/core" instead.',
                },
            ],
        },
    ],
}

const extend = [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
    'plugin:compat/recommended',
    'plugin:posthog-js/all',
]

module.exports = {
    root: true,
    env: {
        browser: true,
        es6: true,
        'jest/globals': true,
    },
    globals: {
        given: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
    },
    parser: '@typescript-eslint/parser',
    plugins: [
        'prettier',
        '@typescript-eslint',
        'eslint-plugin-react',
        'eslint-plugin-react-hooks',
        'jest',
        'no-only-tests',
    ],
    extends: extend,
    rules,
    overrides: [
        {
            files: ['rollup.config.*', '.eslintrc.*', 'jest.config.*', 'babel.config.*'],
            parserOptions: {
                project: null,
            },
            env: {
                node: true,
            },
        },
        {
            files: [
                'packages/core/**',
                'packages/nextjs-config/**',
                'packages/react-native/**',
                'packages/node/**',
                'packages/web/**',
                'examples/**',
            ],
            rules: {
                'no-console': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                '@typescript-eslint/naming-convention': 'off',
                'posthog-js/no-direct-undefined-check': 'off',
                'posthog-js/no-direct-boolean-check': 'off',
                'posthog-js/no-direct-null-check': 'off',
                'posthog-js/no-direct-function-check': 'off',
                'posthog-js/no-direct-number-check': 'off',
                'posthog-js/no-direct-date-check': 'off',
                'posthog-js/no-direct-array-check': 'off',
                '@typescript-eslint/ban-ts-comment': 'off',
                'posthog-js/no-add-event-listener': 'off',
                'no-constant-condition': 'off',
                'compat/compat': 'off',
            },
        },
    ],
    ignorePatterns: ['node_modules', 'dist'],
}
