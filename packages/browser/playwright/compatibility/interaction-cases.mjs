/* eslint-disable posthog-js/no-direct-function-check -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import assert from 'node:assert/strict'

export const interactionScenarios = ['forms', 'links', 'rage-clicks', 'dead-clicks', 'scrolling', 'heatmaps']
const target = (event, id) =>
    event.properties?.$elements?.some((element) => element.attr__id === id || element.attr_id === id) ||
    event.properties?.$elements_chain?.includes(`attr__id="${id}"`)
export const heatmapPoints = (network) =>
    network.events
        .filter((event) => event.event === '$$heatmap')
        .flatMap((event) => Object.values(event.properties.$heatmap_data ?? {}).flat())

export function assertInteractionProof(scenario, network, ui, comparison) {
    const events = network.events
    const auto = events.filter((event) => event.event === '$autocapture')
    if (scenario === 'forms') {
        assert.equal(ui.submissions, 1, 'Native form submission handler did not run exactly once')
        assert.equal(
            auto.filter((event) => event.properties.$event_type === 'submit' && target(event, 'compat-form')).length,
            1,
            'Missing or duplicate form submit autocapture'
        )
        for (const id of ['category', 'plan'])
            assert.equal(
                auto.filter((event) => event.properties.$event_type === 'change' && target(event, id)).length,
                1,
                `Missing or duplicate ${id} change autocapture`
            )
        const changes = auto.filter((event) => event.properties.$event_type === 'change')
        const category = changes.find((event) => target(event, 'category'))
        const plan = changes.find((event) => target(event, 'plan'))
        assert(['current', 'historical'].includes(comparison), 'Unknown form core family')
        assert.equal(
            category.properties.$input_value,
            comparison === 'current' ? 'widgets' : undefined,
            'Incorrect opted-in form value for the deployed core'
        )
        assert.equal(plan.properties.$input_value, undefined, 'Unannotated control captured a value')
        for (const key of ['$elements', '$elements_chain'])
            assert(
                !JSON.stringify(category.properties[key] ?? null).includes('widgets'),
                'Opted-in value appeared in the element hierarchy'
            )
        assert(!JSON.stringify(auto).includes('form-secret-password'), 'Password appeared in form autocapture')
        assert(!JSON.stringify(auto).includes('form-private-value'), 'Private input appeared in form autocapture')
        assert(!auto.some((event) => target(event, 'private-input')), 'Private input was autocaptured')
    }
    if (scenario === 'links') {
        assert.equal(ui.destinationLoaded, true, 'Native link navigation did not complete')
        assert.equal(
            auto.filter((event) => target(event, 'compat-link')).length,
            1,
            'Missing or duplicate link autocapture'
        )
        assert(
            JSON.stringify(auto).includes('/after?destination=compat#link'),
            'Link destination missing from autocapture'
        )
        assert(!auto.some((event) => target(event, 'private-link')), 'Private link was autocaptured')
    }
    if (scenario === 'rage-clicks') {
        assert.equal(
            auto.filter((event) => target(event, 'rage-target')).length,
            3,
            'Missing or duplicate rage-sequence clicks'
        )
        assert.equal(
            events.filter((event) => event.event === '$rageclick' && target(event, 'rage-target')).length,
            1,
            'Missing or duplicate rage click'
        )
        assert(
            !events.some((event) => event.event === '$rageclick' && target(event, 'spaced-target')),
            'Spaced clicks were classified as rage clicks'
        )
    }
    if (scenario === 'dead-clicks') {
        const dead = events.filter((event) => event.event === '$dead_click')
        assert.equal(dead.filter((event) => target(event, 'dead-target')).length, 1, 'Missing or duplicate dead click')
        assert(!dead.some((event) => target(event, 'responsive-target')), 'Responsive click was classified as dead')
        assert(!dead.some((event) => target(event, 'private-dead')), 'Private dead click was captured')
        assert.equal(ui.response, 'Responded', 'Responsive button did not change the DOM')
        assert.equal(
            network.requests.filter(
                (request) => request.path.endsWith('/dead-clicks-autocapture.js') && request.status === 200
            ).length > 0,
            true,
            'Dead-click script never loaded through the SDK'
        )
    }
    if (scenario === 'scrolling') {
        const views = events.filter((event) => event.event === '$pageview')
        const leaves = events.filter((event) => event.event === '$pageleave')
        assert.equal(views.length, 1, 'Missing or duplicate pageview')
        assert.equal(leaves.length, 1, 'Missing or duplicate pageleave')
        const props = leaves[0].properties
        assert.equal(
            props.$prev_pageview_id,
            views[0].properties.$pageview_id,
            'Pageleave lost the pageview relationship'
        )
        assert.equal(props.$prev_pageview_max_scroll, 600, 'Maximum scroll depth incorrect')
        assert.equal(props.$prev_pageview_last_scroll, 200, 'Last scroll depth incorrect')
        for (const key of [
            '$prev_pageview_max_scroll_percentage',
            '$prev_pageview_last_scroll_percentage',
            '$prev_pageview_max_content_percentage',
            '$prev_pageview_last_content_percentage',
        ])
            assert.equal(props[key], ui.expected[key], `Incorrect ${key}`)
    }
    if (scenario === 'heatmaps') {
        const points = heatmapPoints(network)
        for (const point of [
            { type: 'click', x: 120, y: 920, target_fixed: false },
            { type: 'click', x: 900, y: 40, target_fixed: true },
            { type: 'mousemove', x: 400, y: 1000, target_fixed: false },
        ])
            assert(
                points.some((actual) => Object.entries(point).every(([key, value]) => actual[key] === value)),
                `Missing heatmap point: ${JSON.stringify(point)}`
            )
        assert.equal(
            points.filter((point) => point.type === 'rageclick').length,
            1,
            'Missing or duplicate heatmap rage click'
        )
        assert(
            points.some((point) => point.type === 'deadclick'),
            'Missing heatmap dead click'
        )
        assert.equal(ui.disabledDeliveryCount, 0, 'Disabled heatmaps still delivered points')
    }
}

export async function exerciseInteractions({ scenario, page, received, expect, origin, comparison }) {
    const ui = {}
    const advance = (milliseconds) => page.clock.runFor(milliseconds)
    const waitEvent = (predicate) => expect.poll(async () => (await received()).events.some(predicate)).toBe(true)
    if (scenario === 'forms') {
        await page.locator('#category').fill('widgets')
        await page.locator('#category').press('Tab')
        await page.locator('#plan').selectOption('pro')
        await page.locator('#form-password').fill('form-secret-password')
        await page.locator('#form-password').press('Tab')
        await page.locator('#private-input').fill('form-private-value')
        await page.locator('#private-input').press('Tab')
        await page.locator('#submit-form').click()
        await waitEvent((event) => event.event === '$autocapture' && event.properties.$event_type === 'submit')
        ui.submissions = await page.evaluate(() => window.__fixture.submissions)
    }
    if (scenario === 'links') {
        await page.locator('#private-link span').click()
        await page.locator('#compat-link span').click()
        await expect
            .poll(() =>
                page
                    .frames()
                    .some(
                        (frame) =>
                            frame.name() === 'compat-destination' &&
                            frame.url() === origin + '/after?destination=compat#link'
                    )
            )
            .toBe(true)
        await waitEvent((event) => event.event === '$autocapture' && target(event, 'compat-link'))
        ui.destinationLoaded = true
    }
    if (scenario === 'rage-clicks') {
        for (let index = 0; index < 3; index++) await page.locator('#rage-target').click()
        await waitEvent((event) => event.event === '$rageclick')
        for (let index = 0; index < 3; index++) {
            await page.locator('#spaced-target').click()
            await advance(1200)
        }
    }
    if (scenario === 'dead-clicks' || scenario === 'heatmaps') {
        await expect
            .poll(async () =>
                (await received()).requests.some(
                    (request) => request.path.endsWith('/dead-clicks-autocapture.js') && request.status === 200
                )
            )
            .toBe(true)
        await expect
            .poll(() =>
                page.evaluate(() => typeof window.__PosthogExtensions__?.initDeadClicksAutocapture === 'function')
            )
            .toBe(true)
        await advance(1500)
    }
    if (scenario === 'dead-clicks') {
        await page.locator('#responsive-target').click()
        await advance(4000)
        await page.locator('#private-dead').click()
        await advance(4000)
        await page.locator('#dead-target').click()
        await advance(4000)
        await waitEvent((event) => event.event === '$dead_click' && target(event, 'dead-target'))
        ui.response = await page.locator('#response').textContent()
    }
    if (scenario === 'scrolling' || scenario === 'heatmaps') {
        if (scenario === 'scrolling') await page.evaluate(() => window.__compat.call('capture', ['$pageview']))
        await page.mouse.move(500, 500)
        await page.mouse.wheel(0, 600)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
        await expect.poll(() => page.evaluate(() => window.__fixture.lastScroll)).toBe(600)
        await advance(20)
    }
    if (scenario === 'scrolling') {
        await page.mouse.wheel(0, -400)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200)
        await expect.poll(() => page.evaluate(() => window.__fixture.lastScroll)).toBe(200)
        await advance(20)
        ui.expected = await page.evaluate(() => {
            const height = document.documentElement.scrollHeight
            const scrollHeight = height - document.documentElement.clientHeight
            return {
                $prev_pageview_max_scroll_percentage: 600 / scrollHeight,
                $prev_pageview_last_scroll_percentage: 200 / scrollHeight,
                $prev_pageview_max_content_percentage: (600 + document.documentElement.clientHeight) / height,
                $prev_pageview_last_content_percentage: (200 + document.documentElement.clientHeight) / height,
            }
        })
        await page.evaluate(() => window.__compat.call('capture', ['$pageleave']))
        await waitEvent((event) => event.event === '$pageleave')
    }
    if (scenario === 'heatmaps') {
        for (let index = 0; index < 3; index++) await page.mouse.click(120, 320)
        await advance(4000)
        await page.mouse.click(900, 40)
        await advance(4000)
        await page.mouse.move(400, 400)
        await expect.poll(() => page.evaluate(() => window.__fixture.lastMouseMove)).toEqual({ x: 400, y: 400 })
        await advance(2000)
        await expect
            .poll(async () =>
                heatmapPoints(await received()).some(
                    (point) => point.type === 'mousemove' && point.x === 400 && point.y === 1000
                )
            )
            .toBe(true)
        const before = heatmapPoints(await received()).length
        await page.evaluate(() => window.__compat.call('set_config', [{ capture_heatmaps: false }]))
        await page.mouse.click(120, 320)
        await page.mouse.move(450, 450)
        await advance(4000)
        ui.disabledDeliveryCount = heatmapPoints(await received()).length - before
    }
    await advance(20)
    assertInteractionProof(scenario, await received(), ui, comparison)
    return ui
}
