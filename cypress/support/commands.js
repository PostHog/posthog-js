// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add("login", (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add("drag", { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add("dismiss", { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite("visit", (originalFn, url, options) => { ... })

let $captures

Cypress.Commands.add('posthog', () => cy.window().then(($window) => $window.posthog))

Cypress.Commands.add('posthogInit', (options) => {
    $captures = []

    cy.posthog().invoke('init', 'test_token', {
        api_host: location.origin,
        debug: true,
        _onCapture: (data) => {
            $captures.push(data)
        },
        ...options,
    })
})

Cypress.Commands.add('phCaptures', (options = {}) => {
    function resolve() {
        return cy.verifyUpcomingAssertions($captures, options, {
            onRetry: resolve,
        })
    }

    return resolve()
})

Cypress.Commands.add('resetPhCaptures', () => {
    $captures = []
})
