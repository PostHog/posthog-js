import { DecideResponse, PostHogConfig } from '../../src/types'

import { EventEmitter } from 'events'

export const start = ({
    waitForDecide = true,
    initPosthog = true,
    resetOnInit = false,
    options = {},
    decideResponseOverrides = {
        sessionRecording: undefined,
        isAuthenticated: false,
        capturePerformance: true,
    },
    url = './playground/cypress-full',
}: {
    waitForDecide?: boolean
    initPosthog?: boolean
    resetOnInit?: boolean
    options?: Partial<PostHogConfig>
    decideResponseOverrides?: Partial<DecideResponse>
    url?: string
}) => {
    // sometimes we have too many listeners in this test environment
    // that breaks the event emitter listeners in error tracking tests
    // we don't see the error in production, so it's fine to increase the limit here
    EventEmitter.prototype._maxListeners = 100

    const decideResponse = {
        editorParams: {},
        featureFlags: ['session-recording-player'],
        supportedCompression: ['gzip-js'],
        excludedDomains: [],
        autocaptureExceptions: false,
        ...decideResponseOverrides,
    }
    cy.intercept('POST', '/decide/*', decideResponse).as('decide')

    cy.visit(url)

    if (initPosthog) {
        cy.posthogInit(options)
    }

    if (resetOnInit) {
        cy.posthog().invoke('reset', true)
    }

    if (waitForDecide) {
        cy.wait('@decide')
    }
}
