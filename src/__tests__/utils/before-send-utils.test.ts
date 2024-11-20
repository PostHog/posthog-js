import { CaptureResult } from '../../types'
import { isNull } from '../../utils/type-utils'
import { sampleByDistinctId, sampleByEvent, sampleBySessionId } from '../../customizations/before-send'

beforeAll(() => {
    let fiftyFiftyRandom = true
    Math.random = () => {
        const val = fiftyFiftyRandom ? 0.48 : 0.51
        fiftyFiftyRandom = !fiftyFiftyRandom
        return val
    }
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
