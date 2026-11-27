import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    BROWSER_TOPICS,
    findDisallowedSkillUrls,
    formatCompactSignature,
    formatSkillIndexTable,
    groupCapabilitiesIntoTopics,
    isConfigType,
    rewriteRelativeDocsLinks,
    stripNonPostHogLinks,
    updateSkillIndex,
} from '../sdk-reference-helpers.mjs'

describe('groupCapabilitiesIntoTopics', () => {
    test('maps all declared browser capabilities into 9 topics and preserves utils', () => {
        const capabilities = [
            { slug: 'setup', title: 'Setup', sections: ['## Setup', '### `PostHog.init`'], labels: ['PostHog.init'] },
            {
                slug: 'capture',
                title: 'Capture',
                sections: ['## Capture', '### `PostHog.capture`'],
                labels: ['PostHog.capture'],
            },
            {
                slug: 'identify',
                title: 'Identify',
                sections: ['## Identify', '### `PostHog.identify`'],
                labels: ['PostHog.identify'],
            },
            {
                slug: 'get-feature-flag',
                title: 'Get feature flag',
                sections: ['## Get feature flag', '### `PostHog.getFeatureFlag`'],
                labels: ['PostHog.getFeatureFlag'],
            },
            {
                slug: 'start-session-recording',
                title: 'Start session recording',
                sections: ['## Start session recording', '### `PostHog.startSessionRecording`'],
                labels: ['PostHog.startSessionRecording'],
            },
            {
                slug: 'capture-exception',
                title: 'Capture exception',
                sections: ['## Capture exception', '### `PostHog.captureException`'],
                labels: ['PostHog.captureException'],
            },
            {
                slug: 'surveys',
                title: 'Surveys',
                sections: ['## Surveys', '### `PostHog.getSurveys`'],
                labels: ['PostHog.getSurveys'],
            },
            {
                slug: 'opt-in',
                title: 'Opt in',
                sections: ['## Opt in', '### `PostHog.opt_in_capturing`'],
                labels: ['PostHog.opt_in_capturing'],
            },
        ]
        const utils = { sections: ['## SDK utils', '### `sampleByEvent`'], labels: ['sampleByEvent'] }

        const topics = groupCapabilitiesIntoTopics(capabilities, utils, BROWSER_TOPICS)
        assert.deepEqual(
            topics.map((t) => t.slug),
            [
                'setup',
                'events',
                'identity',
                'feature-flags',
                'session-replay',
                'error-tracking',
                'surveys',
                'privacy',
                'utils',
            ]
        )
        assert.deepEqual(topics.find((t) => t.slug === 'events').labels, ['PostHog.capture'])
        assert.deepEqual(topics.find((t) => t.slug === 'utils').labels, ['sampleByEvent'])
    })

    test('routes group-identify into identity and throws on unassigned capabilities', () => {
        const withGroupIdentify = [
            { slug: 'setup', title: 'Setup', sections: ['## Setup'], labels: ['PostHog.init'] },
            {
                slug: 'group-identify',
                title: 'Group identify',
                sections: ['## Group identify', '### `PostHog.groupIdentify`'],
                labels: ['PostHog.groupIdentify'],
            },
        ]
        const topics = groupCapabilitiesIntoTopics(withGroupIdentify, { sections: [], labels: [] }, BROWSER_TOPICS)
        const identity = topics.find((t) => t.slug === 'identity')
        assert.ok(identity)
        assert.deepEqual(identity.labels, ['PostHog.groupIdentify'])

        const withUnassigned = [
            { slug: 'setup', title: 'Setup', sections: ['## Setup'], labels: ['PostHog.init'] },
            {
                slug: 'future-widgets',
                title: 'Future widgets',
                sections: ['## Future widgets', '### `PostHog.openWidget`'],
                labels: ['PostHog.openWidget'],
            },
        ]
        assert.throws(
            () => groupCapabilitiesIntoTopics(withUnassigned, { sections: [], labels: [] }, BROWSER_TOPICS),
            /Unassigned SDK capability\(s\): future-widgets/
        )
    })
})

describe('isConfigType', () => {
    test('includes PostHogConfig, SessionRecordingOptions, ConfigDefaults, and *Config types', () => {
        assert.equal(isConfigType('PostHogConfig'), true)
        assert.equal(isConfigType('SessionRecordingOptions'), true)
        assert.equal(isConfigType('ConfigDefaults'), true)
        assert.equal(isConfigType('AutocaptureConfig'), true)
        assert.equal(isConfigType('FeatureFlagsConfig'), true)
        assert.equal(isConfigType('CaptureResult'), false)
        assert.equal(isConfigType('EventName'), false)
    })
})

