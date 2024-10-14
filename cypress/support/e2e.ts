import './commands'
import '@cypress/skip-test/support'

// Add console errors into cypress logs.
Cypress.on('window:before:load', (win) => {
    cy.spy(win.console, 'error')
    cy.spy(win.console, 'warn')
    cy.spy(win.console, 'log')
    cy.spy(win.console, 'debug')
})

beforeEach(() => {
    cy.intercept('POST', '/decide/*').as('decide')
    cy.intercept('POST', '/e/*', { status: 1 }).as('capture')
    cy.intercept('POST', '/ses/*', { status: 1 }).as('session-recording')
    cy.intercept('GET', '/surveys/*').as('surveys')
    ;[
        'array.full.js',
        'array.js',
        'recorder.js',
        'surveys.js',
        'exception-autocapture.js',
        'heatmaps.js',
        'dom-autocapture.js',
    ].forEach((file) => {
        cy.readFile(`dist/${file}`).then((body) => {
            cy.intercept(`/static/${file}*`, { body }).as(`${file.replace('.js', '')}-script`)
        })
        cy.readFile(`dist/${file}.map`).then((body) => {
            cy.intercept(`/static/${file}.map`, { body })
        })
    })
})
