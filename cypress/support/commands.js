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

let $captures, $fullCaptures

Cypress.Commands.add('posthog', () => cy.window().then(($window) => $window.posthog))

Cypress.Commands.add('posthogInit', (options) => {
    $captures = []
    $fullCaptures = []

    cy.posthog().invoke('init', 'test_token', {
        api_host: location.origin,
        debug: true,
        _onCapture: (event, eventData) => {
            $captures.push(event)
            $fullCaptures.push(eventData)
        },
        ...options,
    })
})

Cypress.Commands.add('phCaptures', (options = {}) => {
    function resolve() {
        const result = options.full ? $fullCaptures : $captures
        return cy.verifyUpcomingAssertions(result, options, {
            onRetry: resolve,
        })
    }

    return resolve()
})

Cypress.Commands.add('resetPhCaptures', () => {
    $captures = []
    $fullCaptures = []
})

Cypress.Commands.add('shouldBeCalled', (alias, timesCalled) => {
    const calls = cy.state('requests').filter((call) => call.alias === alias)
    expect(calls).to.have.length(timesCalled, `${alias} should have been called ${timesCalled} times`)
})
