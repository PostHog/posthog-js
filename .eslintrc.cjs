// https://eslint.org/docs/v8.x/use/configure/configuration-files
const rules = {
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
    '@vitest/expect-expect': 'off',
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
}

const extend = [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:compat/recommended',
    'plugin:posthog-js/all',
]

module.exports = {
    root: true,
    env: {
        browser: true,
        es6: true,
    },
    globals: {
        given: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
    },
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint',
        'eslint-plugin-react',
        'eslint-plugin-react-hooks',
        '@vitest',
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
                'packages/nuxt/**',
                'packages/react-native/**',
                'packages/node/**',
                'packages/web/**',
                'packages/webpack-plugin/**',
                'packages/rollup-plugin/**',
                'examples/**',
                'playground/**',
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
    ignorePatterns: ['node_modules', 'dist', 'next-env.d.ts', '.next', 'packages/browser/playground/hydration/vendor'],
}
