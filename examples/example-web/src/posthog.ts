import PostHog from 'posthog-js-lite'

export const posthog = new PostHog('phc_FzKQvNvps9ZUTxF5KJR9jIKdGb4bq4HNBa9SRyAHi0C', {
  host: 'http://localhost:8000',
  flushAt: 10,
})
