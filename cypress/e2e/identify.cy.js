/// <reference types="cypress" />

describe('identify()', () => {
    beforeEach(() => {
        cy.visit('./playground/cypress-full')
        cy.posthogInit({})

        cy.wait('@decide')
    })

    it('opt_out_capturing() does not fail after identify()', () => {
        cy.posthog().invoke('identify', 'some-id')
        cy.posthog().invoke('opt_out_capturing')
    })

    it('merges people as expected when reset is called', () => {
        cy.posthog().invoke('capture', 'an-anonymous-event')
        cy.posthog().invoke('identify', 'first-identify') // test identify merges with previous events after init
        cy.posthog().invoke('capture', 'an-identified-event')
        cy.posthog().invoke('identify', 'second-identify-should-not-be-merged') // test identify is not sent after previous identify
        cy.posthog().invoke('capture', 'another-identified-event') // but does change the distinct id
        cy.posthog().invoke('reset')
        cy.posthog().invoke('capture', 'an-anonymous-event')
        cy.posthog().invoke('identify', 'third-identify')
        cy.posthog().invoke('capture', 'an-identified-event')

        cy.phCaptures({ full: true }).then((events) => {
            const eventsSeen = events.map((e) => e.event)

            expect(eventsSeen.filter((e) => e === '$identify').length).to.eq(2)

            expect(eventsSeen).to.deep.eq([
                '$pageview',
                'an-anonymous-event',
                '$identify',
                'an-identified-event',
                'another-identified-event',
                'an-anonymous-event',
                '$identify',
                'an-identified-event',
            ])

            expect(new Set(events.map((e) => e.properties['$device_id'])).size).to.eql(1)

            // the first two events share a distinct id
            expect(events[0].properties.distinct_id).to.eql(events[1].properties.distinct_id)
            // then first identify is called and sends that distinct id as its anon to merge
            expect(events[2].properties.distinct_id).to.eql('first-identify')
            expect(events[2].properties['$anon_distinct_id']).to.eql(events[0].properties.distinct_id)
            // and an event is sent with that distinct id
            expect(events[3].properties.distinct_id).to.eql('first-identify')
            // then second identify is called and is ignored but does change the distinct id
            expect(events[4].event).to.eql('another-identified-event')
            expect(events[4].properties.distinct_id).to.eql('second-identify-should-not-be-merged')
            // then reset is called and the next event has a new distinct id
            expect(events[5].event).to.eql('an-anonymous-event')
            expect(events[5].properties.distinct_id)
                .not.to.eql('first-identify')
                .and.not.to.eql('second-identify-should-not-be-merged')
            // then an identify merges that distinct id with the new distinct id
            expect(events[6].properties.distinct_id).to.eql('third-identify')
            expect(events[6].properties['$anon_distinct_id']).to.eql(events[5].properties.distinct_id)
            // then a final identified event includes that identified distinct id
            expect(events[7].properties.distinct_id).to.eql('third-identify')
        })
    })
})
