import { MutationThrottler } from '../../../extensions/replay/external/mutation-throttler'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
} from '../../../extensions/replay/external/sessionrecording-utils'
import type { rrwebRecord } from '../../../extensions/replay/types/rrweb'
import { jest } from '@jest/globals'
import type { eventWithTime, mutationData } from '../../../extensions/replay/types/rrweb-types'

jest.useFakeTimers()

const makeEvent = (mutations: {
    adds?: mutationData['adds']
    removes?: mutationData['removes']
    attributes?: mutationData['attributes']
}): eventWithTime => ({
    type: INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    data: {
        source: MUTATION_SOURCE_TYPE,
        adds: mutations?.adds || [],
        removes: mutations?.removes || [],
        attributes: mutations?.attributes || [],
        texts: [],
    },
    timestamp: 1,
})

describe('MutationThrottler', () => {
    const mockGetNode = jest.fn()
    const mockGetId = jest.fn()
    const rrwebMock: jest.Mock<rrwebRecord> = {
        mirror: {
            getNode: mockGetNode,
            getId: mockGetId,
        },
    } as unknown as jest.Mock<rrwebRecord>

    let mutationThrottler: MutationThrottler
    let onBlockedNodeMock: (id: number, node: Node | null) => void
    let onDroppedAttributeMutationsMock: jest.Mock

    beforeEach(() => {
        mockGetNode.mockReturnValueOnce({ nodeName: 'div' })
        mockGetId.mockReturnValueOnce(1)

        onBlockedNodeMock = jest.fn()
        onDroppedAttributeMutationsMock = jest.fn()
        mutationThrottler = new MutationThrottler(rrwebMock as unknown as rrwebRecord, {
            onBlockedNode: onBlockedNodeMock,
            onDroppedAttributeMutations: onDroppedAttributeMutationsMock,
        })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('event is passed through unchanged when not throttled', () => {
        const event = makeEvent({})

        const result = mutationThrottler.throttleMutations(event)

        expect(result).toBe(event)
    })

    test('returns undefined if no mutations are left', () => {
        const event = makeEvent({ attributes: [{ id: 1, attributes: { a: 'ttribute' } }] })

        mutationThrottler['_rateLimiter']['_buckets']['1'] = { tokens: 0, lastAccess: Date.now() }

        const result = mutationThrottler.throttleMutations(event)

        expect(result).toBeUndefined()
    })

    test('returns event if _any_ adds are left', () => {
        const event = makeEvent({
            // TODO: add serializedNodeWithId type once https://github.com/rrweb-io/rrweb/pull/1593 merges
            adds: [{ parentId: 0, nextId: 0, node: {} as unknown as any }],
            attributes: [{ id: 1, attributes: { a: 'ttribute' } }],
        })

        mutationThrottler['_rateLimiter']['_buckets']['1'] = { tokens: 0, lastAccess: Date.now() }

        const result = mutationThrottler.throttleMutations(event)

        expect(result).toStrictEqual(
            makeEvent({
                // TODO: add serializedNodeWithId type once https://github.com/rrweb-io/rrweb/pull/1593 merges
                adds: [{ parentId: 0, nextId: 0, node: {} as unknown as any }],
                attributes: [],
            })
        )
    })

    test('returns event if _any_ removes are left', () => {
        const event = makeEvent({
            removes: [{ parentId: 0, id: 0 }],
            attributes: [{ id: 1, attributes: { a: 'ttribute' } }],
        })

        mutationThrottler['_rateLimiter']['_buckets']['1'] = { tokens: 0, lastAccess: Date.now() }

        const result = mutationThrottler.throttleMutations(event)

        expect(result).toStrictEqual(
            makeEvent({
                removes: [{ parentId: 0, id: 0 }],
                attributes: [],
            })
        )
    })

    test('reports dropped attribute mutations so the recorder can count them', () => {
        const event = makeEvent({ attributes: [{ id: 1, attributes: { a: 'ttribute' } }] })

        mutationThrottler['_rateLimiter']['_buckets']['1'] = { tokens: 0, lastAccess: Date.now() }

        mutationThrottler.throttleMutations(event)

        expect(onDroppedAttributeMutationsMock).toHaveBeenCalledWith(1)
    })

    test('does not report dropped mutations when nothing is throttled', () => {
        const event = makeEvent({ attributes: [{ id: 1, attributes: { a: 'ttribute' } }] })

        mutationThrottler.throttleMutations(event)

        expect(onDroppedAttributeMutationsMock).not.toHaveBeenCalled()
    })

    test('does not throttle non-mutation events', () => {
        const event = {
            type: 'other_event_type',
            data: {},
        }

        const result = mutationThrottler.throttleMutations(event as unknown as eventWithTime)

        expect(result).toBe(event)
    })

    describe('reset()', () => {
        test('clears the logged tracker', () => {
            // Populate the logged tracker
            mutationThrottler['_loggedTracker']['123'] = true
            mutationThrottler['_loggedTracker']['456'] = true

            expect(Object.keys(mutationThrottler['_loggedTracker'])).toHaveLength(2)

            mutationThrottler.reset()

            expect(Object.keys(mutationThrottler['_loggedTracker'])).toHaveLength(0)
        })
    })

    describe('stop()', () => {
        test('clears the rate limiter interval', () => {
            const stopSpy = jest.spyOn(mutationThrottler['_rateLimiter'], 'stop')

            mutationThrottler.stop()

            expect(stopSpy).toHaveBeenCalled()
        })

        test('clears the logged tracker', () => {
            // Populate the logged tracker
            mutationThrottler['_loggedTracker']['123'] = true
            mutationThrottler['_loggedTracker']['456'] = true

            expect(Object.keys(mutationThrottler['_loggedTracker'])).toHaveLength(2)

            mutationThrottler.stop()

            expect(Object.keys(mutationThrottler['_loggedTracker'])).toHaveLength(0)
        })
    })

    describe('byte budget', () => {
        let onDroppedOversizedMutation: jest.Mock
        let requestFullSnapshot: jest.Mock
        let throttler: MutationThrottler

        const eventOfRoughSize = (chars: number): eventWithTime =>
            makeEvent({ adds: [{ parentId: 1, nextId: null, node: { textContent: 'x'.repeat(chars) } } as any] })

        beforeEach(() => {
            onDroppedOversizedMutation = jest.fn()
            requestFullSnapshot = jest.fn()
            throttler = new MutationThrottler(rrwebMock as unknown as rrwebRecord, {
                bytesBucketSize: 1000,
                bytesRefillRate: 100,
                onDroppedOversizedMutation,
                requestFullSnapshot,
            })
        })

        test.each([
            ['drops a mutation larger than the burst allowance', 2000, true],
            ['passes a mutation within the budget', 100, false],
        ])('%s', (_name, chars, expectDropped) => {
            const result = throttler.throttleMutations(eventOfRoughSize(chars))

            if (expectDropped) {
                expect(result).toBeUndefined()
                expect(onDroppedOversizedMutation).toHaveBeenCalledWith(expect.any(Number))
            } else {
                expect(result).toBeDefined()
                expect(onDroppedOversizedMutation).not.toHaveBeenCalled()
            }
        })

        test('drops once the sustained budget is exhausted and recovers after refill', () => {
            expect(throttler.throttleMutations(eventOfRoughSize(300))).toBeDefined()
            expect(throttler.throttleMutations(eventOfRoughSize(300))).toBeDefined()
            expect(throttler.throttleMutations(eventOfRoughSize(300))).toBeUndefined()

            jest.advanceTimersByTime(5000)

            expect(throttler.throttleMutations(eventOfRoughSize(300))).toBeDefined()
        })

        test('requests a single resyncing full snapshot after a drop window ends', () => {
            throttler.throttleMutations(eventOfRoughSize(2000))
            expect(requestFullSnapshot).not.toHaveBeenCalled()

            throttler.throttleMutations(eventOfRoughSize(100))
            expect(requestFullSnapshot).toHaveBeenCalledTimes(1)

            throttler.throttleMutations(eventOfRoughSize(100))
            expect(requestFullSnapshot).toHaveBeenCalledTimes(1)
        })

        test('non-mutation events are not charged against the budget', () => {
            const nonMutation = {
                type: 999,
                data: { textContent: 'x'.repeat(5000) },
                timestamp: 1,
            } as unknown as eventWithTime

            expect(throttler.throttleMutations(nonMutation)).toBe(nonMutation)
            expect(throttler.throttleMutations(eventOfRoughSize(400))).toBeDefined()
        })
    })
})
