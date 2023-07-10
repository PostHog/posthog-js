// ***********************************************************
// This example support/index.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'
import 'given2/setup'

// Alternatively you can use CommonJS syntax:
// require('./commands')

// Add console errors into cypress logs.
Cypress.on('window:before:load', (win) => {
    cy.spy(win.console, 'error')
    cy.spy(win.console, 'warn')
    cy.spy(win.console, 'log')
    cy.spy(win.console, 'debug')
})

beforeEach(() => {
    cy.server()

    cy.route('POST', '**/decide/*').as('decide')
    cy.route('POST', '**/e/*').as('capture')
    cy.route('POST', '**/ses/*').as('session-recording')

    cy.readFile('dist/array.full.js').then((body) => {
        cy.intercept('**/static/array.full.js', { body })
    })

    cy.readFile('dist/array.js').then((body) => {
        cy.intercept('**/static/array.js', { body })
    })

    cy.readFile('dist/recorder.js').then((body) => {
        cy.intercept('**/static/recorder.js*', { body }).as('recorder')
    })
})
