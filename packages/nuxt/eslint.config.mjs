// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: true,
  },
  dirs: {
    src: ['./playground'],
  },
}).append({
  rules: {
    '@stylistic/brace-style': 'off',
    '@stylistic/operator-linebreak': 'off',
  },
})
