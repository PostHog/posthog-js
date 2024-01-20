export const start = ({
    waitForDecide = true,
    initPosthog = true,
    options = {},
    decideResponseOverrides = {
        config: { enable_collect_everything: true },
        sessionRecording: false,
    },
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

    cy.visit('./playground/cypress-full')

    if (initPosthog) {
        cy.posthogInit(options)
    }

    if (waitForDecide) {
        cy.wait('@decide')
    }
}
