import Chainable = Cypress.Chainable

export function pollPhCaptures(event, wait = 200, attempts = 0, maxAttempts = 50): Chainable<any> {
    return cy.phCaptures().then((capturesArray) => {
        if (capturesArray.some((capture) => capture === event)) {
            return cy.wrap(true)
        } else if (attempts < maxAttempts) {
            // If not found and the max attempts are not reached, wait for a moment and try again
            return cy.wait(wait).then(() => {
                return pollPhCaptures(event, wait, attempts + 1, maxAttempts)
            })
        } else {
            // Log the failure to find the value after max attempts
            throw new Error('Max attempts reached without finding the expected event')
        }
    })
}

/**
 * Receives an object with keys as the name of the route and values as whether the route should have been called.
 * e.g. { '@recorder': true, '@decide': false }
 * the keys must match a `cy.intercept` alias
 **/
export function assertWhetherPostHogRequestsWereCalled(expectedCalls: Record<string, boolean>): Chainable<undefined> {
    return cy.wait(200).then(() => {
        for (const [key, value] of Object.entries(expectedCalls)) {
            cy.get(key).then((interceptions) => {
                if (value) {
                    expect(interceptions).to.be.an('object')
                } else {
                    expect(interceptions).not.to.be.an('object')
                }
            })
        }
    })
}
