import { createPostHog } from '@posthog/next'

// Configure server-side PostHog once and import `getPostHog` everywhere.
// In a real app, also add `import 'server-only'` at the top of this module so
// accidentally importing it from a client component fails at build time.
// `getDistinctId` resolves identity from your auth session so server events
// and feature flags are attributed to the logged-in user instead of the
// client-provided (spoofable) cookie identity. This example has no real auth,
// so it falls back to the cookie identity by returning undefined.
export const { getPostHog } = createPostHog({
    getDistinctId: async () => undefined,
})
