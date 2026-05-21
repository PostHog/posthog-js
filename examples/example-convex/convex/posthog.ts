import { PostHog } from '@posthog/convex'
import { components } from './_generated/api'

// Configure once with your project credentials. The client captures these and forwards them to
// any component action that needs them — including the cron defined in `crons.ts`.
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
