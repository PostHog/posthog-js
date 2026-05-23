import { PostHog } from '@posthog/convex'
import { components } from './_generated/api'

// Credentials (`POSTHOG_TOKEN`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`) are declared on the
// component in `convex.config.ts` and read inside its actions — they don't get configured here.
// Use this place for callbacks: identifying the current user, redacting events, etc.
export const posthog = new PostHog(components.posthog, {
    // Automatically resolve the current user's identity from Convex auth.
    // Falls back to an explicit distinctId if the user is not signed in.
    identify: async (ctx) => {
        const identity = await ctx.auth?.getUserIdentity()
        if (!identity) return null
        return { distinctId: identity.subject }
    },
    beforeSend: (event) => {
        return {
            ...event,
            properties: {
                ...event.properties,
                environment: 'example-app',
            },
        }
    },
})
