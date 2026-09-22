import type { RemoteConfig, SessionRecordingRemoteConfig } from '../types/remote-config'

/** the config stored in persistence when session recording remote config is received */
type PersistedRemoteConfig = Omit<
    SessionRecordingRemoteConfig,
    | 'recordCanvas'
    | 'canvasFps'
    | 'canvasQuality'
    | 'networkPayloadCapture'
    | 'sampleRate'
    | 'minimumDurationMilliseconds'
>

export type SessionRecordingPersistedConfig = {
    [K in keyof PersistedRemoteConfig]: PersistedRemoteConfig[K] | undefined
} & {
    /**
     * Used to determine if the persisted config is still valid or we need to wait for a new one
     * only accepts undefined since older versions of the library didn't set this.
     */
    cache_timestamp?: number
    enabled: boolean
    networkPayloadCapture: SessionRecordingRemoteConfig['networkPayloadCapture'] & {
        capturePerformance: RemoteConfig['capturePerformance']
    }
    canvasRecording: {
        enabled: SessionRecordingRemoteConfig['recordCanvas']
        fps: SessionRecordingRemoteConfig['canvasFps']
        quality: SessionRecordingRemoteConfig['canvasQuality']
    }
    // we don't allow string config here
    sampleRate: number | null
    minimumDurationMilliseconds: number | null | undefined
}

export type TriggerType = 'url' | 'event'

export type SessionRecordingStatus =
    | 'disabled'
    | 'sampled'
    | 'active'
    | 'buffering'
    | 'paused'
    | 'lazy_loading'
    | 'awaiting_config'
    | 'missing_config'
    | 'rrweb_error'

export type SessionStartReason =
    | 'sampling_overridden'
    | 'recording_initialized'
    | 'linked_flag_matched'
    | 'linked_flag_overridden'
    | 'sampled'
    | 'session_id_changed'
    | 'url_trigger_matched'
    | 'event_trigger_matched'

export type {
    Properties,
    PerformanceCaptureConfig,
    SessionIdChangedCallback,
    SessionRecordingOptions,
    SessionRecordingSamplingConfig,
    CapturedNetworkRequest,
    InitiatorType,
} from '@posthog/types'
export type { NetworkRecordOptions } from '../types/network-recording'
export type {
    FlagVariant,
    RemoteConfig,
    SessionRecordingUrlTrigger,
    SessionRecordingTriggerGroup,
} from '../types/remote-config'
export type Headers = Record<string, string>
