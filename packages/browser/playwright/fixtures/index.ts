import { PostHogConfig } from '../../src/types'
import { testIngestion } from './ingestion'
export const test = testIngestion
export { expect } from '@playwright/test'
export type { WindowWithPostHog } from './posthog'

export { NetworkPage } from './network'
export { PosthogPage } from './posthog'
export { EventsPage } from './events'
export { IngestionPage } from './ingestion'

export type StartOptions = {
    posthogOptions?: Partial<PostHogConfig>
    flagsOverrides?: Record<string, any>
    url?: string
}
