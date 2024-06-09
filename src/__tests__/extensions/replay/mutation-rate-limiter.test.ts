import { MutationRateLimiter } from '../../../extensions/replay/mutation-rate-limiter'
import {
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    MUTATION_SOURCE_TYPE,
    rrwebRecord,
} from '../../../extensions/replay/sessionrecording-utils'
import { jest } from '@jest/globals'
import { eventWithTime, mutationData } from '@rrweb/types'
import { serializedNodeWithId } from 'rrweb-snapshot'
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

describe('MutationRateLimiter', () => {
    const mockGetNode = jest.fn()
    const mockGetId = jest.fn()
    const rrwebMock: jest.Mock<rrwebRecord> = {
        mirror: {
            getNode: mockGetNode,
            getId: mockGetId,
        },
    } as unknown as jest.Mock<rrwebRecord>

    let mutationRateLimiter: MutationRateLimiter
    let onBlockedNodeMock: (id: number, node: Node | null) => void

    beforeEach(() => {
        mockGetNode.mockReturnValueOnce({ nodeName: 'div' })
        mockGetId.mockReturnValueOnce(1)

        onBlockedNodeMock = jest.fn()
        mutationRateLimiter = new MutationRateLimiter(rrwebMock as unknown as rrwebRecord, {
            onBlockedNode: onBlockedNodeMock,
        })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('event is passed through unchanged when not throttled', () => {
        const event = makeEvent({})

        const result = mutationRateLimiter.throttleMutations(event)

        expect(result).toBe(event)
    })

    test('returns undefined if no mutations are left', () => {
        const event = makeEvent({ attributes: [{ id: 1, attributes: { a: 'ttribute' } }] })

        mutationRateLimiter['mutationBuckets']['1'] = 0

        const result = mutationRateLimiter.throttleMutations(event)

        expect(result).toBeUndefined()
    })

    test('returns event if _any_ adds are left', () => {
        const event = makeEvent({
            adds: [{ parentId: 0, nextId: 0, node: {} as unknown as serializedNodeWithId }],
            attributes: [{ id: 1, attributes: { a: 'ttribute' } }],
        })

        mutationRateLimiter['mutationBuckets']['1'] = 0

        const result = mutationRateLimiter.throttleMutations(event)

        expect(result).toStrictEqual(
            makeEvent({
                adds: [{ parentId: 0, nextId: 0, node: {} as unknown as serializedNodeWithId }],
                attributes: [],
            })
        )
    })

    test('returns event if _any_ removes are left', () => {
        const event = makeEvent({
            removes: [{ parentId: 0, id: 0 }],
            attributes: [{ id: 1, attributes: { a: 'ttribute' } }],
        })

        mutationRateLimiter['mutationBuckets']['1'] = 0

        const result = mutationRateLimiter.throttleMutations(event)

        expect(result).toStrictEqual(
            makeEvent({
                removes: [{ parentId: 0, id: 0 }],
                attributes: [],
            })
        )
    })

    test('does not throttle non-mutation events', () => {
        const event = {
            type: 'other_event_type',
            data: {},
        }

        const result = mutationRateLimiter.throttleMutations(event as unknown as eventWithTime)

        expect(result).toBe(event)
    })
})
