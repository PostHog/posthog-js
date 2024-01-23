let $captures, $fullCaptures

Cypress.Commands.add('posthog', () => cy.window().then(($window) => ($window as any).posthog))

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

Cypress.Commands.add('phCaptures', (options = { full: false }) => {
    function resolve() {
        const result = options.full ? $fullCaptures : $captures
        // @ts-expect-error TS can't find verifyUpcomingAssertions, but it's there 🤷‍
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
