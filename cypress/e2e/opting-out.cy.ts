import { assertWhetherPostHogRequestsWereCalled, pollPhCaptures } from '../support/assertions'

function assertThatRecordingStarted() {
    cy.phCaptures({ full: true }).then((captures) => {
        expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])

        expect(captures[0]['properties']['$snapshot_data']).to.have.length.above(2)
        // a meta and then a full snapshot
        expect(captures[0]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
        expect(captures[0]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
    })
}

describe('opting out', () => {
    describe('session recording', () => {
        beforeEach(() => {
            cy.intercept('POST', '/decide/*', {
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

        it('can start recording after starting opted out', () => {
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

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
        })

        it('can override sampling when starting session recording', () => {
            cy.intercept('POST', '/decide/*', {
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            cy.posthogInit({
                opt_out_capturing_by_default: true,
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.posthog().invoke('startSessionRecording', { sampling: true })

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
        })
    })
})
