import { FlushedSizeTracker } from '../../../extensions/replay/external/flushed-size-tracker'
import { PostHog } from '../../../posthog-core'
import { jest } from '@jest/globals'
import { PostHogPersistence } from '../../../posthog-persistence'
import { createMockPostHog, createMockConfig } from '../../helpers/posthog-instance'

describe('FlushedSizeTracker', () => {
    let mockPostHog: PostHog
    let tracker: FlushedSizeTracker
    let persistence: PostHogPersistence

    beforeEach(() => {
        persistence = new PostHogPersistence(
            createMockConfig({
                persistence: 'memory',
            }),
            false
        )

        // Bind methods to preserve this context
        persistence.get_property = persistence.get_property.bind(persistence)
        persistence.set_property = persistence.set_property.bind(persistence)

        mockPostHog = createMockPostHog({
            get_property: persistence.get_property,
            persistence,
        })

        tracker = new FlushedSizeTracker(mockPostHog)
    })

    afterEach(() => {
        persistence.clear()
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('successfully constructs when persistence is present', () => {
            expect(tracker).toBeInstanceOf(FlushedSizeTracker)
        })

        it('throws error when persistence is missing', () => {
            const invalidPostHog = createMockPostHog({
                get_property: () => {},
                persistence: undefined,
            })

            expect(() => new FlushedSizeTracker(invalidPostHog)).toThrow(
                'it is not valid to not have persistence and be this far into setting up the application'
            )
        })

        it('throws error when persistence is null', () => {
            const invalidPostHog = createMockPostHog({
                get_property: () => {},
                persistence: null,
            })

            expect(() => new FlushedSizeTracker(invalidPostHog)).toThrow(
                'it is not valid to not have persistence and be this far into setting up the application'
            )
        })
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

        it('treats a legacy bare-number persisted value as zero', () => {
            persistence.set_property('$sess_rec_flush_size', 999999)

            expect(tracker.currentTrackedSize(SESSION_ID)).toEqual(0)
        })
    })
})
