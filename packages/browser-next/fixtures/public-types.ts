import type { NewSessionInfo, NewSessionReason } from '@posthog/browser'

export const sessionReason = (session: NewSessionInfo): NewSessionReason => session.reason
