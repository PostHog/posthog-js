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
        'react/jsx-uses-vars': 1,
    },
}
