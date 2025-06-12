/*eslint-env node */

module.exports = {
    settings: {
        react: {
            version: '17.0',
        },
    },
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
        project: true,
    },
    overrides: [
        {
            files: './src/**',
            extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
        },
        {
            files: ['./src/**/*.ts'],
            rules: {
                'posthog-js/no-direct-null-check': 'off',
            },
        },
    ],
}
