import type { EmailReactRenderer } from './types'

// The specifier is not a string literal and the magic comments are kept by the build (rslib.config.ts),
// so bundlers don't pull @react-email/render into apps that never send react.
const REACT_RENDERER_PACKAGE = '@react-email/render'

export function importReactRenderer(): Promise<EmailReactRenderer> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ REACT_RENDERER_PACKAGE)
}
