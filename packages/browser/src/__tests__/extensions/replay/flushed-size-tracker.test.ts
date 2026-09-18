import { BrowserClientKeyValueStore } from '../../../extensions/browser-client-kv'
import { createReplayFlushedSizeWriter } from '../../../extensions/replay/replay-host'
import { FlushedSizeTracker } from '@posthog/browser-common/replay/external/flushed-size-tracker'
import { PostHog } from '../../../posthog-core'
import { vi } from 'vitest'
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

        tracker = new FlushedSizeTracker({ kv: new BrowserClientKeyValueStore(mockPostHog) }, () =>
            createReplayFlushedSizeWriter(mockPostHog)
        )
    })

    afterEach(() => {
        persistence.clear()
        vi.clearAllMocks()
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

            expect(
                () =>
                    new FlushedSizeTracker({ kv: new BrowserClientKeyValueStore(invalidPostHog) }, () =>
                        createReplayFlushedSizeWriter(invalidPostHog)
                    )
            ).toThrow('it is not valid to not have persistence and be this far into setting up the application')
        })

        it('throws error when persistence is null', () => {
            const invalidPostHog = createMockPostHog({
                get_property: () => {},
                persistence: null,
            })

            expect(
                () =>
                    new FlushedSizeTracker({ kv: new BrowserClientKeyValueStore(invalidPostHog) }, () =>
                        createReplayFlushedSizeWriter(invalidPostHog)
                    )
            ).toThrow('it is not valid to not have persistence and be this far into setting up the application')
        })
    })
})
