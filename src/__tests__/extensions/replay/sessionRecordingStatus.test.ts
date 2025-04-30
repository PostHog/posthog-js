import {
    allMatchSessionRecordingStatus,
    anyMatchSessionRecordingStatus,
    EventTriggerMatching,
    LinkedFlagMatching,
    RecordingTriggersStatus,
    URLTriggerMatching,
} from '../../../extensions/replay/triggerMatching'
import { PostHog } from '../../../posthog-core'

type TestConfig = {
    name: string
    config: Partial<RecordingTriggersStatus>
    anyMatchExpected: 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'
    allMatchExpected: 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'
}

const defaultTriggersStatus: RecordingTriggersStatus = {
    receivedDecide: true,
    isRecordingEnabled: true,
    isSampled: undefined,
    urlTriggerMatching: {
        onRemoteConfig: () => {},
        triggerStatus: () => 'trigger_disabled',
        urlBlocked: false,
    } as unknown as URLTriggerMatching,
    eventTriggerMatching: {
        onRemoteConfig: () => {},
        triggerStatus: () => 'trigger_disabled',
    } as unknown as EventTriggerMatching,
    linkedFlagMatching: {
        onRemoteConfig: () => {},
        triggerStatus: () => 'trigger_disabled',
    } as unknown as LinkedFlagMatching,
    sessionId: 'test-session',
}

const makeLinkedFlagMatcher = (linkedFlag: string | null, linkedFlagSeen: boolean): LinkedFlagMatching => {
    const lfm = new LinkedFlagMatching({} as unknown as PostHog)
    lfm.linkedFlag = linkedFlag
    lfm.linkedFlagSeen = linkedFlagSeen
    return lfm
}

const testCases: TestConfig[] = [
    // Basic states
    {
        name: 'decide not received',
        config: { receivedDecide: false },
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'recording disabled',
        config: { isRecordingEnabled: false },
        anyMatchExpected: 'disabled',
        allMatchExpected: 'disabled',
    },
    {
        name: 'URL blocked',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                urlBlocked: true,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'paused',
        allMatchExpected: 'paused',
    },

    // event trigger variations
    {
        name: 'no event trigger',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                triggerStatus: () => 'trigger_disabled',
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: 'active', // no event trigger, so recording is active
        allMatchExpected: 'active', // no event trigger, so recording is active
    },

    {
        name: 'event trigger present but not seen',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'event trigger present and seen',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                triggerStatus: () => 'trigger_active',
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Sampling variations
    {
        name: 'sampling false',
        config: { isSampled: false },
        anyMatchExpected: 'disabled',
        allMatchExpected: 'disabled',
    },
    {
        name: 'sampling true',
        config: { isSampled: true },
        anyMatchExpected: 'sampled',
        allMatchExpected: 'sampled',
    },
    {
        name: 'sampling undefined',
        config: { isSampled: undefined },
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Linked flag variations
    {
        name: 'linked flag present but not seen',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', false),
        },
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'linked flag present and seen',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
        },
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },
    {
        name: 'linked flag not present',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher(null, false),
        },
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // URL Trigger status variations
    {
        name: 'trigger pending (means we have config but not yet matched)',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'buffering',
        allMatchExpected: 'buffering',
    },
    {
        name: 'trigger disabled (means we do not have config)',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_disabled',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'active', // nothing to match on, recording is active
        allMatchExpected: 'active', // nothing to match on, recording is active
    },
    {
        name: 'trigger activated',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'active',
        allMatchExpected: 'active',
    },

    // Combined scenarios
    {
        name: 'sampling false with linked flag and active url trigger',
        config: {
            isSampled: false,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'active', // trigger activated, so sampling overridden
        allMatchExpected: 'disabled',
    },
    {
        name: 'sampling false with linked flag and inactive url trigger',
        config: {
            isSampled: false,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'active', // flag is seen, so sampling overridden
        allMatchExpected: 'buffering',
    },
    {
        name: 'sampling true with pending url trigger',
        config: {
            isSampled: true,
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'sampled',
        allMatchExpected: 'buffering',
    },
    {
        name: 'sampling true with pending event trigger',
        config: {
            isSampled: true,
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                triggerStatus: () => 'trigger_pending',
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: 'sampled',
        allMatchExpected: 'buffering',
    },
    {
        name: 'sampling true with active event trigger',
        config: {
            isSampled: true,
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                triggerStatus: () => 'trigger_active',
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: 'sampled',
        allMatchExpected: 'sampled',
    },
    {
        name: 'all matches configured and satisfied',
        config: {
            isSampled: true,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                triggerStatus: () => 'trigger_activated',
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: 'sampled',
        allMatchExpected: 'sampled',
    },
]

describe('sessionRecordingStatus', () => {
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
