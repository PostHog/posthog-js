import Posthog from 'posthog-js'

// // OPTIONAL: As an optimisation, you can include the extra Recording code this way. If you don't use recordings, then you don't need this.
// import 'posthog-js/dist/recorder'

if (typeof window !== 'undefined') {
    // This ensures that as long as we are client-side, posthog is always ready
    Posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'http://localhost:8000',
    })
}

// We recommend wrapping Posthog like this so that you can ensure only calling it client-side
// like `posthog?.capture("event")` using optional chaining
export const posthog = typeof window !== 'undefined' ? Posthog : undefined
