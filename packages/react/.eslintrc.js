/*eslint-env node */

module.exports = {
    overrides: [
        {
            files: './src/**',
            extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
            parserOptions: {
                ecmaVersion: 2018,
                sourceType: 'module',
                project: true,
            },
            settings: {
                react: {
                    version: '17.0',
                },
            },
        },
        {
            files: ['./src/**/*.ts'],
            rules: {
                'posthog-js/no-direct-null-check': 'off',
            },
        },
    ],
}
