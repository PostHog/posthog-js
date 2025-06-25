module.exports = {
  ignorePatterns: ['src/vendor/**/*'],
  overrides: [
    {
      files: ['src/**/*'],
      rules: {
        'posthog-js/no-direct-function-check': 'off',
        'compat/compat': 'off',
      },
    },
  ],
}
