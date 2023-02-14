// Importing the "full" version includes extra code like Session Recording, avoiding the delayed loading at runtime
import Posthog from 'posthog-js/full'

// If you do not need Recordings, or are happy for it to be loaded at runtime you can simply use:
// import Posthog from 'posthog-js'

if (typeof window !== 'undefined') {
    // This ensures that as long as we are client-side, posthog is always ready
    // NOTE: If set as an environment variable be sure to prefix with `NEXT_PUBLIC_`
    // For more info see https://nextjs.org/docs/basic-features/environment-variables#exposing-environment-variables-to-the-browser
    Posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'http://localhost:8000',
    })
}

// We recommend wrapping Posthog like this so that you can ensure only calling it client-side
// like `posthog?.capture("event")` using optional chaining
export const posthog = typeof window !== 'undefined' ? Posthog : undefined
