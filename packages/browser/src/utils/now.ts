import { window } from '@posthog/browser-common/utils/globals'

// oxlint-disable-next-line compat/compat
export const now = (): number => (window?.performance?.now ? window.performance.now() : Date.now())
