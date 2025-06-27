module.exports = {
  overrides: [
    {
      files: 'src/optional/**',
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
}
