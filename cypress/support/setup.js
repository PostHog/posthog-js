export const start = ({
    waitForDecide = true,
    initPosthog = true,
    resetOnInit = false,
    options = {},
    decideResponseOverrides = {
        config: { enable_collect_everything: true },
        sessionRecording: false,
    },
    url = './playground/cypress-full',
} = {}) => {
    const decideResponse = {
        editorParams: {},
        featureFlags: ['session-recording-player'],
        isAuthenticated: false,
        supportedCompression: ['gzip-js'],
        excludedDomains: [],
        autocaptureExceptions: false,
        capture_performance: true,
        ...decideResponseOverrides,
        config: { enable_collect_everything: true, ...decideResponseOverrides.config },
    }
    cy.intercept('POST', '**/decide/*', decideResponse).as('decide')

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
