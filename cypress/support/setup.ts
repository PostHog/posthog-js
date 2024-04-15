import { DecideResponse, PostHogConfig } from '../../src/types'

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
    const decideResponse = {
        editorParams: {},
        featureFlags: ['session-recording-player'],
        supportedCompression: ['gzip-js'],
        excludedDomains: [],
        autocaptureExceptions: false,
        ...decideResponseOverrides,
        config: { ...decideResponseOverrides.config },
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
