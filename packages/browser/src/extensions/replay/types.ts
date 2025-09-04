import { EventTriggerMatching, LinkedFlagMatching, URLTriggerMatching } from './external/triggerMatching'

export const DISABLED = 'disabled'
export const SAMPLED = 'sampled'
export const ACTIVE = 'active'
export const BUFFERING = 'buffering'
export const PAUSED = 'paused'
export const LAZY_LOADING = 'lazy_loading'
const TRIGGER = 'trigger'
export const TRIGGER_ACTIVATED = TRIGGER + '_activated'
export const TRIGGER_PENDING = TRIGGER + '_pending'
export const TRIGGER_DISABLED = TRIGGER + '_' + DISABLED

export interface RecordingTriggersStatus {
    get receivedFlags(): boolean

    get isRecordingEnabled(): false | true | undefined

    get isSampled(): false | true | null

    get urlTriggerMatching(): URLTriggerMatching

    get eventTriggerMatching(): EventTriggerMatching

    get linkedFlagMatching(): LinkedFlagMatching

    get sessionId(): string
}

export type TriggerType = 'url' | 'event'
/*
triggers can have one of three statuses:
 * - trigger_activated: the trigger met conditions to start recording
 * - trigger_pending: the trigger is present, but the conditions are not yet met
 * - trigger_disabled: the trigger is not present
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const triggerStatuses = [TRIGGER_ACTIVATED, TRIGGER_PENDING, TRIGGER_DISABLED] as const
export type TriggerStatus = (typeof triggerStatuses)[number]
/**
 * Session recording starts in lazy_loading mode.
 * Once loaded and remote config received
 * it might be disabled, active or sampled.
 * When "sampled" that means a sample rate is set, and the last time the session ID rotated
 * the sample rate determined this session should be sent to the server.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sessionRecordingStatuses = [DISABLED, SAMPLED, ACTIVE, BUFFERING, PAUSED, LAZY_LOADING] as const
export type SessionRecordingStatus = (typeof sessionRecordingStatuses)[number]
