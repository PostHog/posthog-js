module.exports = {
  ignorePatterns: ['src/vendor/**/*', 'dist/**/*', 'node_modules/**/*', 'coverage/**/*'],
  rules: {
    // This is where objectKeys is defined, so we need to use Object.keys here
    'posthog-js/no-direct-object-keys': 'off',
  },
}
