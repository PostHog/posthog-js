/**
 * Test to verify bug: calling group() before identify() causes initial person props to be lost
 */
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            body: {},
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
        },
        get location() {
            const url = mockURLGetter()
            return {
                href: url,
                toString: () => url,
            }
        },
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockReferrerGetter } = require('../utils/globals')

describe('group before identify bug', () => {
    beforeEach(() => {
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com?utm_source=linkedin&utm_campaign=test')
    })

    it('should include initial UTM params in $identify even when group() is called first', async () => {
        const token = uuidv7()
        const beforeSendMock = jest.fn().mockImplementation((e) => e)

        const posthog = await createPosthogInstance(token, {
            before_send: beforeSendMock,
            person_profiles: 'identified_only',
        })

        // Simulate what Clerk does: call group() with properties before identify()
        posthog.group('organization', 'org_123', { name: 'Acme Corp' })

        // Then call identify
        posthog.identify('user_123')

        // Find the events
        const calls = beforeSendMock.mock.calls
        const groupIdentifyCall = calls.find((c: any) => c[0].event === '$groupidentify')
        const identifyCall = calls.find((c: any) => c[0].event === '$identify')

        console.log(
            '$groupidentify $set_once.$initial_utm_source:',
            groupIdentifyCall?.[0]?.$set_once?.$initial_utm_source
        )
        console.log('$identify $set_once.$initial_utm_source:', identifyCall?.[0]?.$set_once?.$initial_utm_source)

        // THE BUG: $identify should have $set_once with initial UTM params
        // but because group() was called first, _personProcessingSetOncePropertiesSent is already true
        expect(identifyCall).toBeDefined()
        expect(identifyCall[0].$set_once).toBeDefined()
        expect(identifyCall[0].$set_once.$initial_utm_source).toEqual('linkedin')
        expect(identifyCall[0].$set_once.$initial_utm_campaign).toEqual('test')
    })

    it('should include initial UTM params when identify() is called without group() first', async () => {
        const token = uuidv7()
        const beforeSendMock = jest.fn().mockImplementation((e) => e)

        const posthog = await createPosthogInstance(token, {
            before_send: beforeSendMock,
            person_profiles: 'identified_only',
        })

        // Just call identify without group first
        posthog.identify('user_123')

        const calls = beforeSendMock.mock.calls
        const identifyCall = calls.find((c: any) => c[0].event === '$identify')

        console.log('$identify $set_once (no group):', JSON.stringify(identifyCall?.[0]?.$set_once, null, 2))

        // This should work
        expect(identifyCall).toBeDefined()
        expect(identifyCall[0].$set_once).toBeDefined()
        expect(identifyCall[0].$set_once.$initial_utm_source).toEqual('linkedin')
        expect(identifyCall[0].$set_once.$initial_utm_campaign).toEqual('test')
    })
})
