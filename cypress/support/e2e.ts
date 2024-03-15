import './commands'

// Add console errors into cypress logs.
Cypress.on('window:before:load', (win) => {
    cy.spy(win.console, 'error')
    cy.spy(win.console, 'warn')
    cy.spy(win.console, 'log')
    cy.spy(win.console, 'debug')
})

beforeEach(() => {
    cy.intercept('POST', '**/decide/*').as('decide')
    cy.intercept('POST', '**/e/*').as('capture')
    cy.intercept('POST', '**/ses/*').as('session-recording')
    cy.intercept('GET', '**/surveys/*').as('surveys')

    cy.readFile('dist/array.full.js').then((body) => {
        cy.intercept('**/static/array.full.js', { body })
    })

    cy.readFile('dist/array.js').then((body) => {
        cy.intercept('**/static/array.js', { body })
    })

    cy.readFile('dist/recorder.js').then((body) => {
        cy.intercept('**/static/recorder.js*', { body }).as('recorder')
        cy.intercept('**/static/recorder-v2.js*', { body }).as('recorder')
    })

    cy.readFile('dist/surveys.js').then((body) => {
        cy.intercept('**/static/surveys.js*', { body })
    })
})
