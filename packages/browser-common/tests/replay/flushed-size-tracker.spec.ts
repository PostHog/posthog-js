import { FlushedSizeTracker } from '../../src/replay/external/flushed-size-tracker'
import { SESSION_RECORDING_FLUSHED_SIZE } from '../../src/replay/constants'
import { InMemoryKeyValueStore } from '../helpers/test-client'

describe('FlushedSizeTracker', () => {
    let tracker: FlushedSizeTracker
    let kv: InMemoryKeyValueStore

    beforeEach(() => {
        kv = new InMemoryKeyValueStore()
        tracker = new FlushedSizeTracker({ kv }, () => (value) => kv.set(SESSION_RECORDING_FLUSHED_SIZE, value))
    })

    const SESSION_ID = 'session-a'

    describe('trackSize', () => {
        describe.each([
            [[100, 200, 300], 600],
            [[1, 1, 1, 1, 1], 5],
            [[1000], 1000],
            [[50.5, 25.25, 10.25], 86],
            [[0, 0, 100], 100],
        ])('tracking multiple sizes %p', (sizes, expectedTotal) => {
            it(`accumulates to ${expectedTotal}`, () => {
                sizes.forEach((size) => tracker.trackSize(SESSION_ID, size))
                expect(tracker.currentTrackedSize(SESSION_ID)).toEqual(expectedTotal)
            })
        })
    })

    describe('session scoping', () => {
        it('returns 0 for a session that has never been tracked', () => {
            expect(tracker.currentTrackedSize('never-seen')).toEqual(0)
        })

        it('does not leak the tracked size into another session', () => {
            tracker.trackSize('session-a', 100)

            expect(tracker.currentTrackedSize('session-b')).toEqual(0)
        })

        it('starts a new session from zero, discarding the previous session total', () => {
            tracker.trackSize('session-a', 100)
            tracker.trackSize('session-b', 30)

            expect(tracker.currentTrackedSize('session-a')).toEqual(0)
            expect(tracker.currentTrackedSize('session-b')).toEqual(30)
        })

        describe.each([
            ['legacy bare number', 999999],
            ['non-numeric size', { sessionId: SESSION_ID, size: 'abc' }],
            ['missing size', { sessionId: SESSION_ID }],
            ['non-string sessionId', { sessionId: 42, size: 100 }],
            ['null', null],
        ])('treats an invalid persisted value (%s) as zero', (_label, stored) => {
            it('returns 0', () => {
                kv.set('$sess_rec_flush_size', stored)

                expect(tracker.currentTrackedSize(SESSION_ID)).toEqual(0)
            })
        })
    })
})
