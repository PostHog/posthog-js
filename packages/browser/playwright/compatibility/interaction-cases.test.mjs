import test from 'node:test'
import assert from 'node:assert/strict'
import { assertInteractionProof, interactionScenarios } from './interaction-cases.mjs'
import { normalize, differences } from './normalize.mjs'
import { completeCoverage } from './options.mjs'

const auto = (id, type = 'click', event = '$autocapture') => ({
    event,
    properties: { $event_type: type, $elements: [{ attr__id: id }] },
})

test('form proof requires submit/change events and preserves input privacy checks', () => {
    const category = auto('category', 'change')
    category.properties.$input_value = 'widgets'
    const network = { events: [auto('compat-form', 'submit'), category, auto('plan', 'change')] }
    assertInteractionProof('forms', network, { submissions: 1 }, 'current')
    assert.throws(() =>
        assertInteractionProof('forms', { events: network.events.slice(1) }, { submissions: 1 }, 'current')
    )
    assert.throws(() =>
        assertInteractionProof(
            'forms',
            { events: [...network.events, auto('private-input', 'change')] },
            { submissions: 1 },
            'current'
        )
    )
    assert.throws(() =>
        assertInteractionProof(
            'forms',
            { events: [...network.events, { event: '$autocapture', properties: { value: 'form-secret-password' } }] },
            { submissions: 1 },
            'current'
        )
    )
})

test('form value proof requires exact opt-in values and keeps unannotated controls private', () => {
    const category = auto('category', 'change')
    category.properties.$input_value = 'widgets'
    const network = { events: [auto('compat-form', 'submit'), category, auto('plan', 'change')] }
    for (const value of [undefined, 'wrong']) {
        const broken = structuredClone(network)
        broken.events[1].properties.$input_value = value
        assert.throws(() => assertInteractionProof('forms', broken, { submissions: 1 }, 'current'))
    }
    const unannotated = structuredClone(network)
    unannotated.events[2].properties.$input_value = 'pro'
    assert.throws(() => assertInteractionProof('forms', unannotated, { submissions: 1 }, 'current'))

    for (const key of ['$elements', '$elements_chain']) {
        const duplicated = structuredClone(network)
        if (key === '$elements') duplicated.events[1].properties.$elements[0].attr__value = 'widgets'
        else duplicated.events[1].properties.$elements_chain = 'input:attr__id="category",attr__value="widgets"'
        assert.throws(
            () => assertInteractionProof('forms', duplicated, { submissions: 1 }, 'current'),
            /Opted-in value appeared in the element hierarchy/
        )
    }

    const historical = structuredClone(network)
    delete historical.events[1].properties.$input_value
    assertInteractionProof('forms', historical, { submissions: 1 }, 'historical')
    assert.throws(() => assertInteractionProof('forms', network, { submissions: 1 }, 'historical'))
    assert.throws(() => assertInteractionProof('forms', historical, { submissions: 1 }, undefined))
})

test('link proof requires actual navigation, destination attribution and privacy', () => {
    const link = auto('compat-link')
    link.properties.$elements[0].attr__href = '/after?destination=compat#link'
    const network = { events: [link] }
    assertInteractionProof('links', network, { destinationLoaded: true })
    assert.throws(() => assertInteractionProof('links', network, { destinationLoaded: false }))
    assert.throws(() =>
        assertInteractionProof('links', { events: [link, auto('private-link')] }, { destinationLoaded: true })
    )
})

test('rage proof distinguishes rapid and spaced clicks', () => {
    const network = {
        events: [
            auto('rage-target'),
            auto('rage-target'),
            auto('rage-target'),
            auto('rage-target', 'click', '$rageclick'),
        ],
    }
    assertInteractionProof('rage-clicks', network, {})
    assert.throws(() => assertInteractionProof('rage-clicks', { events: network.events.slice(0, 3) }, {}))
    assert.throws(() =>
        assertInteractionProof(
            'rage-clicks',
            { events: [...network.events, auto('spaced-target', 'click', '$rageclick')] },
            {}
        )
    )
})

test('dead-click proof requires a loaded native dependency and rejects responsive/private detections', () => {
    const network = {
        events: [auto('dead-target', 'click', '$dead_click')],
        requests: [{ path: '/static/dead-clicks-autocapture.js', status: 200 }],
    }
    assertInteractionProof('dead-clicks', network, { response: 'Responded' })
    assert.throws(() => assertInteractionProof('dead-clicks', { ...network, requests: [] }, { response: 'Responded' }))
    for (const id of ['responsive-target', 'private-dead'])
        assert.throws(() =>
            assertInteractionProof(
                'dead-clicks',
                { ...network, events: [...network.events, auto(id, 'click', '$dead_click')] },
                { response: 'Responded' }
            )
        )
})

