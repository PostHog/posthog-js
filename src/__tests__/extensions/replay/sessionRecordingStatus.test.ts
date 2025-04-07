import {
    URLAndEventTriggerMatching,
    RecordingTriggersStatus,
    originalSessionRecordingStatus,
    allMatchSessionRecordingStatus,
    anyMatchSessionRecordingStatus,
} from '../../../extensions/replay/sessionrecording'

type TestConfig = {
    name: string
    config: Partial<RecordingTriggersStatus>
    originalExpected: 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'
    anyMatchExpected: 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'
    allMatchExpected: 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'
}

const defaultTriggersStatus: RecordingTriggersStatus = {
    receivedDecide: true,
    isRecordingEnabled: true,
    isSampled: undefined,
    triggerMatching: {
        urlBlocked: false,
        triggerStatus: () => 'trigger_disabled',
    } as unknown as URLAndEventTriggerMatching,
    sessionId: 'test-session',
    linkedFlag: null,
    linkedFlagSeen: true,
}

const testCases: TestConfig[] = [
    // Basic states
    {
        name: 'decide not received',
        config: { receivedDecide: false },
        originalExpected: 'buffering',
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'recording disabled',
        config: { isRecordingEnabled: false },
        originalExpected: 'disabled',
        anyMatchExpected: 'disabled',
        allMatchExpected: 'disabled',
    },
    {
        name: 'URL blocked',
        config: {
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                urlBlocked: true,
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'paused',
        anyMatchExpected: 'paused',
        allMatchExpected: 'paused',
    },

    // Sampling variations
    {
        name: 'sampling false',
        config: { isSampled: false },
        originalExpected: 'disabled',
        anyMatchExpected: 'disabled',
        allMatchExpected: 'disabled',
    },
    {
        name: 'sampling true',
        config: { isSampled: true },
        originalExpected: 'sampled',
        anyMatchExpected: 'sampled',
        allMatchExpected: 'sampled',
    },
    {
        name: 'sampling undefined',
        config: { isSampled: undefined },
        originalExpected: 'active',
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Linked flag variations
    {
        name: 'linked flag present but not seen',
        config: { linkedFlag: 'some-flag', linkedFlagSeen: false },
        originalExpected: 'buffering',
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'linked flag present and seen',
        config: { linkedFlag: 'some-flag', linkedFlagSeen: true },
        originalExpected: 'active',
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },
    {
        name: 'linked flag not present',
        config: { linkedFlag: null },
        originalExpected: 'active',
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Trigger status variations
    {
        name: 'trigger pending (means we have config but not yet matched)',
        config: {
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'buffering',
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'trigger disabled (means we do not have config)',
        config: {
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_disabled',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'active', // nothing to match on, recording is active
        anyMatchExpected: 'active', // nothing to match on, recording is active
        allMatchExpected: 'active', // nothing to match on, recording is active
    },
    {
        name: 'trigger activated',
        config: {
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'active',
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Combined scenarios
    {
        name: 'sampling false with linked flag and active trigger',
        config: {
            isSampled: false,
            linkedFlag: 'some-flag',
            linkedFlagSeen: true,
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'disabled',
        anyMatchExpected: 'active', // trigger activated, so sampling overridden
        allMatchExpected: 'disabled',
    },
    {
        name: 'sampling false with linked flag and inactive trigger',
        config: {
            isSampled: false,
            linkedFlag: 'some-flag',
            linkedFlagSeen: true,
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'disabled',
        anyMatchExpected: 'active', // flag is seen, so sampling overridden
        allMatchExpected: 'buffering',
    },
    {
        name: 'sampling true with pending trigger',
        config: {
            isSampled: true,
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'buffering',
        anyMatchExpected: 'sampled',
        allMatchExpected: 'buffering',
    },
    {
        name: 'all matches configured and satisfied',
        config: {
            isSampled: true,
            linkedFlag: 'some-flag',
            linkedFlagSeen: true,
            triggerMatching: {
                ...defaultTriggersStatus.triggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLAndEventTriggerMatching,
        },
        originalExpected: 'sampled',
        anyMatchExpected: 'sampled',
        allMatchExpected: 'sampled',
    },
]

describe('sessionRecordingStatus', () => {
    describe('original behavior', () => {
        testCases.forEach(({ name, config, originalExpected }) => {
            it(`returns ${originalExpected} when ${name}`, () => {
                const status = originalSessionRecordingStatus({
                    ...defaultTriggersStatus,
                    ...config,
                })
                expect(status).toBe(originalExpected)
            })
        })
    })

    describe('first match behavior', () => {
        testCases.forEach(({ name, config, anyMatchExpected }) => {
            it(`returns ${anyMatchExpected} when ${name}`, () => {
                const status = anyMatchSessionRecordingStatus({
                    ...defaultTriggersStatus,
                    ...config,
                })
                expect(status).toBe(anyMatchExpected)
            })
        })
    })

    describe('all match behavior', () => {
        testCases.forEach(({ name, config, allMatchExpected }) => {
            it(`returns ${allMatchExpected} when ${name}`, () => {
                const status = allMatchSessionRecordingStatus({
                    ...defaultTriggersStatus,
                    ...config,
                })
                expect(status).toBe(allMatchExpected)
            })
        })
    })
})
