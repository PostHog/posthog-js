import {
    BUFFERING,
    DISABLED,
    RecordingTriggersStatusV2,
    RRWEB_ERROR,
    SAMPLED,
    TriggerGroupMatching,
    triggerGroupsMatchSessionRecordingStatus,
    TRIGGER_ACTIVATED,
    TRIGGER_DISABLED,
    TRIGGER_PENDING,
    URLTriggerMatching,
    EventTriggerMatching,
    LinkedFlagMatching,
    PAUSED,
} from '../../../extensions/replay/external/triggerMatching'
import { SessionRecordingTriggerGroup } from '../../../types'
import { createMockPostHog } from '../../helpers/posthog-instance'

const fakePostHog = createMockPostHog({
    register_for_session: () => {},
    onFeatureFlags: () => () => {}, // Returns cleanup function
})

// Shared test helper: Creates a mock TriggerGroupMatching with optional overrides
const createMockMatcher = (
    id: string,
    triggerStatus: 'trigger_activated' | 'trigger_pending' | 'trigger_disabled',
    overrides?: Partial<SessionRecordingTriggerGroup>
): TriggerGroupMatching => {
    return {
        group: {
            id,
            name: `Group ${id}`,
            sampleRate: 1.0,
            conditions: { matchType: 'any' },
            ...overrides,
        },
        triggerStatus: () => triggerStatus,
        stop: () => {},
    } as unknown as TriggerGroupMatching
}

// Shared test base status for all triggerGroupsMatchSessionRecordingStatus tests
const createBaseStatus = (): RecordingTriggersStatusV2 => ({
    receivedFlags: true,
    isRecordingEnabled: true,
    isSampled: null,
    rrwebError: false,
    urlTriggerMatching: {
        urlBlocked: false,
        triggerStatus: () => TRIGGER_DISABLED,
    } as unknown as URLTriggerMatching,
    eventTriggerMatching: {} as EventTriggerMatching,
    linkedFlagMatching: {} as LinkedFlagMatching,
    sessionId: 'test-session',
    triggerGroupMatchers: [],
    triggerGroupSamplingResults: new Map(),
    minimumDuration: null,
})

