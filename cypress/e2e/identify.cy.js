/// <reference types="cypress" />

import { convertFromNextWithShrunkOnce } from 'fast-check'

describe('identify()', () => {
    beforeEach(() => {
        cy.visit('./playground/cypress')
        cy.posthogInit({})

        cy.wait('@decide')
    })

    it('opt_out_capturing() does not fail after identify()', () => {
        cy.posthog().invoke('identify', 'some-id')
        cy.posthog().invoke('opt_out_capturing')
    })

    it('merges people as expected when reset is called', () => {
        cy.posthog().invoke('capture', 'an-anonymous-event')
        cy.posthog().invoke('identify', 'first-identify')
        cy.posthog().invoke('capture', 'an-identified-event')
        cy.posthog().invoke('identify', 'second-identify-should-be-ignored')
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
            // then second identify is called and is ignored
            // then reset is called and the next event has a new distinct id
            expect(events[4].event).not.to.eql('$identify')
            expect(events[4].properties.distinct_id).not.to.eql('first-identify')
            // then an identify merges that distinct id with the new distinct id
            expect(events[5].properties.distinct_id).to.eql('third-identify')
            expect(events[5].properties['$anon_distinct_id']).to.eql(events[4].properties.distinct_id)
            // then a final identified event includes that identified distinct id
            expect(events[6].properties.distinct_id).to.eql('third-identify')
        })
    })

    it('avoids merging people as expected when reset is not called', () => {
        cy.posthog().invoke('capture', 'an-anonymous-event')
        cy.posthog().invoke('identify', 'first-identify')
        cy.posthog().invoke('capture', 'an-identified-event')
        cy.posthog().invoke('identify', 'second-identify-should-be-ignored')
        cy.posthog().invoke('capture', 'an-anonymous-event')
        cy.posthog().invoke('identify', 'third-identify')
        cy.posthog().invoke('capture', 'an-identified-event')

        cy.phCaptures({ full: true }).then((events) => {
            const eventsSeen = events.map((e) => e.event)
            console.log(events)
            expect(eventsSeen.filter((e) => e === '$identify').length).to.eq(1)

            expect(eventsSeen).to.deep.eq([
                '$pageview',
                'an-anonymous-event',
                '$identify',
                'an-identified-event',
                'an-anonymous-event',
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
            // then second identify is called and is ignored
            expect(events[4].event).not.to.eql('$identify')
            expect(events[4].properties.distinct_id).to.eql('first-identify')
            // then an identify merges that distinct id with the new distinct id
            expect(events[5].properties.distinct_id).to.eql('first-identify')
        })
    })
})
