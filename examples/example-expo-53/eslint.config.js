// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
    {
        ignores: ['dist/*', '**/metro.config.js', '**/eslint.config.js'],
    },
    expoConfig,
])
