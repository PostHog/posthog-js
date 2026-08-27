module.exports = {
    root: true,
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    env: {
        browser: true,
        es2020: true,
        node: true,
    },
    rules: {
        // Disable prettier - rrweb formatting is normalized separately
        'prettier/prettier': 'off',
        // Disable rules that conflict with rrweb's codebase
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        'no-prototype-builtins': 'off',
        'no-useless-escape': 'off',
        'no-empty': 'off',
        'prefer-const': 'off',
        'no-constant-condition': 'off',
        'no-extra-semi': 'off',
        'no-var': 'off',
        'no-global-assign': 'off',
        // posthog-js specific rules that don't apply to rrweb
        'posthog-js/no-direct-array-check': 'off',
        'posthog-js/no-direct-boolean-check': 'off',
        'posthog-js/no-direct-document-check': 'off',
        'posthog-js/no-direct-function-check': 'off',
        'posthog-js/no-direct-navigator-check': 'off',
        'posthog-js/no-direct-null-check': 'off',
        'posthog-js/no-direct-number-check': 'off',
        'posthog-js/no-direct-object-check': 'off',
        'posthog-js/no-direct-string-check': 'off',
        'posthog-js/no-direct-undefined-check': 'off',
        'posthog-js/no-direct-window-check': 'off',
        'compat/compat': 'off',
    },
    overrides: [
        {
            // The replayer rebuilds hosts with `createElement(tagName)`, so a host the
            // browser refuses raises NotSupportedError. In the full-snapshot rebuild that
            // is uncaught and ends playback; elsewhere it abandons the rest of the batch.
            files: ['*/src/**/*.ts'],
            excludedFiles: ['rrweb-snapshot/src/utils.ts', '**/*.spec.*', '**/*.test.*'],
            rules: {
                'no-restricted-syntax': [
                    'error',
                    {
                        selector:
                            "CallExpression[callee.property.name='attachShadow'][callee.object.type!='Super']",
                        message:
                            'Use `attachShadowRootSafely` from @posthog/rrweb-snapshot instead of calling attachShadow directly.',
                    },
                ],
            },
        },
    ],
    ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs', '*.mjs'],
}
