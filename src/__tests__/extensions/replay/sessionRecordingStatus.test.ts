import {
    ACTIVE,
    allMatchSessionRecordingStatus,
    anyMatchSessionRecordingStatus,
    BUFFERING,
    DISABLED,
    EventTriggerMatching,
    LinkedFlagMatching,
    PAUSED,
    RecordingTriggersStatus,
    SAMPLED,
    SessionRecordingStatus,
    TRIGGER_ACTIVATED,
    TRIGGER_DISABLED,
    TRIGGER_PENDING,
    URLTriggerMatching,
} from '../../../extensions/replay/triggerMatching'
import { PostHog } from '../../../posthog-core'

type TestConfig = {
    name: string
    config: Partial<RecordingTriggersStatus>
    anyMatchExpected: SessionRecordingStatus
    allMatchExpected: SessionRecordingStatus
}

const fakePostHog = { register_for_session: () => {} } as unknown as PostHog

const defaultTriggersStatus: RecordingTriggersStatus = {
    receivedFlags: true,
    isRecordingEnabled: true,
    isSampled: undefined,
    urlTriggerMatching: {
        onRemoteConfig: () => {},
        _instance: fakePostHog,
        triggerStatus: () => TRIGGER_DISABLED,
        urlBlocked: false,
    } as unknown as URLTriggerMatching,
    eventTriggerMatching: {
        onRemoteConfig: () => {},
        _instance: fakePostHog,
        triggerStatus: () => TRIGGER_DISABLED,
    } as unknown as EventTriggerMatching,
    linkedFlagMatching: {
        onRemoteConfig: () => {},
        _instance: fakePostHog,
        triggerStatus: () => TRIGGER_DISABLED,
    } as unknown as LinkedFlagMatching,
    sessionId: 'test-session',
}

const makeLinkedFlagMatcher = (linkedFlag: string | null, linkedFlagSeen: boolean): LinkedFlagMatching => {
    const lfm = new LinkedFlagMatching(fakePostHog)
    lfm.linkedFlag = linkedFlag
    lfm.linkedFlagSeen = linkedFlagSeen
    return lfm
}

const testCases: TestConfig[] = [
    // Basic states
    {
        name: 'flags not received',
        config: { receivedFlags: false },
        anyMatchExpected: BUFFERING,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'recording disabled',
        config: { isRecordingEnabled: false },
        anyMatchExpected: DISABLED,
        allMatchExpected: DISABLED,
    },
    {
        name: 'URL blocked',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                urlBlocked: true,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: PAUSED,
        allMatchExpected: PAUSED,
    },

    // event trigger variations
    {
        name: 'no event trigger',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_DISABLED,
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: ACTIVE, // no event trigger, so recording is active
        allMatchExpected: ACTIVE, // no event trigger, so recording is active
    },

    {
        name: 'event trigger present but not seen',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_PENDING,
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: BUFFERING,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'event trigger present and seen',
        config: {
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_ACTIVATED,
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: ACTIVE,
        allMatchExpected: ACTIVE,
    },

    // Sampling variations
    {
        name: 'sampling false',
        config: { isSampled: false },
        anyMatchExpected: DISABLED,
        allMatchExpected: DISABLED,
    },
    {
        name: 'sampling true',
        config: { isSampled: true },
        anyMatchExpected: SAMPLED,
        allMatchExpected: SAMPLED,
    },
    {
        name: 'sampling undefined',
        config: { isSampled: undefined },
        anyMatchExpected: ACTIVE,
        allMatchExpected: ACTIVE,
    },

    // Linked flag variations
    {
        name: 'linked flag present but not seen',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', false),
        },
        anyMatchExpected: BUFFERING,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'linked flag present and seen',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
        },
        anyMatchExpected: ACTIVE,
        allMatchExpected: ACTIVE,
    },
    {
        name: 'linked flag not present',
        config: {
            linkedFlagMatching: makeLinkedFlagMatcher(null, false),
        },
        anyMatchExpected: ACTIVE,
        allMatchExpected: ACTIVE,
    },

    // URL Trigger status variations
    {
        name: 'trigger pending (means we have config but not yet matched)',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_PENDING,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: BUFFERING,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'trigger disabled (means we do not have config)',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_DISABLED,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: ACTIVE, // nothing to match on, recording is active
        allMatchExpected: ACTIVE, // nothing to match on, recording is active
    },
    {
        name: 'trigger activated',
        config: {
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_ACTIVATED,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: ACTIVE,
        allMatchExpected: ACTIVE,
    },

    // Combined scenarios
    {
        name: 'sampling false with linked flag and active url trigger',
        config: {
            isSampled: false,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_ACTIVATED,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: ACTIVE, // trigger activated, so sampling overridden
        allMatchExpected: DISABLED, // sampling is false so can never have an ALL match
    },
    {
        name: 'sampling false with linked flag and inactive url trigger',
        config: {
            isSampled: false,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_PENDING,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: ACTIVE, // flag is seen, so sampling overridden
        allMatchExpected: BUFFERING,
    },
    {
        name: 'sampling true with pending url trigger',
        config: {
            isSampled: true,
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_PENDING,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: SAMPLED,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'sampling true with pending event trigger',
        config: {
            isSampled: true,
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_PENDING,
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: SAMPLED,
        allMatchExpected: BUFFERING,
    },
    {
        name: 'sampling true with active event trigger',
        config: {
            isSampled: true,
            eventTriggerMatching: {
                ...defaultTriggersStatus.eventTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_ACTIVATED,
            } as unknown as EventTriggerMatching,
        },
        anyMatchExpected: SAMPLED,
        allMatchExpected: SAMPLED,
    },
    {
        name: 'all matches configured and satisfied',
        config: {
            isSampled: true,
            linkedFlagMatching: makeLinkedFlagMatcher('some-flag', true),
            urlTriggerMatching: {
                ...defaultTriggersStatus.urlTriggerMatching,
                _instance: fakePostHog,
                triggerStatus: () => TRIGGER_ACTIVATED,
            } as unknown as URLTriggerMatching,
        },
        anyMatchExpected: SAMPLED,
        allMatchExpected: SAMPLED,
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
