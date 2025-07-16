import { mergeTests } from '@playwright/test'
import { testPage } from './page'
import { testPostHog } from './posthog'
import { testEvents } from './events'
import { testNetwork } from './network'
import { testIngestion } from './ingestion'

export const test = mergeTests(testPage, testPostHog, testEvents, testNetwork, testIngestion)
export { expect } from '@playwright/test'
export type { WindowWithPostHog } from './posthog'
