import { assertWhetherPostHogRequestsWereCalled } from '../support/assertions'

describe('opting out', () => {
    describe('session recording', () => {
        beforeEach(() => {
            cy.intercept('POST', '/decide/*', {
                config: { enable_collect_everything: false },
                editorParams: {},
                featureFlags: ['session-recording-player'],
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                },
                capture_performance: true,
            }).as('decide')

            cy.visit('./playground/cypress')
        })

        it('does not capture events without init', () => {
            cy.get('[data-cy-input]').type('hello world! ')

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': false,
                '@decide': false,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures || []).to.deep.equal([])
                    })
                })
        })

        it('does not capture events when config opts out by default', () => {
            cy.posthogInit({ opt_out_capturing_by_default: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures || []).to.deep.equal([])
                    })
                })
        })

        it('does not capture recordings when config disables session recording', () => {
            cy.posthogInit({ disable_session_recording: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        expect(captures || []).to.deep.equal(['$pageview'])
                    })
                })
        })

        // TODO: after opting in the onCapture hook isn't being called
        //  so we're not able to assert on behaviour anymore
        // but observing it all works ok
        it.skip('can start recording after starting opted out', () => {
            cy.posthogInit({ opt_out_capturing_by_default: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')
            // TODO: should we require this call?
            cy.posthog().invoke('startSessionRecording')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait(200)
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])

                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(33).and.below(38)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        expect(captures[1]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                        // Making a set from the rest should all be 3 - incremental snapshots
                        const incrementalSnapshots = captures[1]['properties']['$snapshot_data'].slice(3)
                        expect(new Set(incrementalSnapshots.map((s) => s.type))).to.deep.equal(new Set([3]))
                    })
                })
        })
    })
})
