module.exports = {
  overrides: [
    {
      files: ['src/**/*'],
      rules: {
        'posthog-js/no-direct-function-check': 'off',
        'compat/compat': 'off',
      },
    },
  ],
  ignorePatterns: ['src/vendor/**/*', 'dist/**/*', 'node_modules/**/*', 'coverage/**/*'],
}
