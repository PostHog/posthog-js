'use server'

import { PostHog } from 'posthog-node'

const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_API_KEY!, {
    host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
})

export async function captureServerError() {
    await posthog.captureExceptionImmediate(new Error('Server Exception'), 'distinct_id')
}
