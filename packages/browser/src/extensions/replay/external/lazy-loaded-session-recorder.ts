import { LazyLoadedSessionRecording as SharedLazyLoadedSessionRecording } from '@posthog/browser-common/replay/external/lazy-loaded-session-recorder'
import type { PostHog } from '../../../posthog-core'
import { createReplayRecorderClient } from '../replay-host'
import { replayOptions } from '../replay-options'

export * from '@posthog/browser-common/replay/external/lazy-loaded-session-recorder'

/** Browser-owned constructor adapter for older cores and independently deployed recorder chunks. */
export const LazyLoadedSessionRecording = function (instance: PostHog, documentWasEverVisible?: boolean) {
    return new SharedLazyLoadedSessionRecording(
        createReplayRecorderClient(instance),
        () => replayOptions(instance),
        documentWasEverVisible
    )
} as unknown as {
    new (instance: PostHog, documentWasEverVisible?: boolean): SharedLazyLoadedSessionRecording
    prototype: SharedLazyLoadedSessionRecording
}
LazyLoadedSessionRecording.prototype = SharedLazyLoadedSessionRecording.prototype
export type LazyLoadedSessionRecording = SharedLazyLoadedSessionRecording
