module.exports = {
    env: {
        node: true,
        es2020: true,
    },
    rules: {
        'no-console': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-undef': 'off',
        'posthog-js/no-direct-undefined-check': 'off',
        'compat/compat': 'off',
    },
}
