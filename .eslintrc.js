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
    extends: ['plugin:@typescript-eslint/recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
    rules: {
        'prettier/prettier': 'error',
        'no-unused-vars': ['error', { ignoreRestSiblings: true }],
        '@typescript-eslint/no-empty-function': 'off',
    },
    settings: {
        react: {
            version: '17.0',
        },
    },
}
