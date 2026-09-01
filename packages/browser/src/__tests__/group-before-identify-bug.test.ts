/**
 * Test to verify bug: calling group() before identify() causes initial person props to be lost
 */
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import * as mockedGlobals from '@posthog/browser-common/utils/globals'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    const mockURLGetter = vi.fn()
    const mockReferrerGetter = vi.fn()
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

const { mockURLGetter, mockReferrerGetter } = mockedGlobals as any

describe('group before identify bug', () => {
    beforeEach(() => {
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com?utm_source=linkedin&utm_campaign=test')
    })

    it('should include initial UTM params in $identify even when group() is called first', async () => {
        const token = uuidv7()
        const beforeSendMock = vi.fn().mockImplementation((e) => e)

        const posthog = await createPosthogInstance(token, {
            before_send: beforeSendMock,
            person_profiles: 'identified_only',
            capture_pageview: false,
        })

        // Simulate what Clerk does: call group() with properties before identify()
        posthog.group('organization', 'org_123', { name: 'Acme Corp' })

        // Then call identify
        posthog.identify('user_123')

        // Find the events
        const calls = beforeSendMock.mock.calls
        const identifyCall = calls.find((c: any) => c[0].event === '$identify')

        // THE BUG: $identify should have $set_once with initial UTM params
        // but because group() was called first, _personProcessingSetOncePropertiesSent is already true
        expect(identifyCall).toBeDefined()
        expect(identifyCall[0].$set_once).toBeDefined()
        expect(identifyCall[0].$set_once.$initial_utm_source).toEqual('linkedin')
        expect(identifyCall[0].$set_once.$initial_utm_campaign).toEqual('test')
    })

    it('should include initial UTM params when identify() is called without group() first', async () => {
        const token = uuidv7()
        const beforeSendMock = vi.fn().mockImplementation((e) => e)

        const posthog = await createPosthogInstance(token, {
            before_send: beforeSendMock,
            person_profiles: 'identified_only',
            capture_pageview: false,
        })

        // Just call identify without group first
        posthog.identify('user_123')

        const calls = beforeSendMock.mock.calls
        const identifyCall = calls.find((c: any) => c[0].event === '$identify')

        // This should work
        expect(identifyCall).toBeDefined()
        expect(identifyCall[0].$set_once).toBeDefined()
        expect(identifyCall[0].$set_once.$initial_utm_source).toEqual('linkedin')
        expect(identifyCall[0].$set_once.$initial_utm_campaign).toEqual('test')
    })
})