describe('V2 Trigger Groups', () => {
    describe('TriggerGroupMatching', () => {
        it('should create matcher with event triggers and ANY match type', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'group-1',
                name: 'Error Tracking',
                sampleRate: 1.0,
                conditions: {
                    matchType: 'any',
                    events: ['$exception', 'error'],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            expect(matcher.group).toEqual(group)
        })

        it('should create matcher with URL triggers and ALL match type', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'group-2',
                name: 'Checkout Flow',
                sampleRate: 0.5,
                conditions: {
                    matchType: 'all',
                    urls: [{ url: '/checkout', matching: 'regex' }],
                    events: ['checkout_started'],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            expect(matcher.group).toEqual(group)
        })

        it('should create matcher with feature flag', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'group-3',
                name: 'Beta Users',
                sampleRate: 1.0,
                conditions: {
                    matchType: 'any',
                    flag: 'beta-users',
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            expect(matcher.group).toEqual(group)
        })

        it('should create matcher with minDurationMs', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'group-4',
                name: 'Quick Sessions',
                sampleRate: 1.0,
                minDurationMs: 0,
                conditions: {
                    matchType: 'any',
                    events: ['error'],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            expect(matcher.group.minDurationMs).toBe(0)
        })
    })

    describe('triggerGroupsMatchSessionRecordingStatus - Basic States', () => {
        // Parameterized tests for basic pre-condition checks
        test.each([
            {
                name: 'rrweb error',
                statusOverrides: { rrwebError: true },
                expectedStatus: RRWEB_ERROR,
            },
            {
                name: 'flags not received',
                statusOverrides: { receivedFlags: false },
                expectedStatus: BUFFERING,
            },
            {
                name: 'recording not enabled',
                statusOverrides: { isRecordingEnabled: false },
                expectedStatus: DISABLED,
            },
            {
                name: 'no trigger groups configured',
                statusOverrides: { triggerGroupMatchers: [] },
                expectedStatus: DISABLED,
            },
        ])('should return $expectedStatus when $name', ({ statusOverrides, expectedStatus }) => {
            const status = triggerGroupsMatchSessionRecordingStatus({
                ...createBaseStatus(),
                ...statusOverrides,
            })
            expect(status).toBe(expectedStatus)
        })

        it('should return PAUSED when URL is blocked', () => {
            const status = triggerGroupsMatchSessionRecordingStatus({
                ...createBaseStatus(),
                urlTriggerMatching: {
                    urlBlocked: true,
                    triggerStatus: () => TRIGGER_DISABLED,
                } as unknown as URLTriggerMatching,
                triggerGroupMatchers: [createMockMatcher('group-1', TRIGGER_ACTIVATED)],
            })
            expect(status).toBe(PAUSED)
        })
    })

    describe('triggerGroupsMatchSessionRecordingStatus - Union Behavior', () => {
        // Parameterized tests for union (OR) behavior across trigger groups
        test.each([
            {
                name: 'ANY group is activated and sampled',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_ACTIVATED),
                    createMockMatcher('group-2', TRIGGER_DISABLED),
                ],
                samplingResults: new Map([
                    ['group-1', true],
                    ['group-2', false],
                ]),
                expectedStatus: SAMPLED,
            },
            {
                name: 'group activated but sample missed',
                matchers: [createMockMatcher('group-1', TRIGGER_ACTIVATED)],
                samplingResults: new Map([['group-1', false]]),
                expectedStatus: DISABLED, // Sampled out = don't record
            },
            {
                name: 'multiple groups activated and ANY sampled',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_ACTIVATED),
                    createMockMatcher('group-2', TRIGGER_ACTIVATED),
                    createMockMatcher('group-3', TRIGGER_ACTIVATED),
                ],
                samplingResults: new Map([
                    ['group-1', false],
                    ['group-2', true], // Only group-2 sampled
                    ['group-3', false],
                ]),
                expectedStatus: SAMPLED,
            },
            {
                name: 'ANY group is pending',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_PENDING),
                    createMockMatcher('group-2', TRIGGER_DISABLED),
                ],
                samplingResults: new Map(),
                expectedStatus: BUFFERING,
            },
            {
                name: 'all groups disabled',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_DISABLED),
                    createMockMatcher('group-2', TRIGGER_DISABLED),
                ],
                samplingResults: new Map(),
                expectedStatus: DISABLED,
            },
            {
                name: 'mix of activated (sampled), pending, and disabled groups',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_ACTIVATED),
                    createMockMatcher('group-2', TRIGGER_PENDING),
                    createMockMatcher('group-3', TRIGGER_DISABLED),
                ],
                samplingResults: new Map([
                    ['group-1', true],
                    ['group-2', false],
                    ['group-3', false],
                ]),
                expectedStatus: SAMPLED, // group-1 activated and sampled wins
            },
        ])('should return $expectedStatus when $name', ({ matchers, samplingResults, expectedStatus }) => {
            const status = triggerGroupsMatchSessionRecordingStatus({
                ...createBaseStatus(),
                triggerGroupMatchers: matchers,
                triggerGroupSamplingResults: samplingResults,
            })
            expect(status).toBe(expectedStatus)
        })
    })

    describe('triggerGroupsMatchSessionRecordingStatus - Edge Cases', () => {
        // Parameterized tests for edge cases with sampling results
        test.each([
            {
                name: 'empty sampling results map',
                matchers: [createMockMatcher('group-1', TRIGGER_ACTIVATED)],
                samplingResults: new Map(),
                expectedStatus: DISABLED, // Activated but no sampling decision = don't record
            },
            {
                name: 'missing sampling result for activated group',
                matchers: [
                    createMockMatcher('group-1', TRIGGER_ACTIVATED),
                    createMockMatcher('group-2', TRIGGER_ACTIVATED),
                ],
                samplingResults: new Map([['group-1', false]]), // group-2 missing
                expectedStatus: DISABLED, // Neither group sampled in = don't record
            },
        ])('should return $expectedStatus when $name', ({ matchers, samplingResults, expectedStatus }) => {
            const status = triggerGroupsMatchSessionRecordingStatus({
                ...createBaseStatus(),
                triggerGroupMatchers: matchers,
                triggerGroupSamplingResults: samplingResults,
            })
            expect(status).toBe(expectedStatus)
        })
    })
})
