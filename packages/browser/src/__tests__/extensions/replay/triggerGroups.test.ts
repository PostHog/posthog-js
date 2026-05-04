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
import { matchTriggerPropertyFilters } from '../../../utils/property-utils'
import { createMockPostHog } from '../../helpers/posthog-instance'

const fakePostHog = createMockPostHog({
    register_for_session: () => {},
    onFeatureFlags: () => () => {}, // Returns cleanup function
    get_property: () => undefined,
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
                    events: [{ name: '$exception' }, { name: 'error' }],
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
                    events: [{ name: 'checkout_started' }],
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
                    events: [{ name: 'error' }],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            expect(matcher.group.minDurationMs).toBe(0)
        })
    })

    describe('matchTriggerPropertyFilters', () => {
        it('returns true when no filters are provided', () => {
            expect(matchTriggerPropertyFilters(undefined, {}, {})).toBe(true)
            expect(matchTriggerPropertyFilters([], {}, {})).toBe(true)
        })

        it('matches event property with exact operator', () => {
            const filters = [{ key: 'amount', type: 'event' as const, operator: 'exact' as const, value: '100' }]
            expect(matchTriggerPropertyFilters(filters, { amount: '100' }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { amount: '200' }, {})).toBe(false)
        })

        it('matches person property with exact operator', () => {
            const filters = [{ key: 'country', type: 'person' as const, operator: 'exact' as const, value: 'US' }]
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'US' })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { country: 'US' }, {})).toBe(false) // wrong source
        })

        it('matches with icontains operator', () => {
            const filters = [{ key: 'path', type: 'event' as const, operator: 'icontains' as const, value: 'checkout' }]
            expect(matchTriggerPropertyFilters(filters, { path: '/CHECKOUT/step-1' }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { path: '/settings' }, {})).toBe(false)
        })

        it('matches with gt operator', () => {
            const filters = [{ key: 'amount', type: 'event' as const, operator: 'gt' as const, value: '100' }]
            expect(matchTriggerPropertyFilters(filters, { amount: 200 }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { amount: 50 }, {})).toBe(false)
        })

        it('matches with regex operator', () => {
            const filters = [{ key: 'url', type: 'event' as const, operator: 'regex' as const, value: '^/checkout/.*' }]
            expect(matchTriggerPropertyFilters(filters, { url: '/checkout/step-1' }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { url: '/settings' }, {})).toBe(false)
        })

        it('ANDs multiple filters together', () => {
            const filters = [
                { key: 'amount', type: 'event' as const, operator: 'gt' as const, value: '100' },
                { key: 'country', type: 'person' as const, operator: 'exact' as const, value: 'US' },
            ]
            expect(matchTriggerPropertyFilters(filters, { amount: 200 }, { country: 'US' })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { amount: 200 }, { country: 'UK' })).toBe(false) // person fails
            expect(matchTriggerPropertyFilters(filters, { amount: 50 }, { country: 'US' })).toBe(false) // event fails
        })

        it('ORs multiple values within a single exact filter', () => {
            const filters = [
                { key: 'country', type: 'person' as const, operator: 'exact' as const, value: ['US', 'UK'] },
            ]
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'US' })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'UK' })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'DE' })).toBe(false)
        })

        it('ORs multiple values within a single icontains filter', () => {
            const filters = [
                {
                    key: '$current_url',
                    type: 'event' as const,
                    operator: 'icontains' as const,
                    value: ['checkout.acme.com', 'payments.acme.com'],
                },
            ]
            expect(matchTriggerPropertyFilters(filters, { $current_url: 'https://checkout.acme.com/step-1' }, {})).toBe(
                true
            )
            expect(
                matchTriggerPropertyFilters(filters, { $current_url: 'https://payments.acme.com/confirm' }, {})
            ).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { $current_url: 'https://settings.acme.com' }, {})).toBe(false)
        })

        it('ANDs multiple filters with array values (authorized URLs + country)', () => {
            const filters = [
                {
                    key: '$current_url',
                    type: 'event' as const,
                    operator: 'icontains' as const,
                    value: ['checkout.acme.com', 'payments.acme.com'],
                },
                { key: 'country', type: 'person' as const, operator: 'exact' as const, value: ['US', 'UK'] },
            ]
            // URL matches and country matches
            expect(
                matchTriggerPropertyFilters(
                    filters,
                    { $current_url: 'https://checkout.acme.com/cart' },
                    { country: 'US' }
                )
            ).toBe(true)
            // URL matches but country doesn't
            expect(
                matchTriggerPropertyFilters(
                    filters,
                    { $current_url: 'https://checkout.acme.com/cart' },
                    { country: 'DE' }
                )
            ).toBe(false)
            // Country matches but URL doesn't
            expect(
                matchTriggerPropertyFilters(filters, { $current_url: 'https://settings.acme.com' }, { country: 'US' })
            ).toBe(false)
        })

        it('returns false when property is missing', () => {
            const filters = [{ key: 'amount', type: 'event' as const, operator: 'exact' as const, value: '100' }]
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(false)
        })

        it('returns true when property is missing for is_not (absence satisfies negation)', () => {
            const filters = [{ key: 'region', type: 'event' as const, operator: 'is_not' as const, value: 'EU' }]
            // missing event property — "not EU" is satisfied because there's nothing to equal EU
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(true)
            // still rejects when the property IS present and matches the excluded value
            expect(matchTriggerPropertyFilters(filters, { region: 'EU' }, {})).toBe(false)
            // and accepts a present non-matching value
            expect(matchTriggerPropertyFilters(filters, { region: 'US' }, {})).toBe(true)
        })

        it('returns true when property is explicitly null for is_not', () => {
            const filters = [{ key: 'region', type: 'event' as const, operator: 'is_not' as const, value: 'EU' }]
            expect(matchTriggerPropertyFilters(filters, { region: null } as any, {})).toBe(true)
        })

        it('returns true when property is missing for not_icontains', () => {
            const filters = [
                { key: 'path', type: 'event' as const, operator: 'not_icontains' as const, value: 'checkout' },
            ]
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { path: '/CHECKOUT/step-1' }, {})).toBe(false)
            expect(matchTriggerPropertyFilters(filters, { path: '/settings' }, {})).toBe(true)
        })

        it('returns true when property is missing for not_regex', () => {
            const filters = [
                { key: 'url', type: 'event' as const, operator: 'not_regex' as const, value: '^/checkout/.*' },
            ]
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { url: '/checkout/step-1' }, {})).toBe(false)
            expect(matchTriggerPropertyFilters(filters, { url: '/settings' }, {})).toBe(true)
        })

        it('returns true when person property is missing for is_not', () => {
            const filters = [{ key: 'country', type: 'person' as const, operator: 'is_not' as const, value: 'US' }]
            // no person properties at all
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(true)
            // present and matching the excluded value
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'US' })).toBe(false)
        })

        it('returns true when property is missing for is_not with an array filter value', () => {
            const filters = [
                { key: 'country', type: 'person' as const, operator: 'is_not' as const, value: ['US', 'UK'] },
            ]
            // missing — the person is "not in US/UK" because they have no country at all
            expect(matchTriggerPropertyFilters(filters, {}, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'DE' })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'US' })).toBe(false)
            expect(matchTriggerPropertyFilters(filters, {}, { country: 'UK' })).toBe(false)
        })

        it('ANDs a positive filter with an is_not filter where the is_not prop is missing', () => {
            const filters = [
                { key: 'amount', type: 'event' as const, operator: 'gt' as const, value: '100' },
                { key: 'region', type: 'event' as const, operator: 'is_not' as const, value: 'EU' },
            ]
            // gt passes + region missing → "not EU" satisfied → overall match
            expect(matchTriggerPropertyFilters(filters, { amount: 200 }, {})).toBe(true)
            // gt fails → overall rejected regardless of region
            expect(matchTriggerPropertyFilters(filters, { amount: 50 }, {})).toBe(false)
            // gt passes + region = EU → is_not rejects → overall rejected
            expect(matchTriggerPropertyFilters(filters, { amount: 200, region: 'EU' }, {})).toBe(false)
        })

        it('defaults to exact when operator is not provided', () => {
            const filters = [{ key: 'status', type: 'event' as const, value: 'error' }]
            expect(matchTriggerPropertyFilters(filters, { status: 'error' }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { status: 'ok' }, {})).toBe(false)
        })

        it('matches when event property is an array and filter value matches any element', () => {
            const filters = [{ key: 'tags', type: 'event' as const, operator: 'exact' as const, value: 'premium' }]
            expect(matchTriggerPropertyFilters(filters, { tags: ['premium', 'vip'] }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { tags: ['basic', 'trial'] }, {})).toBe(false)
        })

        it('matches array property against array filter values', () => {
            const filters = [
                { key: 'tags', type: 'event' as const, operator: 'exact' as const, value: ['premium', 'enterprise'] },
            ]
            expect(matchTriggerPropertyFilters(filters, { tags: ['premium', 'vip'] }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { tags: ['enterprise'] }, {})).toBe(true)
            expect(matchTriggerPropertyFilters(filters, { tags: ['basic', 'trial'] }, {})).toBe(false)
        })

        it('matches array person property with icontains', () => {
            const filters = [{ key: 'roles', type: 'person' as const, operator: 'icontains' as const, value: 'admin' }]
            expect(matchTriggerPropertyFilters(filters, {}, { roles: ['Admin', 'User'] })).toBe(true)
            expect(matchTriggerPropertyFilters(filters, {}, { roles: ['User', 'Guest'] })).toBe(false)
        })
    })

    describe('Event trigger property evaluation', () => {
        it('activates when event name matches and no properties', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'test',
                name: 'Test',
                sampleRate: 1.0,
                conditions: {
                    matchType: 'any',
                    events: [{ name: 'purchase' }],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            const onActivate = jest.fn()
            matcher.checkEventTriggerConditions('purchase', onActivate, 'session-1')
            expect(onActivate).toHaveBeenCalledWith('event', 'purchase')
        })

        it('does not activate when event name does not match', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'test',
                name: 'Test',
                sampleRate: 1.0,
                conditions: {
                    matchType: 'any',
                    events: [{ name: 'purchase' }],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            const onActivate = jest.fn()
            matcher.checkEventTriggerConditions('pageview', onActivate, 'session-1')
            expect(onActivate).not.toHaveBeenCalled()
        })

        it('activates on event name match regardless of properties (property filtering is in the strategy)', () => {
            const group: SessionRecordingTriggerGroup = {
                id: 'test',
                name: 'Test',
                sampleRate: 1.0,
                conditions: {
                    matchType: 'any',
                    events: [
                        {
                            name: 'purchase',
                            properties: [{ key: 'amount', type: 'event', operator: 'gt', value: '100' }],
                        },
                    ],
                },
            }

            const matcher = new TriggerGroupMatching(fakePostHog, group, () => {})
            const onActivate = jest.fn()
            matcher.checkEventTriggerConditions('purchase', onActivate, 'session-1')
            expect(onActivate).toHaveBeenCalledWith('event', 'purchase')
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
