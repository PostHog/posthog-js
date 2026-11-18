import { createPostHog as createDefault } from '../src/composition/npm/core'
import type { IPostHog } from '../src/core/types'
import {
    recordCapture,
    recordedEvents,
    recordingOptions,
    type RecordedEvent,
    type RecordedRequest,
} from './capture-recorder'

describe('pageview ID', () => {
    let requests: RecordedRequest[]
    let posthog: IPostHog

    const sent = async (): Promise<Record<string, RecordedEvent>> => {
        await posthog.flush()
        return Object.fromEntries(recordedEvents(requests).map((event) => [event.event, event]))
    }

    beforeEach(async () => {
        requests = []
        posthog = await createDefault(recordingOptions(recordCapture(requests)))
    })

    afterEach(async () => {
        await posthog.shutdown()
        vi.useRealTimers()
    })

    it('has no pageview ID before a pageview is captured', async () => {
        posthog.capture('before')

        const events = await sent()
        expect(posthog.getPageViewId()).toBeUndefined()
        expect(events.before?.properties).not.toHaveProperty('$pageview_id')
    })

    it('uses the pageview UUID as the ID for the pageview and later events', async () => {
        posthog.capture('$pageview')
        posthog.capture('after')

        const events = await sent()
        const pageviewId = events.$pageview?.uuid
        expect(pageviewId).toBeDefined()
        expect(posthog.getPageViewId()).toBe(pageviewId)
        expect(events.$pageview?.properties.$pageview_id).toBe(pageviewId)
        expect(events.$pageview?.properties).not.toHaveProperty('$prev_pageview_id')
        expect(events.after?.properties.$pageview_id).toBe(pageviewId)
    })

    it('links a pageview to the previous pageview', async () => {
        posthog.capture('$pageview', null, { uuid: '01890000-0000-7000-8000-000000000001' })
        posthog.capture('$pageview', null, { uuid: '01890000-0000-7000-8000-000000000002' })

        await posthog.flush()
        expect(recordedEvents(requests).map((event) => event.properties)).toEqual([
            expect.objectContaining({ $pageview_id: '01890000-0000-7000-8000-000000000001' }),
            expect.objectContaining({
                $pageview_id: '01890000-0000-7000-8000-000000000002',
                $prev_pageview_id: '01890000-0000-7000-8000-000000000001',
            }),
        ])
    })

    it('attributes a page leave to the current pageview', async () => {
        posthog.capture('$pageview')
        posthog.capture('$pageleave')

        const events = await sent()
        const pageviewId = events.$pageview?.uuid
        expect(events.$pageleave?.properties).toMatchObject({
            $pageview_id: pageviewId,
            $prev_pageview_id: pageviewId,
        })
    })

    it('overrides a caller value while a pageview is active and keeps it otherwise', async () => {
        posthog.capture('before', { $pageview_id: 'caller' })
        posthog.capture('$pageview')
        posthog.capture('after', { $pageview_id: 'caller' })

        const events = await sent()
        expect(events.before?.properties.$pageview_id).toBe('caller')
        expect(events.after?.properties.$pageview_id).toBe(events.$pageview?.uuid)
    })

    it('does not track a pageview that was not admitted', async () => {
        posthog.optOut()
        posthog.capture('$pageview')
        posthog.optIn()
        posthog.capture('after')

        const events = await sent()
        expect(posthog.getPageViewId()).toBeUndefined()
        expect(events.after?.properties).not.toHaveProperty('$pageview_id')
    })

    it('clears the pageview on reset', async () => {
        posthog.capture('$pageview')
        posthog.reset()
        posthog.capture('after')

        const events = await sent()
        expect(posthog.getPageViewId()).toBeUndefined()
        expect(events.after?.properties).not.toHaveProperty('$pageview_id')
    })

    it('clears the pageview when the session rotates', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        posthog.capture('$pageview')
        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'))
        posthog.capture('after_idle')

        const events = await sent()
        expect(events.after_idle?.properties).not.toHaveProperty('$pageview_id')
        expect(posthog.getPageViewId()).toBeUndefined()
    })
})

describe('initial pageview ID', () => {
    it('identifies the initial pageview', async () => {
        vi.stubGlobal('document', { visibilityState: 'visible' })
        try {
            const requests: RecordedRequest[] = []
            const posthog = await createDefault({
                ...recordingOptions(recordCapture(requests)),
                capturePageview: true,
            })
            await posthog.flush()

            const [pageview] = recordedEvents(requests)
            expect(pageview?.event).toBe('$pageview')
            expect(pageview?.properties.$pageview_id).toBe(pageview?.uuid)
            expect(posthog.getPageViewId()).toBe(pageview?.uuid)
            await posthog.shutdown()
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
