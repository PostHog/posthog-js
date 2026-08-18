import { isArray, isUndefined } from '@posthog/core'

import type { BehaviorClient, BehaviorScenario } from './harness'

const identityEvents = (client: BehaviorClient) =>
    client.events().map(({ event, properties }) => ({
        event,
        distinctId: client.normalizeId(properties.distinct_id),
        anonymousId: client.normalizeId(properties.$anon_distinct_id),
        plan: properties.plan,
    }))

const eventContext = (client: BehaviorClient, eventName: string) => {
    const properties = client.events().find(({ event }) => event === eventName)?.properties
    if (!properties) {
        throw new Error(`Expected ${eventName} to be admitted`)
    }
    return {
        distinctId: client.normalizeId(properties.distinct_id),
        sessionId: client.normalizeId(properties.$session_id, 'session'),
        windowId: client.normalizeId(properties.$window_id, 'window'),
        groups: properties.$groups ?? {},
    }
}

const deliveredEventNames = (client: BehaviorClient): string[] =>
    client.requests().flatMap(({ body }) => {
        if (!body || typeof body !== 'object') {
            return []
        }
        if ('event' in body && typeof body.event === 'string') {
            return [body.event]
        }
        if ('batch' in body && isArray(body.batch)) {
            return body.batch.flatMap((event) =>
                event && typeof event === 'object' && 'event' in event && typeof event.event === 'string'
                    ? [event.event]
                    : []
            )
        }
        return []
    })

