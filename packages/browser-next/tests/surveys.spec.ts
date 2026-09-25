// @vitest-environment jsdom
import { detectUserLanguage } from '@posthog/browser-common/surveys/survey-translations'
import { STORED_PERSON_PROPERTIES_KEY } from '@posthog/browser-common/constants'
import {
    setInProgressSurveyState,
    getInProgressSurveyState,
    getSurveySeen,
    sendSurveyAbandonedEvent,
    dismissedSurveyEvent,
} from '@posthog/browser-common/surveys/surveys-extension-utils'
import { createPostHog, FeatureFlagsExtension } from '../src'
import { createPostHog as createCore } from '../src/core'
import { createSurveys } from '../src/surveys-extension'
import { surveys, type SurveysExtension } from '../src/surveys'
import { generateSurveys } from '@posthog/browser-common/surveys-renderer'
import type { PostHog, PostHogOptions } from '../src/types'
import type { Survey, SurveyCallback } from '../src/surveys-options'
import type { SurveyRenderContext } from '@posthog/browser-common/survey-render-context'
import { MemoryStorage } from './helpers'

const definition: Survey = {
    id: 'survey-test',
    name: 'Feedback',
    type: 'popover',
    start_date: '2025-01-01',
    questions: [{ type: 'open', question: 'What can we improve?' }],
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    appearance: null,
    conditions: null,
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
}
const remote = {
    toolbarParams: {},
    toolbarVersion: 'toolbar' as const,
    isAuthenticated: false,
    siteApps: [],
    supportedCompression: [],
}
const base = {
    projectToken: 'ph_surveys',
    storage: false,
    navigator: false,
    flags: false,
    logs: false,
    analytics: false,
    capturePageview: false,
} as const
const clients: PostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createPostHog({
        ...base,
        remoteConfig: { ...remote, surveys: false },
        fetch: false,
        ...options,
    })
    clients.push(client)
    return client
}
const getExtension = (client: PostHog) => client.getExtension<SurveysExtension>('surveys')!
const getSurveys = (client: PostHog, forceReload = false) =>
    new Promise<Survey[]>((resolve) => getExtension(client).getSurveys(resolve, forceReload))
const renderer = () => {
    const dispose = vi.fn()
    const generateSurveys = vi.fn((_host: SurveyRenderContext, _enabled: boolean | undefined) => ({
        dispose,
        getActiveMatchingSurveys: (callback: SurveyCallback) => callback([definition], { isLoaded: true }),
        checkSurveyEligibility: () => ({ eligible: true }),
        checkSurveyRenderability: () => ({ eligible: true }),
        renderSurvey: vi.fn(),
        handlePopoverSurvey: vi.fn(),
        cancelSurvey: vi.fn(),
        handlePageUnload: vi.fn(),
    }))
    return { dispose, generateSurveys }
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
    localStorage.clear()
})

