import { start } from '../support/setup'

describe('Exception capture', () => {
    it('manual exception capture', () => {
        start({
            decideResponseOverrides: {
                autocaptureExceptions: false,
            },
            url: './playground/cypress',
        })

        cy.get('[data-cy-exception-button]').click()

        // ugh
        cy.wait(1500)

        cy.phCaptures({ full: true }).then((captures) => {
            expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).to.be.eql('$exception')
            expect(captures[2].properties.extra_prop).to.be.eql(2)
            expect(captures[2].properties.$exception_source).to.eql(undefined)
            expect(captures[2].properties.$exception_personURL).to.eql(undefined)
            expect(captures[2].properties.$exception_list[0].value).to.be.eql('wat even am I')
            expect(captures[2].properties.$exception_list[0].type).to.be.eql('Error')
        })
    })

    describe('Exception autocapture enabled', () => {
        beforeEach(() => {
            cy.on('uncaught:exception', () => {
                // otherwise the exception we throw on purpose causes the test to fail
                return false
            })

            start({
                decideResponseOverrides: {
                    autocaptureExceptions: true,
                },
                url: './playground/cypress',
            })
            cy.wait('@exception-autocapture-script')
        })

        it('autocaptures exceptions', () => {
            cy.get('[data-cy-button-throws-error]').click()

            // ugh
            cy.wait(1500)

            cy.phCaptures({ full: true }).then((captures) => {
                expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$autocapture', '$exception'])
                expect(captures[2].event).to.be.eql('$exception')
                expect(captures[2].properties.$exception_list[0].value).to.be.eql('This is an error')
                expect(captures[2].properties.$exception_list[0].type).to.be.eql('Error')

                expect(captures[2].properties.$exception_personURL).to.match(
                    /http:\/\/localhost:\d+\/project\/test_token\/person\/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/
                )
            })
        })

        it('sets stacktrace on manual captures if autocapture enabled', () => {
            cy.get('[data-cy-exception-button]').click()

            // ugh
            cy.wait(1500)

            cy.phCaptures({ full: true }).then((captures) => {
                expect(captures[2].properties.$exception_list).to.exist
                expect(captures[2].properties.$exception_list[0].value).to.be.eql('wat even am I')
            })
        })
    })
})
