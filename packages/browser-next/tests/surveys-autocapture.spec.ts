// @vitest-environment jsdom
import { createPostHog } from '../src'
import { SurveyEventReceiver } from '@posthog/browser-common/survey-event-receiver'
import { autocapture } from '../src/autocapture'
import { surveys } from '../src/surveys'
import type { SurveysExtension } from '../src/surveys-internal'
import type { Survey } from '../src/surveys-options'
import type { PostHog, PostHogOptions } from '../src/types'
import { MemoryStorage } from './helpers'

const definition: Survey = {
    id: 'action',
    name: 'Action feedback',
    type: 'popover',
    start_date: '2025-01-01',
    end_date: null,
    questions: [{ type: 'open', question: 'Feedback?' }],
    appearance: { surveyPopupDelaySeconds: 30 },
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    current_iteration: null,
    current_iteration_start_date: null,
    conditions: {
        events: null,
        cancelEvents: null,
        actions: { values: [{ id: 1, name: 'trigger', steps: [{ event: '$autocapture', selector: '.first' }] }] },
    },
}
const base = {
    projectToken: 'test',
    navigator: false,
    capturePageview: false,
    flags: false,
    logs: false,
    analytics: false,
    remoteConfig: {
        toolbarParams: {},
        toolbarVersion: 'toolbar' as const,
        isAuthenticated: false,
        siteApps: [],
        supportedCompression: [],
        autocapture_opt_out: false,
        surveys: false,
    },
} satisfies PostHogOptions
const clients: PostHog[] = []
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})
const fetchDefinitions = (client: PostHog) => new Promise<void>((resolve) => client.getSurveys(() => resolve(), true))

