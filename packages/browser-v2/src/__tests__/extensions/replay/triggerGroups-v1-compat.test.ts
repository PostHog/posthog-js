/**
 * V1 Backward Compatibility Tests
 *
 * These tests ensure that existing V1 trigger configurations continue to work
 * exactly as before when V2 trigger groups are not configured.
 */

import {
    ACTIVE,
    allMatchSessionRecordingStatus,
    anyMatchSessionRecordingStatus,
    BUFFERING,
    DISABLED,
    EventTriggerMatching,
    LinkedFlagMatching,
    RecordingTriggersStatus,
    SAMPLED,
    TRIGGER_ACTIVATED,
    TRIGGER_DISABLED,
    TRIGGER_PENDING,
    URLTriggerMatching,
} from '../../../extensions/replay/external/triggerMatching'

describe('V1 Backward Compatibility', () => {
    const defaultTriggersStatus: RecordingTriggersStatus = {
        receivedFlags: true,
        isRecordingEnabled: true,
        isSampled: null,
        rrwebError: false,
        urlTriggerMatching: {
            triggerStatus: () => TRIGGER_DISABLED,
            urlBlocked: false,
        } as unknown as URLTriggerMatching,
        eventTriggerMatching: {
            triggerStatus: () => TRIGGER_DISABLED,
        } as unknown as EventTriggerMatching,
        linkedFlagMatching: {
            triggerStatus: () => TRIGGER_DISABLED,
        } as unknown as LinkedFlagMatching,
        sessionId: 'test-session',
    }

    describe('anyMatchSessionRecordingStatus (V1)', () => {
        it('should return SAMPLED when isSampled is true', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
            })
            expect(status).toBe(SAMPLED)
        })

        it('should return ACTIVE when event trigger activated', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
            })
            expect(status).toBe(ACTIVE)
        })

        it('should return ACTIVE when URL trigger activated', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
            })
            expect(status).toBe(ACTIVE)
        })

        it('should return ACTIVE when linked flag activated', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                linkedFlagMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as LinkedFlagMatching,
            })
            expect(status).toBe(ACTIVE)
        })

        it('should return BUFFERING when any trigger is pending', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_PENDING,
                } as unknown as EventTriggerMatching,
            })
            expect(status).toBe(BUFFERING)
        })

        it('should return DISABLED when isSampled is false and no triggers', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
            })
            expect(status).toBe(DISABLED)
        })

        it('should return ACTIVE when no sampling configured and no triggers', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: null,
            })
            expect(status).toBe(ACTIVE)
        })
    })

    describe('allMatchSessionRecordingStatus (V1)', () => {
        it('should return SAMPLED when isSampled is true', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
            })
            expect(status).toBe(SAMPLED)
        })

        it('should return BUFFERING when any trigger is pending', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_PENDING,
                } as unknown as EventTriggerMatching,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
            })
            expect(status).toBe(BUFFERING)
        })

        it('should return ACTIVE when triggers have mixed states with some disabled', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_DISABLED,
                } as unknown as EventTriggerMatching,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
                linkedFlagMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as LinkedFlagMatching,
            })
            // With ALL match, if no triggers configured (DISABLED removed from set), should be ACTIVE
            expect(status).toBe(ACTIVE)
        })

        it('should return ACTIVE when all triggers activated', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
                linkedFlagMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as LinkedFlagMatching,
            })
            expect(status).toBe(ACTIVE)
        })

        it('should return DISABLED when isSampled is false', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
            })
            expect(status).toBe(DISABLED)
        })
    })

    describe('V1 Trigger Matching Behavior', () => {
        it('should handle event + sampling with ANY match', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
            })
            // Sampling takes precedence
            expect(status).toBe(SAMPLED)
        })

        it('should handle event + sampling with ALL match', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: true,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
            })
            expect(status).toBe(SAMPLED)
        })

        it('should handle URL + event with ANY match', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_DISABLED,
                } as unknown as EventTriggerMatching,
            })
            // ANY means if URL is activated, should be ACTIVE
            expect(status).toBe(ACTIVE)
        })

        it('should handle URL + event with ALL match', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_DISABLED,
                } as unknown as EventTriggerMatching,
            })
            // ALL means if no triggers are configured (all DISABLED), should be ACTIVE by default
            expect(status).toBe(ACTIVE)
        })
    })

    describe('V1 Edge Cases', () => {
        it('should handle null isSampled with no triggers', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: null,
            })
            // Should default to ACTIVE
            expect(status).toBe(ACTIVE)
        })

        it('should handle undefined isSampled with triggers pending', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: undefined,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_PENDING,
                } as unknown as EventTriggerMatching,
            })
            // Should be BUFFERING because trigger is pending
            expect(status).toBe(BUFFERING)
        })

        it('should return ACTIVE when trigger activated even if sampling false (ANY)', () => {
            const status = anyMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
            })
            // With ANY match, activated trigger takes precedence - sampling false is only checked at the end
            expect(status).toBe(ACTIVE)
        })

        it('should prioritize sampling false over activated triggers (ALL)', () => {
            const status = allMatchSessionRecordingStatus({
                ...defaultTriggersStatus,
                isSampled: false,
                eventTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                } as unknown as EventTriggerMatching,
                urlTriggerMatching: {
                    triggerStatus: () => TRIGGER_ACTIVATED,
                    urlBlocked: false,
                } as unknown as URLTriggerMatching,
            })
            expect(status).toBe(DISABLED)
        })
    })
})
