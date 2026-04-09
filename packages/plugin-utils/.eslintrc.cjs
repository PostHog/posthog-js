module.exports = {
  ignorePatterns: ['dist/**/*', 'node_modules/**/*', 'coverage/**/*'],
  rules: {
    'posthog-js/no-direct-undefined-check': 'off',
    'compat/compat': 'off',
    'no-constant-condition': 'off',
  },
}