test('scroll proof requires delivered depth, percentages and linked pageview/pageleave IDs', () => {
    const expected = {
        $prev_pageview_max_scroll_percentage: 0.5,
        $prev_pageview_last_scroll_percentage: 0.2,
        $prev_pageview_max_content_percentage: 0.75,
        $prev_pageview_last_content_percentage: 0.4,
    }
    const network = {
        events: [
            { event: '$pageview', properties: { $pageview_id: 'one' } },
            {
                event: '$pageleave',
                properties: {
                    $prev_pageview_id: 'one',
                    $prev_pageview_max_scroll: 600,
                    $prev_pageview_last_scroll: 200,
                    ...expected,
                },
            },
        ],
    }
    assertInteractionProof('scrolling', network, { expected })
    for (const key of ['$prev_pageview_id', '$prev_pageview_max_scroll', ...Object.keys(expected)]) {
        const broken = structuredClone(network)
        broken.events[1].properties[key] = 'wrong'
        assert.throws(() => assertInteractionProof('scrolling', broken, { expected }))
    }
})

test('heatmap proof requires coordinates, fixed positioning, movement, rage/dead points and disable behavior', () => {
    const points = [
        { type: 'click', x: 120, y: 920, target_fixed: false },
        { type: 'click', x: 900, y: 40, target_fixed: true },
        { type: 'mousemove', x: 400, y: 1000, target_fixed: false },
        { type: 'rageclick' },
        { type: 'deadclick' },
    ]
    const network = { events: [{ event: '$$heatmap', properties: { $heatmap_data: { '/': points } } }] }
    assertInteractionProof('heatmaps', network, { disabledDeliveryCount: 0 })
    for (let index = 0; index < points.length; index++) {
        const broken = structuredClone(network)
        broken.events[0].properties.$heatmap_data['/'].splice(index, 1)
        assert.throws(() => assertInteractionProof('heatmaps', broken, { disabledDeliveryCount: 0 }))
    }
    assert.throws(() => assertInteractionProof('heatmaps', network, { disabledDeliveryCount: 1 }))
})

test('pageview identity normalization preserves cross-event relationships', () => {
    const a = '11111111-1111-4111-8111-111111111111',
        b = '22222222-2222-4222-8222-222222222222'
    const sample = (id) => ({
        network: {
            events: [
                { event: '$pageview', properties: { $pageview_id: id } },
                { event: '$pageleave', properties: { $prev_pageview_id: id } },
            ],
        },
    })
    const context = { origin: 'http://127.0.0.1:1234', version: '1.436.1' }
    assert.deepEqual(normalize(sample(a), context), normalize(sample(b), context))
    const broken = sample(b)
    broken.network.events[1].properties.$prev_pageview_id = a
    assert(differences(normalize(sample(a), context), normalize(broken, context)).length)
})

test('only SDK heatmap URL keys normalize; coordinates and application URL keys remain significant', () => {
    const sample = (origin) => ({
        network: {
            events: [
                {
                    event: '$$heatmap',
                    properties: {
                        $heatmap_data: {
                            [origin + '/?retained=1']: [{ x: 1, y: 2, target_fixed: false, type: 'click' }],
                        },
                    },
                },
            ],
        },
    })
    const a = 'http://127.0.0.1:1234',
        b = 'http://127.0.0.1:5678'
    const context = (origin) => ({ origin, version: '1.436.1' })
    assert.deepEqual(normalize(sample(a), context(a)), normalize(sample(b), context(b)))
    const broken = sample(b)
    broken.network.events[0].properties.$heatmap_data[b + '/?retained=1'][0].y = 3
    assert(differences(normalize(sample(a), context(a)), normalize(broken, context(b))).length)
    const application = {
        network: { events: [{ event: 'application', properties: { nested: { [a + '/']: 'retained' } } }] },
    }
    assert.equal(normalize(application, context(a)).network.events[0].properties.nested[a + '/'], 'retained')
})

test('independent autocapture deliveries reorder without discarding changes or payload-array order', () => {
    const context = { origin: 'http://127.0.0.1:1234', version: '1.436.1' }
    const click = auto('submit-form'),
        submit = auto('compat-form', 'submit')
    const sample = (events) => ({ network: { events } })
    assert.deepEqual(normalize(sample([click, submit]), context), normalize(sample([submit, click]), context))
    const broken = structuredClone(submit)
    broken.properties.$event_type = 'click'
    assert(differences(normalize(sample([click, submit]), context), normalize(sample([click, broken]), context)).length)
    const batch = (events) => ({ network: { requests: [{ path: '/e', body: { batch: events } }] } })
    assert(differences(normalize(batch([click, submit]), context), normalize(batch([submit, click]), context)).length)
})

test('expanded coverage requires all six interaction scenarios', () => {
    const requirements = {
        engines: ['chromium'],
        modes: ['npm'],
        comparisons: ['current'],
        scenarios: ['core', ...interactionScenarios],
        repeats: 2,
        cellFailures: [],
    }
    const rows = requirements.scenarios.map((scenario) => ({
        engine: 'chromium',
        mode: 'npm',
        comparison: 'current',
        scenario,
    }))
    assert(completeCoverage(rows, requirements))
    assert(!completeCoverage(rows.slice(0, -1), requirements))
})
