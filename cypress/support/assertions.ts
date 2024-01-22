/**
 * Receives an object with keys as the name of the route and values as whether the route should have been called.
 * e.g. { '@recorder': true, '@decide': false }
 * the keys must match a `cy.intercept` alias
 **/
export function assertWhetherPostHogRequestsWereCalled(expectedCalls: Record<string, boolean>) {
    cy.wait(200)

    for (const [key, value] of Object.entries(expectedCalls)) {
        cy.get(key).then((interceptions) => {
            if (value) {
                expect(interceptions).to.be.an('object')
            } else {
                expect(interceptions).not.to.be.an('object')
            }
        })
    }
}
