/// <reference types="cypress" />

import { PostHog } from '../../src/posthog-core'
import { PostHogConfig } from '../../src/types'

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Cypress {
        interface Chainable {
            /**
             * Custom command to get PostHog from the window
             */
            posthog(): Chainable<PostHog>

            /**
             * Custom command to initialize PostHog
             */
            posthogInit(options: Partial<PostHogConfig>): void

            /**
             * custom command to get the events captured by posthog
             * @param options pass full to get the whole event, omit or false to get just the name
             */
            phCaptures(options?: { full: boolean }): Chainable<any[]>

            /**
             * custom command to reset the store of events captured by posthog
             */
            resetPhCaptures(): void
        }
    }
}
