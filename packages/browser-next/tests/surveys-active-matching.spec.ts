// @vitest-environment jsdom
import { createPostHog } from '../src/composition/npm'
import type { IPostHog, PostHogOptions, RemoteConfig } from '../src/core/types'
import { flags } from '../src/products/flags/flags'
import { createSurveys } from '../src/products/surveys/surveys-extension'
import type { Survey, SurveyCallback } from '../src/products/surveys/surveys-options'

const survey = (id: string): Survey => ({
    id,
    name: id,
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
})
const remoteConfig: RemoteConfig = {
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
    surveys: false,
}

/** A renderer whose matching set is controlled by the test. */
const createRenderer = () => {
    const state = { matching: [survey('first')], fail: false, excludeSeen: false }
    const isSeen = (value: Survey) =>
        localStorage.getItem(`seenSurvey_${value.id}`) !== null ||
        localStorage.getItem(`seenSurvey_${value.id}_2`) !== null
    const generateSurveys = vi.fn(() => {
        if (state.fail) return undefined
        return {
            dispose: vi.fn(),
            getActiveMatchingSurveys: (callback: SurveyCallback) =>
                callback(
                    state.matching.filter((value) => !state.excludeSeen || !isSeen(value)),
                    { isLoaded: true }
                ),
            checkSurveyEligibility: () => ({ eligible: true }),
            checkSurveyRenderability: () => ({ eligible: true }),
            renderSurvey: vi.fn(),
            handlePopoverSurvey: vi.fn(),
            cancelSurvey: vi.fn(),
            handlePageUnload: vi.fn(),
        }
    })
    return { state, load: async () => ({ generateSurveys }) }
}