describe('skill link rewriting and strict PostHog domain lock', () => {
    test('rewrites relative /docs/ links to https://posthog.com/docs/....md outside code fences', () => {
        const input = [
            'See [capture](/docs/product-analytics/capture-events) and [custom](/docs/surveys/custom#fetching).',
            'Already [md](/docs/libraries/js.md).',
            '```md',
            '[code link](/docs/not-touched)',
            '```',
        ].join('\n')
        const out = rewriteRelativeDocsLinks(input)
        assert.match(out, /\[capture\]\(https:\/\/posthog\.com\/docs\/product-analytics\/capture-events\.md\)/)
        assert.match(out, /\[custom\]\(https:\/\/posthog\.com\/docs\/surveys\/custom\.md#fetching\)/)
        assert.match(out, /\[md\]\(https:\/\/posthog\.com\/docs\/libraries\/js\.md\)/)
        assert.match(out, /\[code link\]\(\/docs\/not-touched\)/)
    })

    test('strips non-PostHog markdown and bare links while keeping PostHog and local links', () => {
        const input =
            'Use [rrweb guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md), See https://nextjs.org/docs/fetch, [local](./references/setup.md), [docs](https://posthog.com/docs/libraries/js.md), and [repo](https://github.com/PostHog/posthog-js).'
        const out = stripNonPostHogLinks(input)
        assert.equal(findDisallowedSkillUrls(out).length, 0)
        assert.match(out, /rrweb guide/)
        assert.match(out, /\[local\]\(\.\/references\/setup\.md\)/)
        assert.match(out, /\[docs\]\(https:\/\/posthog\.com\/docs\/libraries\/js\.md\)/)
        assert.match(out, /\[repo\]\(https:\/\/github\.com\/PostHog\/posthog-js\)/)
    })

    test('flags disallowed external domains outside PostHog and example placeholders', () => {
        const allowed = [
            'See [local](./references/events.md).',
            'Docs at https://posthog.com/docs/advanced/proxy.md and https://app.posthog.com/project/settings.',
            'Host https://us.i.posthog.com and https://github.com/PostHog/posthog-js.',
            'Example https://example.com and http://localhost:3000.',
        ].join('\n')
        assert.deepEqual(findDisallowedSkillUrls(allowed), [])

        const bad = 'Check https://outside.invalid/spec and [Next](https://nextjs.org/docs/fetch).'
        assert.deepEqual(findDisallowedSkillUrls(bad), [
            'https://outside.invalid/spec',
            'https://nextjs.org/docs/fetch',
        ])
    })
})

describe('updateSkillIndex and formatCompactSignature', () => {
    test('formats method and constructor signatures with optional and rest parameters', () => {
        assert.equal(
            formatCompactSignature('PostHog.capture', {
                signatures: [
                    {
                        parameters: [
                            { name: 'event_name', flags: {} },
                            { name: 'properties', flags: { isOptional: true } },
                            { name: 'options', flags: { isOptional: true } },
                        ],
                    },
                ],
            }),
            'posthog.capture(event_name, properties?, options?)'
        )
        assert.equal(formatCompactSignature('new PostHog(...)', { signatures: [{ parameters: [] }] }), 'new PostHog()')
        assert.equal(formatCompactSignature('PostHog.version', {}), 'PostHog.version')
        const table = formatSkillIndexTable([
            { file: 'events.md', description: 'Capture events', signatures: '`posthog.capture(event_name)`' },
        ])
        assert.match(table, /\| Reference file \| Covers \| Key signatures \|/)
    })

    test('replaces generated index between markers and throws if markers are missing', () => {
        const before = '# Skill\n\n<!-- BEGIN GENERATED INDEX -->\nold\n<!-- END GENERATED INDEX -->\n\n## End\n'
        const after = updateSkillIndex(before, '| File | Summary |\n| --- | --- |')
        assert.equal(
            after,
            '# Skill\n\n<!-- BEGIN GENERATED INDEX -->\n| File | Summary |\n| --- | --- |\n<!-- END GENERATED INDEX -->\n\n## End\n'
        )
        assert.throws(() => updateSkillIndex('# No markers', 'table'), /BEGIN GENERATED INDEX/)
    })
})
