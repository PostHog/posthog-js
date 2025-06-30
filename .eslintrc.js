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
            files: ['rollup.config.js', '.eslintrc.js', 'jest.config.js'],
            parserOptions: {
                project: null,
            },
            env: {
                node: true,
            },
        },
    ],
    ignorePatterns: ['node_modules', 'dist'],
}
