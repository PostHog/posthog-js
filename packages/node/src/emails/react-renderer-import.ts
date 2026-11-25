import type { EmailReactRenderer } from './types'

const PACKAGE_HIDDEN_FROM_BUNDLERS = '@react-email/render'

export function importReactRenderer(): Promise<EmailReactRenderer> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ PACKAGE_HIDDEN_FROM_BUNDLERS)
}
