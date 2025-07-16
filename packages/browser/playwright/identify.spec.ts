import { expect, test } from './fixtures'

test.describe('Identify', () => {
    test.use({ url: '/playground/cypress/index.html' })
    test.beforeEach(async ({ posthog }) => {
        await posthog.init()
    })

    test('uses the v7 uuid format for device id', async ({ posthog, events }) => {
        await posthog.capture('an-anonymous-event')
        await events.waitForEvent('an-anonymous-event')
        const capturedEvents = events.all()
        const deviceIds = new Set(capturedEvents.map((e) => e.properties['$device_id']))
        expect(deviceIds.size).toEqual(1)
        const [deviceId] = deviceIds
        expect(deviceId.length).toEqual(36)
    })

    test('opt out capturing does not fail after identify', async ({ posthog }) => {
        await posthog.evaluate((ph) => {
            ph.identify('some-id')
            ph.opt_out_capturing()
        })
        const isOptedOut = await posthog.evaluate((ph) => {
            return ph.has_opted_out_capturing()
        })
        expect(isOptedOut).toEqual(true)
    })

    test('merges people as expected when reset is called', async ({ posthog, events }) => {
        await events.waitForEvent('$pageview')
        await posthog.evaluate((ph) => {
            ph.capture('an-anonymous-event')
            ph.identify('first-identify')
            ph.capture('an-identified-event')
            ph.identify('second-identify-should-not-be-merged')
            ph.capture('another-identified-event')
            ph.reset()
            ph.capture('an-anonymous-event')
            ph.identify('third-identify')
            ph.capture('an-identified-event')
        })
        const capturedEvents = events.all()
        events.expectCountMap({
            $identify: 2,
        })
        events.expectMatchList([
            '$pageview',
            'an-anonymous-event',
            '$identify',
            'an-identified-event',
            'another-identified-event',
            'an-anonymous-event',
            '$identify',
            'an-identified-event',
        ])

        expect(new Set(capturedEvents.map((e) => e.properties['$device_id'])).size).toEqual(1)

        // the first two events share a distinct id
        expect(capturedEvents[0].properties.distinct_id).toEqual(capturedEvents[1].properties.distinct_id)
        // then first identify is called and sends that distinct id as its anon to merge
        expect(capturedEvents[2].properties.distinct_id).toEqual('first-identify')
        expect(capturedEvents[2].properties['$anon_distinct_id']).toEqual(capturedEvents[0].properties.distinct_id)
        // and an event is sent with that distinct id
        expect(capturedEvents[3].properties.distinct_id).toEqual('first-identify')
        // then second identify is called and is ignored but does change the distinct id
        expect(capturedEvents[4].event).toEqual('another-identified-event')
        expect(capturedEvents[4].properties.distinct_id).toEqual('second-identify-should-not-be-merged')
        // then reset is called and the next event has a new distinct id
        expect(capturedEvents[5].event).toEqual('an-anonymous-event')
        expect(capturedEvents[5].properties.distinct_id).not.toEqual('first-identify')
        expect(capturedEvents[5].properties.distinct_id).not.toEqual('second-identify-should-not-be-merged')
        // then an identify merges that distinct id with the new distinct id
        expect(capturedEvents[6].properties.distinct_id).toEqual('third-identify')
        expect(capturedEvents[6].properties['$anon_distinct_id']).toEqual(capturedEvents[5].properties.distinct_id)
        // then a final identified event includes that identified distinct id
        expect(capturedEvents[7].properties.distinct_id).toEqual('third-identify')
    })
})
