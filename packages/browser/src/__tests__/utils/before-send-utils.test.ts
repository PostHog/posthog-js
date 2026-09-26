import { CaptureResult } from '../../types'
import { isNull } from '@posthog/core'
import { sampleByDistinctId, sampleByEvent, sampleBySessionId } from '../../customizations/before-send'

beforeEach(() => {
    let fiftyFiftyRandom = true
    vi.spyOn(Math, 'random').mockImplementation(() => {
        const val = fiftyFiftyRandom ? 0.48 : 0.51
        fiftyFiftyRandom = !fiftyFiftyRandom
        return val
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('before send utils', () => {
    it('can sample by event name', () => {
        const sampleFn = sampleByEvent(['$autocapture'], 0.5)

        const results = []
        Array.from({ length: 100 }).forEach(() => {
            const captureResult = { event: '$autocapture' } as unknown as CaptureResult
            results.push(sampleFn(captureResult))
        })
        const emittedEvents = results.filter((r) => !isNull(r))

        expect(emittedEvents.length).toBe(50)
        expect(emittedEvents[0].properties).toMatchObject({
            $sample_type: ['sampleByEvent'],
            $sample_threshold: 0.5,
            $sampled_events: ['$autocapture'],
        })
    })

    it.each([
        { percent: 0.5, random: 0.49, sampled: true },
        { percent: 0.5, random: 0.5, sampled: false },
        { percent: 0.5, random: 0.51, sampled: false },
        { percent: 0, random: 0, sampled: false },
        { percent: 1, random: 0.999, sampled: true },
    ])('samples at rate $percent with random value $random: $sampled', ({ percent, random, sampled }) => {
        vi.mocked(Math.random).mockReturnValue(random)
        const event = { event: '$autocapture', properties: { source: 'test' } } as unknown as CaptureResult

        const result = sampleByEvent(['$autocapture'], percent)(event)

        if (sampled) {
            expect(result).toEqual({
                event: '$autocapture',
                properties: {
                    source: 'test',
                    $sample_type: ['sampleByEvent'],
                    $sample_threshold: percent,
                    $sampled_events: ['$autocapture'],
                },
            })
        } else {
            expect(result).toBeNull()
        }
    })

    it('does not sample events outside the configured event names', () => {
        const event = { event: 'checkout', properties: { source: 'test' } } as unknown as CaptureResult

        expect(sampleByEvent(['$autocapture'], 0)(event)).toBe(event)
        expect(Math.random).not.toHaveBeenCalled()
    })

    it('can sample by distinct id', () => {
        const sampleFn = sampleByDistinctId(0.5)
        const results = []
        const distinct_id_one = 'user-1'
        const distinct_id_two = 'user-that-hashes-to-no-events'
        Array.from({ length: 100 }).forEach(() => {
            ;[distinct_id_one, distinct_id_two].forEach((distinct_id) => {
                const captureResult = { properties: { distinct_id } } as unknown as CaptureResult
                results.push(sampleFn(captureResult))
            })
        })
        const distinctIdOneEvents = results.filter((r) => !isNull(r) && r.properties.distinct_id === distinct_id_one)
        const distinctIdTwoEvents = results.filter((r) => !isNull(r) && r.properties.distinct_id === distinct_id_two)

        expect(distinctIdOneEvents.length).toBe(100)
        expect(distinctIdTwoEvents.length).toBe(0)

        expect(distinctIdOneEvents[0].properties).toMatchObject({
            $sample_type: ['sampleByDistinctId'],
            $sample_threshold: 0.5,
        })
    })

    it('can sample by session id', () => {
        const sampleFn = sampleBySessionId(0.5)
        const results = []
        const session_id_one = 'a-session-id'
        const session_id_two = 'id-that-hashes-to-not-sending-events'
        Array.from({ length: 100 }).forEach(() => {
            ;[session_id_one, session_id_two].forEach((session_id) => {
                const captureResult = { properties: { $session_id: session_id } } as unknown as CaptureResult
                results.push(sampleFn(captureResult))
            })
        })
        const sessionIdOneEvents = results.filter((r) => !isNull(r) && r.properties.$session_id === session_id_one)
        const sessionIdTwoEvents = results.filter((r) => !isNull(r) && r.properties.$session_id === session_id_two)

        expect(sessionIdOneEvents.length).toBe(100)
        expect(sessionIdTwoEvents.length).toBe(0)

        expect(sessionIdOneEvents[0].properties).toMatchObject({
            $sample_type: ['sampleBySessionId'],
            $sample_threshold: 0.5,
        })
    })

    it('can combine thresholds', () => {
        const sampleBySession = sampleBySessionId(0.5)
        const sampleByEventFn = sampleByEvent(['$autocapture'], 0.5)

        const results = []
        const session_id_one = 'a-session-id'
        const session_id_two = 'id-that-hashes-to-not-sending-events'
        Array.from({ length: 100 }).forEach(() => {
            ;[session_id_one, session_id_two].forEach((session_id) => {
                const captureResult = {
                    event: '$autocapture',
                    properties: { $session_id: session_id },
                } as unknown as CaptureResult
                const firstBySession = sampleBySession(captureResult)
                const thenByEvent = sampleByEventFn(firstBySession)
                results.push(thenByEvent)
            })
        })
        const sessionIdOneEvents = results.filter((r) => !isNull(r) && r.properties.$session_id === session_id_one)
        const sessionIdTwoEvents = results.filter((r) => !isNull(r) && r.properties.$session_id === session_id_two)

        expect(sessionIdOneEvents.length).toBe(50)
        expect(sessionIdTwoEvents.length).toBe(0)

        expect(sessionIdOneEvents[0].properties).toMatchObject({
            $sample_type: ['sampleBySessionId', 'sampleByEvent'],
            $sample_threshold: 0.25,
        })
    })
})