describe('surveys', () => {
    it.each(['selected', 'memory'] as const)(
        'keeps interaction state in localStorage with %s SDK persistence',
        async (mode) => {
            let context!: SurveyRenderContext
            const client = await create({
                storage: mode === 'selected' ? new MemoryStorage() : false,
                extensions: [
                    createSurveys({ automaticDisplay: false }, async () => ({
                        generateSurveys(value, enabled) {
                            context = value
                            return generateSurveys(value, enabled)
                        },
                    })),
                ],
                fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
            })
            await getSurveys(client)
            const write = vi.spyOn(context.client!.kv, 'set')
            const state = {
                surveySubmissionId: 'submission',
                lastQuestionIndex: 0,
                responses: { $survey_response: 'answer'.repeat(2000) },
            }
            setInProgressSurveyState(definition, state)
            expect(getInProgressSurveyState(definition)).toEqual(state)
            expect(JSON.parse(localStorage.getItem('inProgressSurvey_survey-test')!)).toEqual(state)
            sendSurveyAbandonedEvent(definition, context)
            expect(localStorage.getItem('abandonedSurvey_survey-test')).toBe('true')
            dismissedSurveyEvent(definition, context)
            expect(getSurveySeen(definition)).toBe(true)
            expect(write).not.toHaveBeenCalled()
        }
    )

    it('reads live person language and evaluation configuration through the renderer client', async () => {
        let context!: SurveyRenderContext
        const client = await create({
            flags: { featureFlagEvaluation: false },
            extensions: [
                createSurveys({ automaticDisplay: false }, async () => ({
                    generateSurveys(value, enabled) {
                        context = value
                        return generateSurveys(value, enabled)
                    },
                })),
            ],
            fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
        })
        await getSurveys(client)
        client.identify('person', { language: 'fr' })
        expect(detectUserLanguage(context)).toBe('fr')
        expect(context.config.featureFlagEvaluation).toBe(false)
        expect(context.client!.kv.get([STORED_PERSON_PROPERTIES_KEY, '$surveys'])).toMatchObject({
            [STORED_PERSON_PROPERTIES_KEY]: { language: 'fr' },
            '$surveys': [definition],
        })
        expect(detectUserLanguage({ ...context, config: { ...context.config, overrideLanguage: 'de' } })).toBe('de')
        client.identify('person', { language: 'es' })
        expect(detectUserLanguage(context)).toBe('es')
        client.reset()
        expect(context.client!.kv.get(STORED_PERSON_PROPERTIES_KEY)).toBeUndefined()
    })

    it('installs orchestration by default but keeps false remote config from fetching definitions', async () => {
        const fetch = vi.fn()
        const client = await create({ fetch })
        expect(client.getExtension('surveys')).toBeDefined()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('omits surveys when disabled or using the manual core without an explicit instance', async () => {
        const client = await create({ surveys: false })
        const core = await createCore({ ...base, fetch: false })
        clients.push(core)
        for (const instance of [client, core]) {
            expect(instance.getExtension('surveys')).toBeUndefined()
        }
    })

    it('prefers an explicit static instance even when automatic inclusion is disabled', async () => {
        const extension = surveys({ automaticDisplay: false })
        const client = await create({ surveys: false, extensions: [extension] })
        expect(client.getExtension('surveys')).toBe(extension)
    })

    it.each([false, undefined])('defers the renderer for remote surveys=%s until a manual call', async (enabled) => {
        const module = renderer()
        const load = vi.fn(async () => module)
        const fetch = vi.fn(async () => new Response(JSON.stringify({ surveys: [definition] })))
        const client = await create({
            extensions: [createSurveys({}, load)],
            remoteConfig: { ...remote, ...(enabled === undefined ? {} : { surveys: enabled }) },
            fetch,
        })
        expect(load).not.toHaveBeenCalled()
        expect(await getSurveys(client)).toEqual([definition])
        expect(load).toHaveBeenCalledOnce()
        expect(module.generateSurveys).toHaveBeenCalledWith(expect.anything(), false)
        const [url, init] = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]!
        expect(new URL(url).pathname).toBe('/api/surveys/')
        expect(new URL(url).searchParams.get('token')).toBe('ph_surveys')
        expect(init.method).toBe('GET')
        expect(await getSurveys(client)).toEqual([definition])
        expect(fetch).toHaveBeenCalledOnce()
        await getSurveys(client, true)
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('starts UI loading for enabled config without blocking client creation and shares concurrent loads', async () => {
        let resolve!: (value: ReturnType<typeof renderer>) => void
        const load = vi.fn(
            () =>
                new Promise<ReturnType<typeof renderer>>((done) => {
                    resolve = done
                })
        )
        const client = await create({
            extensions: [createSurveys({}, load)],
            remoteConfig: { ...remote, surveys: true },
            fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
        })
        expect(load).toHaveBeenCalledOnce()
        const first = getSurveys(client)
        const second = getSurveys(client)
        const module = renderer()
        resolve(module)
        expect(await first).toEqual([definition])
        expect(await second).toEqual([definition])
        expect(module.generateSurveys).toHaveBeenCalledOnce()
        expect(module.generateSurveys).toHaveBeenCalledWith(expect.anything(), true)
    })

    it('contains failed renderer loads and can retry a later explicit request', async () => {
        const module = renderer()
        const load = vi.fn().mockRejectedValueOnce(new Error('chunk')).mockResolvedValue(module)
        const client = await create({
            extensions: [createSurveys({}, load)],
            fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
        })
        expect(await getSurveys(client)).toEqual([])
        expect(await getSurveys(client)).toEqual([definition])
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('does not initialize UI or deliver callbacks after disposal during a delayed load', async () => {
        let resolve!: (value: ReturnType<typeof renderer>) => void
        const load = () =>
            new Promise<ReturnType<typeof renderer>>((done) => {
                resolve = done
            })
        const module = renderer()
        const client = await create({ extensions: [createSurveys({}, load)] })
        const callback = vi.fn()
        getExtension(client).getSurveys(callback)
        await client.shutdown(0)
        resolve(module)
        await Promise.resolve()
        await Promise.resolve()
        expect(module.generateSurveys).not.toHaveBeenCalled()
        expect(callback).not.toHaveBeenCalled()
    })

    it('disposes renderer listeners and contains throwing subscriber callbacks', async () => {
        const add = vi.spyOn(window, 'addEventListener')
        const remove = vi.spyOn(window, 'removeEventListener')
        const module = renderer()
        const client = await create({ extensions: [createSurveys({}, async () => module)] })
        const callback = vi.fn(() => {
            throw new Error('application callback')
        })
        const subscription = getExtension(client).onSurveysLoaded(callback)
        await vi.waitFor(() => expect(callback).toHaveBeenCalled())
        subscription.dispose()
        window.dispatchEvent(new Event('pagehide'))
        const manager = module.generateSurveys.mock.results[0]!.value!
        expect(manager.handlePageUnload).toHaveBeenCalledOnce()
        await client.dispose()
        expect(module.dispose).toHaveBeenCalledOnce()
        const pagehide = add.mock.calls.find(([event]) => event === 'pagehide')![1]
        expect(remove).toHaveBeenCalledWith('pagehide', pagehide)
        window.dispatchEvent(new Event('pagehide'))
        expect(manager.handlePageUnload).toHaveBeenCalledOnce()
    })

    it.each(['static', 'dynamic'])(
        'uses the real %s renderer for eligibility without automatic display',
        async (mode) => {
            const client = await create({
                ...(mode === 'static'
                    ? { extensions: [surveys({ automaticDisplay: false })] }
                    : { surveys: { automaticDisplay: false } }),
                fetch: async () => new Response(JSON.stringify({ surveys: [definition] })),
            })
            expect(await getSurveys(client)).toEqual([definition])
            expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: true })
            expect(await getExtension(client).canRenderSurvey('missing')).toMatchObject({ visible: false })
            expect(document.querySelector('.PostHogSurvey')).toBeNull()
        }
    )

    it('persists through selected custom storage without allowing core writes to replace definitions', async () => {
        const storage = new MemoryStorage()
        const fetch = vi.fn(async () => new Response(JSON.stringify({ surveys: [definition] })))
        const first = await create({
            storage,
            persistenceKey: 'custom',
            extensions: [surveys({ automaticDisplay: false })],
            fetch,
        })
        await getSurveys(first)
        first.kv.set('unrelated', true)
        expect(JSON.parse(storage.getItem('custom')!).extensionData.surveys.$surveys).toEqual([definition])
        const second = await create({
            storage,
            persistenceKey: 'custom',
            extensions: [surveys({ automaticDisplay: false })],
            fetch,
        })
        expect(await getSurveys(second)).toEqual([definition])
        expect(fetch).toHaveBeenCalledOnce()
        second.reset()
        expect(JSON.parse(storage.getItem('custom')!).extensionData.surveys).toEqual({})
    })

    it.each(['enabled', 'disabled', 'disposed'] as const)(
        'handles late remote enablement after manual setup: %s',
        async (mode) => {
            let resolve!: (response: Response) => void
            const remoteResponse = new Promise<Response>((done) => {
                resolve = done
            })
            let manager: ReturnType<typeof generateSurveys>
            const interval = vi.spyOn(globalThis, 'setInterval')
            const client = await createPostHog({
                ...base,
                extensions: [
                    createSurveys({ automaticDisplay: mode !== 'disabled' }, async () => ({
                        generateSurveys: (host, enabled) => (manager = generateSurveys(host, enabled)),
                    })),
                ],
                fetch: async (url) =>
                    new URL(String(url)).pathname.endsWith('/config')
                        ? remoteResponse
                        : new Response(JSON.stringify({ surveys: [definition] })),
            })
            clients.push(client)
            await getSurveys(client)
            expect(interval).not.toHaveBeenCalled()
            if (mode === 'disposed') await client.dispose()
            resolve(new Response(JSON.stringify({ ...remote, surveys: true })))
            await new Promise((done) => setTimeout(done, 0))
            expect(interval.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(mode === 'enabled' ? 1 : 0)
            manager?.startAutomaticDisplay()
            manager?.startAutomaticDisplay()
            expect(interval.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(mode === 'enabled' ? 1 : 0)
        }
    )

    it('settles pending eligibility when disposed during a definition request', async () => {
        const client = await create({
            extensions: [surveys({ automaticDisplay: false })],
            fetch: () => new Promise<Response>(() => {}),
        })
        const eligibility = getExtension(client).canRenderSurvey(definition.id)
        await Promise.resolve()
        await client.shutdown(0)
        expect(await eligibility).toMatchObject({ visible: false })
    })

    it('uses flags for survey eligibility without recording internal targeting exposures', async () => {
        const gated = { ...definition, targeting_flag_key: 'survey-targeting-gate' }
        const client = await create({
            flags: { featureFlagEvaluation: false },
            surveys: { automaticDisplay: false },
            fetch: async () => new Response(JSON.stringify({ surveys: [gated] })),
        })
        const captured = vi.fn()
        client.onEvent(captured)
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ 'survey-targeting-gate': false })
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: false })
        client.getExtension(FeatureFlagsExtension)!.updateFlags({ 'survey-targeting-gate': true })
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: true })
        expect(captured.mock.calls.some(([event]) => event.event === '$feature_flag_called')).toBe(false)
    })

    it('registers action selectors through the optional autocapture capability and matches admitted events', async () => {
        const setElementSelectors = vi.fn()
        const autocapture = { name: 'autocapture', setup() {}, setElementSelectors }
        const actionable: Survey = {
            ...definition,
            conditions: {
                events: null,
                cancelEvents: null,
                actions: {
                    values: [{ id: 1, name: 'action', steps: [{ event: '$autocapture', selector: '.trigger' }] }],
                },
            },
        }
        const client = await create({
            surveys: { automaticDisplay: false },
            extensions: [autocapture],
            fetch: async () => new Response(JSON.stringify({ surveys: [actionable] })),
        })
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: false })
        expect(setElementSelectors).toHaveBeenCalledWith(new Set(['.trigger']))
        client.capture('$autocapture', { $element_selectors: ['.trigger'] })
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: true })
        client.reset()
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: false })
    })

    it('respects consent in definition requests and manual eligibility', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ surveys: [definition] })))
        const client = await create({
            optOutByDefault: true,
            extensions: [surveys({ automaticDisplay: false })],
            fetch,
        })
        expect(await getSurveys(client)).toEqual([])
        expect(fetch).not.toHaveBeenCalled()
        client.optIn()
        expect(await getSurveys(client)).toEqual([definition])
        client.optOut()
        expect(await getExtension(client).canRenderSurvey(definition.id)).toMatchObject({ visible: false })
    })
})
