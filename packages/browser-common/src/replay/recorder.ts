import type { Properties, SessionStartReason, SessionRecordingStatus, TriggerType } from './types'
import type { eventWithTime } from './rrweb-types'

export interface LazyLoadedSessionRecordingInterface {
    start: (startReason?: SessionStartReason) => void
    stop: () => void
    discard: (options?: { discardProducerEvents?: boolean }) => void
    sessionId: string
    status: SessionRecordingStatus
    onRRwebEmit: (rawEvent: eventWithTime) => void
    log: (message: string, level: 'log' | 'warn' | 'error') => void
    sdkDebugProperties: Properties
    overrideLinkedFlag: () => void
    overrideSampling: () => void
    overrideTrigger: (triggerType: TriggerType) => void
    isStarted: boolean
    tryAddCustomEvent(tag: string, payload: any): boolean
    setDocumentWasEverVisible?: (documentWasEverVisible: boolean) => void
    flushBeforeIdentityReset?: () => void
}
