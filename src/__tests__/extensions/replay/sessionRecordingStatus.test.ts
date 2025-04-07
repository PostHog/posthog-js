import {
    URLAndEventTriggerMatching,
    RecordingTriggersStatus,
    TriggerStatus,
    firstMatchSessionRecordingStatus,
    originalSessionRecordingStatus,
} from '../../../extensions/replay/sessionrecording'

describe('sessionRecordingStatus', () => {
    describe('original behavior', () => {
        const defaultTriggersStatus: RecordingTriggersStatus = {
            receivedDecide: true,
            isRecordingEnabled: true,
            isSampled: undefined,
            triggerMatching: {
                urlBlocked: false,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLAndEventTriggerMatching,
            sessionId: 'test-session',
            linkedFlag: null,
            linkedFlagSeen: true,
        }

        it('returns buffering when decide not received', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                receivedDecide: false,
            })
            expect(status).toBe('buffering')
        })

        it('returns disabled when recording is not enabled', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                isRecordingEnabled: false,
            })
            expect(status).toBe('disabled')
        })

        it('returns disabled when explicitly not sampled (isSampled = false)', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
            })
            expect(status).toBe('disabled')
        })

        it('returns paused when URL is blocked', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    urlBlocked: true,
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('paused')
        })

        it('returns buffering when linked flag exists but not seen', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                linkedFlag: 'some-flag',
                linkedFlagSeen: false,
            })
            expect(status).toBe('buffering')
        })

        it('returns buffering when trigger status is pending', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_pending' as TriggerStatus,
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('buffering')
        })

        it('returns sampled when explicitly sampled (isSampled = true)', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
            })
            expect(status).toBe('sampled')
        })

        it('returns active when all conditions are met and sampling is undefined', () => {
            const status = originalSessionRecordingStatus(defaultTriggersStatus)
            expect(status).toBe('active')
        })

        // Test combinations to verify logical flow
        it('prioritizes disabled over other states when recording is disabled', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                isRecordingEnabled: false,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    urlBlocked: true,
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('disabled')
        })

        it('prioritizes disabled over other states when explicitly not sampled', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    urlBlocked: true,
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('disabled')
        })

        it('prioritizes buffering over active when decide not received', () => {
            const status = originalSessionRecordingStatus({
                ...defaultTriggersStatus,
                receivedDecide: false,
                isSampled: true,
            })
            expect(status).toBe('buffering')
        })
    })

    describe('start on first trigger behavior', () => {
        const defaultTriggersStatus: RecordingTriggersStatus = {
            receivedDecide: true,
            isRecordingEnabled: true,
            isSampled: undefined,
            triggerMatching: {
                urlBlocked: false,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLAndEventTriggerMatching,
            sessionId: 'test-session',
            linkedFlag: null,
            linkedFlagSeen: true,
        }

        it('starts recording when event trigger is active, even if sampling is false', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_activated',
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('active')
        })

        it('starts recording when URL trigger is active, even if sampling is false', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_activated',
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('active')
        })

        it('starts recording when linked flag is active, even if sampling is false', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                linkedFlag: 'some-flag',
                linkedFlagSeen: true,
            })
            expect(status).toBe('active')
        })

        it('starts recording when sampling is true, even if other triggers are not active', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
                linkedFlag: null,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'not_triggered' as TriggerStatus,
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('sampled')
        })

        it('returns buffering when no triggers are active and sampling is false', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                linkedFlag: null,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_pending',
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('buffering')
        })

        it('returns disabled when no triggers are active and sampling is false', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                linkedFlag: null,
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_disabled',
                } as unknown as URLAndEventTriggerMatching,
            })
            // nothing overriding the sampling decision
            expect(status).toBe('disabled')
        })

        it('returns disabled when recording is not enabled, regardless of triggers', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isRecordingEnabled: false,
                isSampled: true,
                linkedFlag: 'some-flag',
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    triggerStatus: () => 'trigger_activated',
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('disabled')
        })

        it('returns paused when URL is blocked, regardless of other triggers', () => {
            const status = firstMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
                linkedFlag: 'some-flag',
                triggerMatching: {
                    ...defaultTriggersStatus.triggerMatching,
                    urlBlocked: true,
                    triggerStatus: () => 'trigger_activated',
                } as unknown as URLAndEventTriggerMatching,
            })
            expect(status).toBe('paused')
        })
    })
})
