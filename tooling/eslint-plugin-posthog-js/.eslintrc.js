/*eslint-env node */

module.exports = {
    extends: ['eslint:recommended', 'prettier'],
    parserOptions: {
        project: null,
    },
    rules: {
        'prettier/prettier': 'error',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        'posthog-js/no-direct-null-check': 'off',
        'posthog-js/no-direct-boolean-check': 'off',
    },
    env: {
        node: true,
    },
    overrides: [],
}
