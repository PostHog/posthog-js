import './commands'
import '@cypress/skip-test/support'

// Add console errors into cypress logs.
Cypress.on('window:before:load', (win) => {
    cy.spy(win.console, 'error')
    cy.spy(win.console, 'warn')
    cy.spy(win.console, 'log')
    cy.spy(win.console, 'debug')

    // NOTE: Temporary change whilst testing remote config
    ;(win as any)._POSTHOG_REMOTE_CONFIG = {
        test_token: {
            config: {},
            siteApps: [],
        },
    }
})

beforeEach(() => {
    cy.intercept('POST', '/decide/*').as('decide')
    cy.intercept('POST', '/e/*', { status: 1 }).as('capture')
    cy.intercept('POST', '/ses/*', { status: 1 }).as('session-recording')
    cy.intercept('GET', '/surveys/*').as('surveys')

    const lazyLoadedJSFiles = [
        'array',
        'array.full',
        'recorder',
        'surveys',
        'exception-autocapture',
        'tracing-headers',
        'web-vitals',
        'dead-clicks-autocapture',
    ]
    lazyLoadedJSFiles.forEach((key: string) => {
        cy.readFile(`dist/${key}.js`).then((body) => {
            cy.intercept(`/static/${key}.js*`, { body }).as(`${key}-script`)
        })

        cy.readFile(`dist/${key}.js.map`).then((body) => {
            cy.intercept(`/static/${key}.js.map`, { body })
        })
    })
})