const clients: IPostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const renderer = createRenderer()
    const extension = createSurveys({ automaticDisplay: false }, renderer.load)
    const client = await createPostHog({
        projectToken: 'ph_active_matching',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig,
        analytics: { flushInterval: 0 },
        flags: false,
        logs: false,
        autocapture: false,
        fetch: async () => new Response('{}'),
        ...options,
        extensions: [extension, ...(options.extensions ?? [])],
    })
    clients.push(client)
    return { client, extension, renderer }
}
const ids = (callback: ReturnType<typeof vi.fn>) =>
    callback.mock.calls.map(([surveys]) => (surveys as Survey[]).map((value) => value.id))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('onActiveMatchingSurveysChanged', () => {
    it('loads surveys and delivers the initial matching set once', async () => {
        const { extension } = await create()
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        await settle()
        expect(ids(callback)).toEqual([['first']])
        expect(callback.mock.calls[0]?.[1]).toEqual({ isLoaded: true })
    })

    it('re-evaluates after captured pageviews and survey lifecycle events, suppressing unchanged results', async () => {
        const { client, extension, renderer } = await create()
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        await settle()
        client.capture('$pageview')
        expect(ids(callback)).toEqual([['first']])
        renderer.state.matching = [survey('first'), survey('second')]
        client.capture('unrelated')
        expect(ids(callback)).toEqual([['first']])
        client.capture('$pageview')
        expect(ids(callback)).toEqual([['first'], ['first', 'second']])
        for (const event of ['survey shown', 'survey dismissed', 'survey sent']) {
            renderer.state.matching = [survey(event)]
            client.capture(event, { $survey_id: event })
        }
        expect(ids(callback).slice(2)).toEqual([['survey shown'], ['survey dismissed'], ['survey sent']])
    })

    it.each(['survey dismissed', 'survey sent'])(
        'marks a survey seen when the application captures %s, before matching re-evaluates',
        async (event) => {
            const { client, extension, renderer } = await create()
            renderer.state.matching = [survey('custom'), survey('other')]
            renderer.state.excludeSeen = true
            const callback = vi.fn()
            extension.onActiveMatchingSurveysChanged(callback)
            await settle()
            client.capture(event, { $survey_id: 'custom', $survey_iteration: 2 })
            expect(localStorage.getItem('seenSurvey_custom_2')).toBe('true')
            client.capture(event, { $survey_id: 'other' })
            expect(localStorage.getItem('seenSurvey_other')).toBe('true')
            expect(ids(callback)).toEqual([['custom', 'other'], ['other'], []])
        }
    )

    it('does not mark surveys seen for other events or after disposal', async () => {
        const { client } = await create()
        client.capture('survey shown', { $survey_id: 'shown' })
        client.capture('survey sent', {})
        await client.shutdown(0)
        client.capture('survey sent', { $survey_id: 'late' })
        expect(localStorage.length).toBe(0)
    })

    it('re-evaluates after a rendered survey is shown, even without captured telemetry', async () => {
        const { client, extension, renderer } = await create()
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        await settle()
        client.optOut()
        renderer.state.matching = []
        window.dispatchEvent(new Event('PHSurveyShown'))
        expect(ids(callback)).toEqual([['first'], []])
    })

    it('re-evaluates after feature flag changes and reset', async () => {
        const { client, extension, renderer } = await create({
            extensions: [flags({ featureFlagEvaluation: false })],
        })
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        await settle()
        renderer.state.matching = [survey('flagged')]
        client.featureFlags?.updateFlags({ beta: true })
        expect(ids(callback)).toEqual([['first'], ['flagged']])
        renderer.state.matching = []
        client.reset()
        expect(ids(callback)).toEqual([['first'], ['flagged'], []])
    })

    it('stops delivery after the subscription or the extension is disposed', async () => {
        const { client, extension, renderer } = await create()
        const first = vi.fn()
        const second = vi.fn()
        const subscription = extension.onActiveMatchingSurveysChanged(first)
        extension.onActiveMatchingSurveysChanged(second)
        await settle()
        subscription.dispose()
        renderer.state.matching = []
        client.capture('$pageview')
        expect(ids(first)).toEqual([['first']])
        expect(ids(second)).toEqual([['first'], []])
        await client.shutdown(0)
        renderer.state.matching = [survey('late')]
        window.dispatchEvent(new Event('PHSurveyShown'))
        const late = vi.fn()
        extension.onActiveMatchingSurveysChanged(late).dispose()
        await settle()
        expect(ids(second)).toEqual([['first'], []])
        expect(late).not.toHaveBeenCalled()
    })

    it('contains callback errors without affecting other subscribers', async () => {
        const { client, extension, renderer } = await create()
        const failing = vi.fn(() => {
            throw new Error('application callback')
        })
        const other = vi.fn()
        extension.onActiveMatchingSurveysChanged(failing)
        extension.onActiveMatchingSurveysChanged(other)
        await settle()
        renderer.state.matching = []
        expect(() => client.capture('$pageview')).not.toThrow()
        expect(failing).toHaveBeenCalledTimes(2)
        expect(ids(other)).toEqual([['first'], []])
    })

    it('reports an unavailable result for a subscription before setup', () => {
        const extension = createSurveys({}, createRenderer().load)
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        expect(callback).toHaveBeenCalledWith([], { isLoaded: false, error: 'Survey renderer unavailable' })
    })

    it('reports a load failure and keeps the subscription for later recovery', async () => {
        const renderer = createRenderer()
        renderer.state.fail = true
        const extension = createSurveys({ automaticDisplay: false }, renderer.load)
        const client = await createPostHog({
            projectToken: 'ph_active_matching',
            storage: false,
            navigator: false,
            capturePageview: false,
            remoteConfig,
            flags: false,
            fetch: async () => new Response('{}'),
            extensions: [extension],
        })
        clients.push(client)
        const callback = vi.fn()
        extension.onActiveMatchingSurveysChanged(callback)
        await settle()
        expect(callback).toHaveBeenCalledWith([], expect.objectContaining({ isLoaded: false }))
    })
})
