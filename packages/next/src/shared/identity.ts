import { isUndefined, uuidv7 } from '@posthog/core'
import type { BootstrapConfig } from 'posthog-js'

export interface PostHogProviderIdentity {
    /** Server-known distinct ID to bootstrap the client SDK with. */
    distinctId: string
    /** Whether `distinctId` already identifies a known person profile. */
    isIdentified?: boolean
    /** Optional session ID to continue on the client. Must be a valid UUIDv7. */
    sessionId?: string
}

export function identityToBootstrap(identity?: PostHogProviderIdentity): BootstrapConfig | undefined {
    if (!identity?.distinctId) {
        return undefined
    }

    return {
        distinctID: identity.distinctId,
        ...(!isUndefined(identity.isIdentified) ? { isIdentifiedID: identity.isIdentified } : {}),
        ...(identity.sessionId ? { sessionID: identity.sessionId } : {}),
    }
}

/**
 * Generates a random anonymous distinct_id using UUIDv7.
 * Used as a fallback when no PostHog cookie is available.
 */
export function generateAnonymousId(): string {
    return uuidv7()
}
