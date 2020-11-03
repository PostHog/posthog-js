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

Cypress.Commands.add('setupPosthog', (options) => {
    $captures = []

    return cy.window().then(($window) => {
        $window.posthog.init('9_4O00TnKeSQ9iGYF0NznPBx3gFAbu6TL5U6QrPojyI', {
            api_host: 'http://127.0.0.1:8000',
            debug: true,
            _onCapture: (data) => {
                // const el = $window.document.createElement('pre')
                // el.innerHTML = JSON.stringify(data, null, 2)
                // $window.document.querySelector('[data-cy-captures]').appendChild(el)

                $captures.push(data)
            },
            ...options,
        })
    })
})

Cypress.Commands.add('phCaptures', (attribute = null, options = {}) => {
    function resolve() {
        const values = $captures.map((event) => event[attribute])

        return cy.verifyUpcomingAssertions(values, options, {
            onRetry: resolve,
        })
    }

    return resolve()
})

Cypress.Commands.add('resetPhCaptures', () => {
    $captures = []
})
