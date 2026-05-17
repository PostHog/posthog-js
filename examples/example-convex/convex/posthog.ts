import { PostHog } from '@posthog/convex'
import { components } from './_generated/api'

// Read all three keys here, in the parent-app context, where `process.env` is populated.
// The PostHog component itself runs in an isolated env namespace and can't see these — the client
// captures them at construction time and forwards them whenever a component action needs them
// (e.g. inside `posthog.refreshFlagDefinitions(ctx)` from `crons.ts`).
export const posthog = new PostHog(components.posthog, {
    apiKey: process.env.POSTHOG_API_KEY,
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
    host: process.env.POSTHOG_HOST,

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
