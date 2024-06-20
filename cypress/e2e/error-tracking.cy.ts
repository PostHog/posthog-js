import { start } from '../support/setup'

describe('Exception autocapture', () => {
    beforeEach(() => {
        start({
            decideResponseOverrides: {
                autocaptureExceptions: true,
            },
            url: './playground/cypress',
        })

        cy.on('uncaught:exception', () => {
            // otherwise the exception we throw on purpose causes the test to fail
            return false
        })
    })

    it('captures exceptions', () => {
        cy.get('[data-cy-button-throws-error]').click()
        cy.phCaptures({ full: true }).then((captures) => {
            expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).to.be.eql('$exception')
            expect(captures[2].properties.$exception_message).to.be.eql('This is an error')
            expect(captures[2].properties.$exception_type).to.be.eql('Error')
            expect(captures[2].properties.$exception_source).to.match('http://localhost:d+/playground/cypress/')
            expect(captures[2].properties.$exception_personURL).to.include(
                'http://localhost:60621/project/test_token/person/019037b8-ac98-75ff-aafc-ec3ff9ade9dd'
            )
        })
    })
})