export const anonymousCaptureScenario: BehaviorScenario<unknown> = {
    name: 'anonymous capture preserves caller properties and identity',
    expected: {
        identity: {
            anonymousId: '<anonymous-id-1>',
            distinctId: '<anonymous-id-1>',
            isIdentified: false,
        },
        events: [
            {
                event: 'checkout_started',
                distinctId: '<anonymous-id-1>',
                anonymousId: undefined,
                plan: 'pro',
            },
        ],
        deliveredEventNames: ['checkout_started'],
    },
    async run(client) {
        await client.capture('checkout_started', { plan: 'pro' })
        return {
            identity: client.identity(),
            events: identityEvents(client),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const identifyScenario: BehaviorScenario<unknown> = {
    name: 'first identify links the anonymous identity once',
    expected: {
        identity: {
            anonymousId: '<anonymous-id-1>',
            distinctId: 'user-123',
            isIdentified: true,
        },
        events: [
            {
                event: '$identify',
                distinctId: 'user-123',
                anonymousId: '<anonymous-id-1>',
                plan: undefined,
            },
            {
                event: 'identified_event',
                distinctId: 'user-123',
                anonymousId: undefined,
                plan: 'team',
            },
        ],
        deliveredEventNames: ['$identify', 'identified_event'],
    },
    async run(client) {
        await client.identify('user-123')
        await client.capture('identified_event', { plan: 'team' })
        return {
            identity: client.identity(),
            events: identityEvents(client),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const optOutScenario: BehaviorScenario<unknown> = {
    name: 'explicit opt-out suppresses later capture',
    expected: {
        optedOut: true,
        eventNames: ['before_opt_out'],
        deliveredEventNames: ['before_opt_out'],
    },
    async run(client) {
        await client.capture('before_opt_out')
        client.optOut()
        await client.capture('after_opt_out')
        return {
            optedOut: client.hasOptedOut(),
            eventNames: client.events().map(({ event }) => event),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const defaultOptOutScenario: BehaviorScenario<unknown> = {
    name: 'default opt-out blocks identity and capture until explicit opt-in',
    setup: { optOutByDefault: true },
    expected: {
        before: {
            anonymousId: '<anonymous-id-1>',
            distinctId: '<anonymous-id-1>',
            isIdentified: false,
        },
        afterDeniedIdentify: {
            anonymousId: '<anonymous-id-1>',
            distinctId: '<anonymous-id-1>',
            isIdentified: false,
        },
        optedOutAfterGrant: false,
        events: [
            {
                event: 'after_consent',
                distinctId: '<anonymous-id-1>',
                anonymousId: undefined,
                plan: undefined,
            },
        ],
        deliveredEventNames: ['after_consent'],
    },
    legacyExpected: {
        before: {
            anonymousId: '<anonymous-id-1>',
            distinctId: '<anonymous-id-1>',
            isIdentified: false,
        },
        afterDeniedIdentify: {
            anonymousId: '<anonymous-id-1>',
            distinctId: 'blocked-user',
            isIdentified: true,
        },
        optedOutAfterGrant: false,
        events: [
            {
                event: 'after_consent',
                distinctId: 'blocked-user',
                anonymousId: undefined,
                plan: undefined,
            },
        ],
        deliveredEventNames: ['after_consent'],
    },
    async run(client) {
        const before = client.identity()
        await client.identify('blocked-user')
        await client.capture('before_consent')
        const afterDeniedIdentify = client.identity()
        client.optIn()
        await client.capture('after_consent')
        return {
            before,
            afterDeniedIdentify,
            optedOutAfterGrant: client.hasOptedOut(),
            events: identityEvents(client),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const consentResumeScenario: BehaviorScenario<unknown> = {
    name: 'capture resumes after an explicit denial is revoked',
    expected: {
        optedOutAfterDeny: true,
        optedOutAfterGrant: false,
        eventNames: ['before_denial', 'after_grant'],
        deliveredEventNames: ['before_denial', 'after_grant'],
    },
    async run(client) {
        await client.capture('before_denial')
        client.optOut()
        const optedOutAfterDeny = client.hasOptedOut()
        await client.capture('during_denial')
        client.optIn()
        const optedOutAfterGrant = client.hasOptedOut()
        await client.capture('after_grant')
        return {
            optedOutAfterDeny,
            optedOutAfterGrant,
            eventNames: client.events().map(({ event }) => event),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const repeatedIdentifyScenario: BehaviorScenario<unknown> = {
    name: 'repeating identify with the same ID links the anonymous identity once',
    expected: {
        identity: {
            anonymousId: '<anonymous-id-1>',
            distinctId: 'user-123',
            isIdentified: true,
        },
        events: [
            {
                event: '$identify',
                distinctId: 'user-123',
                anonymousId: '<anonymous-id-1>',
                plan: undefined,
            },
            {
                event: 'after_repeat',
                distinctId: 'user-123',
                anonymousId: undefined,
                plan: undefined,
            },
        ],
        deliveredEventNames: ['$identify', 'after_repeat'],
    },
    async run(client) {
        await client.identify('user-123')
        await client.identify('user-123')
        await client.capture('after_repeat')
        return {
            identity: client.identity(),
            events: identityEvents(client),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const identifiedSwitchScenario: BehaviorScenario<unknown> = {
    name: 'switching identified IDs does not relink the anonymous identity',
    expected: {
        identity: {
            anonymousId: '<anonymous-id-1>',
            distinctId: 'user-two',
            isIdentified: true,
        },
        events: [
            {
                event: '$identify',
                distinctId: 'user-one',
                anonymousId: '<anonymous-id-1>',
                plan: undefined,
            },
            {
                event: '$set',
                distinctId: 'user-two',
                anonymousId: undefined,
                plan: undefined,
            },
            {
                event: 'after_switch',
                distinctId: 'user-two',
                anonymousId: undefined,
                plan: undefined,
            },
        ],
        mutation: { role: 'admin' },
        deliveredEventNames: ['$identify', '$set', 'after_switch'],
    },
    async run(client) {
        await client.identify('user-one')
        await client.identify('user-two', { role: 'admin' })
        await client.capture('after_switch')
        const mutation = client.events().find(({ event }) => event === '$set')
        return {
            identity: client.identity(),
            events: identityEvents(client),
            mutation: mutation?.properties.$set,
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const resetScenario: BehaviorScenario<unknown> = {
    name: 'reset clears identified state and groups and starts a new session (D7 provisional window behavior)',
    expected: {
        identity: {
            anonymousId: '<anonymous-id-2>',
            distinctId: '<anonymous-id-2>',
            isIdentified: false,
        },
        groups: {},
        before: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        after: {
            distinctId: '<anonymous-id-2>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-1>',
            groups: {},
        },
        deliveredEventNames: ['before_reset', '$identify', '$groupidentify', 'after_reset'],
    },
    legacyExpected: {
        identity: {
            anonymousId: '<anonymous-id-2>',
            distinctId: '<anonymous-id-2>',
            isIdentified: false,
        },
        groups: {},
        before: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        after: {
            distinctId: '<anonymous-id-2>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-2>',
            groups: {},
        },
        deliveredEventNames: ['before_reset', '$identify', '$groupidentify', 'after_reset'],
    },
    async run(client) {
        await client.capture('before_reset')
        await client.identify('user-123')
        await client.group('organization', 'org-123')
        client.reset()
        await client.capture('after_reset')
        return {
            identity: client.identity(),
            groups: client.groups(),
            before: eventContext(client, 'before_reset'),
            after: eventContext(client, 'after_reset'),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const activeSessionScenario: BehaviorScenario<unknown> = {
    name: 'ordinary activity retains the session and window IDs',
    expected: {
        first: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        second: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
    },
    async run(client, runtime) {
        await client.capture('session_first')
        runtime.advanceTime(10 * 60 * 1000)
        await client.capture('session_second')
        return {
            first: eventContext(client, 'session_first'),
            second: eventContext(client, 'session_second'),
        }
    },
}

export const idleSessionScenario: BehaviorScenario<unknown> = {
    name: 'activity after the idle timeout rotates the session (D7 provisional window behavior)',
    expected: {
        first: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        second: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-1>',
            groups: {},
        },
    },
    legacyExpected: {
        first: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        second: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-2>',
            groups: {},
        },
    },
    async run(client, runtime) {
        await client.capture('idle_first')
        runtime.advanceTime(30 * 60 * 1000 + 1)
        await client.capture('idle_second')
        return {
            first: eventContext(client, 'idle_first'),
            second: eventContext(client, 'idle_second'),
        }
    },
}

export const identifyPropertiesScenario: BehaviorScenario<unknown> = {
    name: 'same-ID identify emits one person-property mutation without relinking',
    expected: {
        eventNames: ['$identify', '$set'],
        identify: {
            distinctId: 'user-123',
            anonymousId: '<anonymous-id-1>',
            set: { email: 'first@example.com' },
            setOnce: {},
        },
        mutation: {
            distinctId: 'user-123',
            anonymousId: undefined,
            set: { plan: 'pro' },
            setOnce: { source: 'docs' },
        },
        deliveredEventNames: ['$identify', '$set'],
    },
    async run(client) {
        await client.identify('user-123', { email: 'first@example.com' })
        await client.identify('user-123', { plan: 'pro' }, { source: 'docs' })
        const [identify, mutation] = client.events()
        const project = (record: typeof identify | undefined, setKeys: string[], setOnceKeys: string[]) => {
            const set = record?.properties.$set as Record<string, unknown> | undefined
            const setOnce = record?.properties.$set_once as Record<string, unknown> | undefined
            return {
                distinctId: client.normalizeId(record?.properties.distinct_id),
                anonymousId: client.normalizeId(record?.properties.$anon_distinct_id),
                set: Object.fromEntries(setKeys.flatMap((key) => (isUndefined(set?.[key]) ? [] : [[key, set[key]]]))),
                setOnce: Object.fromEntries(
                    setOnceKeys.flatMap((key) => (isUndefined(setOnce?.[key]) ? [] : [[key, setOnce[key]]]))
                ),
            }
        }
        return {
            eventNames: client.events().map(({ event }) => event),
            identify: project(identify, ['email'], []),
            mutation: project(mutation, ['plan'], ['source']),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const groupScenario: BehaviorScenario<unknown> = {
    name: 'group membership is attached to the group-identify event and later capture',
    expected: {
        groups: { organization: 'org-123' },
        groupIdentify: {
            groupType: 'organization',
            groupKey: 'org-123',
            groupSet: { name: 'Acme' },
            groups: { organization: 'org-123' },
        },
        after: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: { organization: 'org-123' },
        },
        deliveredEventNames: ['$groupidentify', 'after_group'],
    },
    async run(client) {
        await client.group('organization', 'org-123', { name: 'Acme' })
        await client.capture('after_group')
        const groupIdentify = client.events().find(({ event }) => event === '$groupidentify')?.properties
        return {
            groups: client.groups(),
            groupIdentify: {
                groupType: groupIdentify?.$group_type,
                groupKey: groupIdentify?.$group_key,
                groupSet: groupIdentify?.$group_set,
                groups: groupIdentify?.$groups,
            },
            after: eventContext(client, 'after_group'),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const groupIdempotenceScenario: BehaviorScenario<unknown> = {
    name: 'an unchanged group is a no-op unless group properties are supplied',
    expected: {
        groups: { organization: 'org-123' },
        groupIdentifyEvents: [
            {
                groupType: 'organization',
                groupKey: 'org-123',
                groupSet: undefined,
            },
            {
                groupType: 'organization',
                groupKey: 'org-123',
                groupSet: { name: 'Acme' },
            },
        ],
        deliveredEventNames: ['$groupidentify', '$groupidentify'],
    },
    async run(client) {
        await client.group('organization', 'org-123')
        await client.group('organization', 'org-123')
        await client.group('organization', 'org-123', { name: 'Acme' })
        return {
            groups: client.groups(),
            groupIdentifyEvents: client.events().map(({ properties }) => ({
                groupType: properties.$group_type,
                groupKey: properties.$group_key,
                groupSet: properties.$group_set,
            })),
            deliveredEventNames: deliveredEventNames(client),
        }
    },
}

export const maxLengthSessionScenario: BehaviorScenario<unknown> = {
    name: 'continuous activity rotates a session after its maximum length (D7 provisional window behavior)',
    expected: {
        first: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        atLimit: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        afterLimit: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-1>',
            groups: {},
        },
    },
    legacyExpected: {
        first: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        atLimit: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-1>',
            windowId: '<window-id-1>',
            groups: {},
        },
        afterLimit: {
            distinctId: '<anonymous-id-1>',
            sessionId: '<session-id-2>',
            windowId: '<window-id-2>',
            groups: {},
        },
    },
    async run(client, runtime) {
        await client.capture('maximum_first')
        for (let interval = 1; interval <= 72; interval++) {
            runtime.advanceTime(20 * 60 * 1000)
            await client.capture(`maximum_tick_${interval}`)
        }
        runtime.advanceTime(1)
        await client.capture('maximum_after')
        return {
            first: eventContext(client, 'maximum_first'),
            atLimit: eventContext(client, 'maximum_tick_72'),
            afterLimit: eventContext(client, 'maximum_after'),
        }
    },
}