describe('survey autocapture selectors', () => {
    it('retains real survey selectors registered before autocapture setup', async () => {
        document.body.innerHTML = '<button class="first">First</button>'
        const surveyExtension = surveys({ automaticDisplay: false }) as SurveysExtension
        const captured = vi.fn()
        const autocaptureExtension = autocapture() as ReturnType<typeof autocapture> & {
            setElementSelectors(selectors: Set<string>): void
        }
        const setSelectors = vi.spyOn(autocaptureExtension, 'setElementSelectors')
        const disposeReceiver = vi.spyOn(SurveyEventReceiver.prototype, 'dispose')
        const client = await createPostHog({
            ...base,
            storage: false,
            extensions: [
                surveyExtension,
                {
                    name: 'prepare-surveys',
                    async setup() {
                        await new Promise<void>((resolve) => surveyExtension.getSurveys(() => resolve()))
                    },
                },
                autocaptureExtension,
            ],
            fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
        })
        clients.push(client)
        expect(setSelectors).toHaveBeenCalledOnce()
        expect(setSelectors).toHaveBeenCalledWith(new Set(['.first']))
        client.onEvent(captured)
        document.querySelector('button')!.click()
        expect(captured).toHaveBeenCalledWith(
            expect.objectContaining({ properties: expect.objectContaining({ $element_selectors: ['.first'] }) })
        )
        expect(await client.canRenderSurvey('action')).toMatchObject({ visible: true })
        const exposed = surveyExtension.getElementSelectors()
        exposed.clear()
        expect(surveyExtension.getElementSelectors()).toEqual(new Set(['.first']))
        surveyExtension.dispose?.()
        surveyExtension.dispose?.()
        expect(disposeReceiver).toHaveBeenCalledOnce()
        expect(setSelectors).toHaveBeenCalledTimes(2)
        expect(setSelectors).toHaveBeenLastCalledWith(new Set())
        captured.mockClear()
        document.querySelector('button')!.click()
        expect(captured.mock.calls[0]![0].properties.$element_selectors).toBeUndefined()
    })

    it.each(['fresh', 'stale'] as const)(
        'hydrates %s cached DOM actions and ignores ended definitions',
        async (age) => {
            document.body.innerHTML = '<button class="first">First</button>'
            const storage = new MemoryStorage()
            const ended: Survey = {
                ...definition,
                id: 'ended',
                end_date: '2025-02-01',
                conditions: {
                    events: null,
                    cancelEvents: null,
                    actions: {
                        values: [{ id: 2, name: 'ended', steps: [{ event: '$autocapture', selector: '.ended' }] }],
                    },
                },
            }
            const fetch = vi.fn(async () => new Response(JSON.stringify({ surveys: [definition, ended] })))
            const first = await createPostHog({ ...base, storage, surveys: { automaticDisplay: false }, fetch })
            clients.push(first)
            await fetchDefinitions(first)
            expect(fetch).toHaveBeenCalledOnce()
            await first.dispose()
            fetch.mockClear()
            if (age === 'stale') {
                const now = Date.now()
                vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1)
                fetch.mockImplementation(async () => new Response('{}', { status: 500 }))
            }
            const second = await createPostHog({ ...base, storage, surveys: { automaticDisplay: false }, fetch })
            clients.push(second)
            expect(await second.canRenderSurvey('action')).toMatchObject({ visible: false })
            expect(second.getExtension<SurveysExtension>('surveys')?.getElementSelectors()).toEqual(new Set(['.first']))
            const captured = vi.fn()
            second.onEvent(captured)
            document.querySelector('button')!.click()
            expect(captured.mock.calls[0]![0].properties.$element_selectors).toEqual(['.first'])
            expect(await second.canRenderSurvey('action')).toMatchObject({ visible: true })
            expect(fetch).toHaveBeenCalledTimes(age === 'stale' ? 1 : 0)
        }
    )

    it.each([
        [undefined, true],
        [null, false],
        ['', false],
        ['https://example.test/other', false],
        ['https://example.test/target', true],
    ] as const)('uses targeting URL fallback without replacing explicit value %j', async (url, matches) => {
        const targeted: Survey = {
            ...definition,
            conditions: {
                events: null,
                cancelEvents: null,
                actions: {
                    values: [
                        {
                            id: 1,
                            name: 'url',
                            steps: [
                                { event: '$autocapture', selector: '.first', url: '/target', url_matching: 'contains' },
                            ],
                        },
                    ],
                },
            },
        }
        const client = await createPostHog({
            ...base,
            storage: false,
            surveys: { automaticDisplay: false, getCurrentUrl: () => 'https://example.test/target' },
            fetch: async () => new Response(JSON.stringify({ surveys: [targeted] })),
        })
        clients.push(client)
        await fetchDefinitions(client)
        const captured = vi.fn()
        client.onEvent(captured)
        client.capture('$autocapture', {
            $element_selectors: ['.first'],
            ...(url === undefined ? {} : { $current_url: url }),
        })
        expect(await client.canRenderSurvey('action')).toMatchObject({ visible: matches })
        const properties = captured.mock.calls[0]![0].properties
        if (url === undefined) expect(properties).not.toHaveProperty('$current_url')
        else expect(properties.$current_url).toBe(url)
    })

    it('keeps local action URLs out of event activation and cancellation property filters', async () => {
        const filter = { $current_url: { values: ['https://example.test/target'], operator: 'exact' as const } }
        const action: Survey = {
            ...definition,
            conditions: {
                events: null,
                cancelEvents: null,
                actions: { values: [{ id: 1, name: 'url', steps: [{ event: 'action', url: '/target' }] }] },
            },
        }
        const event: Survey = {
            ...definition,
            id: 'event',
            conditions: {
                actions: null,
                cancelEvents: null,
                events: { values: [{ name: 'purchase', propertyFilters: filter }] },
            },
        }
        const cancel: Survey = {
            ...definition,
            id: 'cancel',
            conditions: {
                actions: null,
                events: { values: [{ name: 'arm' }] },
                cancelEvents: { values: [{ name: 'purchase', propertyFilters: filter }] },
            },
        }
        const client = await createPostHog({
            ...base,
            storage: false,
            surveys: { automaticDisplay: false, getCurrentUrl: () => 'https://example.test/target' },
            fetch: async () => new Response(JSON.stringify({ surveys: [action, event, cancel] })),
        })
        clients.push(client)
        await fetchDefinitions(client)
        client.capture('arm')
        client.capture('purchase')
        expect(await client.canRenderSurvey('event')).toMatchObject({ visible: false })
        expect(await client.canRenderSurvey('cancel')).toMatchObject({ visible: true })
        client.capture('action')
        expect(await client.canRenderSurvey('action')).toMatchObject({ visible: true })
    })

    it('reconciles successful snapshots while preserving armed delays and failure state', async () => {
        document.body.innerHTML = '<button class="first">First</button><button class="second">Second</button>'
        const storage = new MemoryStorage()
        let definitions = [definition]
        let fail = false
        const client = await createPostHog({
            ...base,
            storage,
            autocapture: { rageclick: false },
            persistenceKey: 'survey-merge',
            surveys: { automaticDisplay: false },
            fetch: async () =>
                fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ surveys: definitions })),
        })
        clients.push(client)
        await fetchDefinitions(client)
        const captured = vi.fn()
        client.onEvent(captured)
        document.querySelector<HTMLElement>('.first')!.click()
        expect(await client.canRenderSurvey('action')).toMatchObject({ visible: true })
        const activation = JSON.parse(storage.getItem('survey-merge_surveys')!)['$surveys_activated_timestamps']
        expect(activation).toBeTruthy()
        await fetchDefinitions(client)
        expect(await client.canRenderSurvey('action')).toMatchObject({ visible: true })
        expect(JSON.parse(storage.getItem('survey-merge_surveys')!)['$surveys_activated_timestamps']).toEqual(
            activation
        )
        fail = true
        await fetchDefinitions(client)
        captured.mockClear()
        document.querySelector<HTMLElement>('.first')!.click()
        expect(captured.mock.calls[0]![0].properties.$element_selectors).toEqual(['.first'])
        fail = false
        definitions = [
            {
                ...definition,
                conditions: {
                    events: null,
                    cancelEvents: null,
                    actions: {
                        values: [
                            {
                                id: 2,
                                name: 'second',
                                steps: [{ event: '$autocapture', selector: '.second', text: 'Second' }],
                            },
                        ],
                    },
                },
            },
        ]
        await fetchDefinitions(client)
        captured.mockClear()
        document.querySelector<HTMLElement>('.first')!.click()
        expect(captured.mock.calls[0]![0].properties.$element_selectors).toBeUndefined()
        document.querySelector<HTMLElement>('.second')!.click()
        expect(captured.mock.calls[1]![0].properties.$element_selectors).toEqual(['.second'])
        definitions = []
        await fetchDefinitions(client)
        captured.mockClear()
        document.querySelector<HTMLElement>('.second')!.click()
        expect(captured.mock.calls[0]![0].properties.$element_selectors).toBeUndefined()
    })
})
