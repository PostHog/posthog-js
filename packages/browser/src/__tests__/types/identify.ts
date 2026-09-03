import type { PostHog } from '@posthog/types'

declare const posthog: PostHog

posthog.identify('user-id')

// @ts-expect-error A distinct ID is required.
posthog.identify()
