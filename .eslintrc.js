/*eslint-env node */

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
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
        project: './tsconfig.json',
    },
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
    settings: {
        react: {
            version: '17.0',
        },
        'import/resolver': {
            node: {
                paths: ['eslint-rules'], // Add the directory containing your custom rules
                extensions: ['.js', '.jsx', '.ts', '.tsx'], // Ensure ESLint resolves both JS and TS files
            },
        },
    },
    overrides: [
        {
            files: 'src/**/*',
            rules: {
                ...rules,
                'no-restricted-globals': ['error', 'document', 'window'],
            },
        },
        {
            files: 'src/__tests__/**/*',
            // the same set of config as in the root
            // but excluding the 'plugin:compat/recommended' rule
            // we don't mind using the latest features in our tests
            extends: extend.filter((s) => s !== 'plugin:compat/recommended'),
            rules: {
                ...rules,
                'no-console': 'off',
                'no-restricted-globals': 'off',
                'compat/compat': 'off',
            },
            parserOptions: {
                project: './src/__tests__/tsconfig.json',
            },
        },
        {
            files: ['**/*.js'],
            parserOptions: {
                project: null, // <- prevents the TS parser from trying to parse it with type info
            },
            rules: {
                ...rules,
                '@typescript-eslint/naming-convention': 'off',
            },
        },
        {
            files: 'react/src/**/',
            extends: [...extend, 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
        },
        {
            files: 'eslint-rules/**/*',
            extends: ['eslint:recommended', 'prettier'],
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
        },
        {
            files: 'cypress/**/*',
            globals: {
                cy: true,
                Cypress: true,
            },
        },
        {
            files: 'testcafe/**/*',
            globals: {
                __dirname: true,
            },
        },
        {
            files: ['playwright/**/*.ts'],
            rules: {
                'posthog-js/no-direct-array-check': 'off',
                'posthog-js/no-direct-undefined-check': 'off',
                'posthog-js/no-direct-null-check': 'off',
                '@typescript-eslint/naming-convention': 'off',
            },
            parserOptions: {
                project: null,
            },
        },
        {
            files: ['react/**/*.ts'],
            rules: {
                'posthog-js/no-direct-null-check': 'off',
            },
        },
        {
            files: ['playground/**/*'],
            rules: {
                'no-console': 'off',
                '@typescript-eslint/no-require-imports': 'off',
                'no-undef': 'off',
            },
            env: {
                node: true,
            },
        },
    ],
    root: true,
    ignorePatterns: ['playground/error-tracking/**/*'],
}
