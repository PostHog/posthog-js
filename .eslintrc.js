module.exports = {
    env: {
        browser: true,
        es6: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    plugins: ['prettier', '@typescript-eslint', 'eslint-plugin-react', 'eslint-plugin-react-hooks'],
    extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'prettier',
        'plugin:compat/recommended',
    ],
    rules: {
        'prettier/prettier': 'error',
        'prefer-spread': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
    },
    settings: {
        react: {
            version: '17.0',
        },
    },
    overrides: [
        {
            files: 'src/__tests__/**/*',
            // the same set of config as in the root
            // but excluding the 'plugin:compat/recommended' rule
            // we don't mind using the latest features in our tests
            extends: [
                'plugin:@typescript-eslint/recommended',
                'plugin:react/recommended',
                'plugin:react-hooks/recommended',
                'prettier',
            ],
        },
    ],
}
