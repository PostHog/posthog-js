/* oxlint-disable compat/compat -- Tests run in Node. */
import { isBoolean } from '@posthog/core'
import { PostHogSurveys } from '../src/surveys'
import {
    SURVEYS,
    SURVEYS_LOADED_AT,
    SURVEYS_CACHE_TTL_MS,
    type SurveysConfig,
    type SurveysConfigSource,
    type SurveysExtensionHost,
    type SurveysManager,
    type SurveysEventReceiver,
} from '../src/surveys-config'
import { SurveyType } from '../src/surveys'
import type { Survey } from '../src'
import type { ApiResponse } from '../src/client'
import { TestClient } from './helpers/test-client'

const definition: Survey = {
    id: 'survey',
    name: 'Survey',
    description: '',
    type: SurveyType.Popover,
    questions: [],
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    appearance: null,
    current_iteration: null,
    current_iteration_start_date: null,
    start_date: '2026-01-01',
    end_date: null,
    conditions: { events: { values: [{ name: 'activated' }] }, actions: null, cancelEvents: null },
}
const create = (overrides: Partial<SurveysConfig> = {}) => {
    const config: SurveysConfig = {
        disableSurveys: false,
        cookielessMode: false,
        advancedEnableSurveys: false,
        requestTimeoutMs: 10000,
        ...overrides,
    }
    const manager: SurveysManager = {
        getActiveMatchingSurveys: vi.fn(),
        checkSurveyEligibility: vi.fn(() => ({ eligible: true })),
        checkSurveyRenderability: vi.fn(() => ({ eligible: true })),
        renderSurvey: vi.fn(),
        handlePopoverSurvey: vi.fn(),
        cancelSurvey: vi.fn(),
        dispose: vi.fn(),
    }
    const receiver: SurveysEventReceiver = {
        register: vi.fn(),
        reset: vi.fn(),
        dispose: vi.fn(),
        getSurveys: vi.fn(() => []),
        getActivationTimestamp: vi.fn(),
    }
    const extensions: SurveysExtensionHost = { generateSurveys: vi.fn(() => manager) }
    const source: SurveysConfigSource = {
        get: () => config,
        getExtensions: () => extensions,
        createEventReceiver: vi.fn(() => receiver),
    }
    const client = new TestClient({ requestResponse: { statusCode: 200, json: { surveys: [definition] } } })
    const surveys = new PostHogSurveys(source)
    return { client, surveys, source, manager, receiver, extensions }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('PostHogSurveys', () => {
    it('uses a supplied client for fetching before setup without starting the renderer', async () => {
        const { client, source, extensions } = create()
        const getClient = vi.fn(() => client)
        const surveys = new PostHogSurveys(source, getClient)
        const subscribe = vi.spyOn(client, 'onRemoteConfig')
        expect(getClient).not.toHaveBeenCalled()

        const result = await new Promise<Survey[]>((resolve) => surveys.getSurveys(resolve))
        expect(result).toEqual([definition])
        expect(client.sentRequests).toHaveLength(1)
        expect(client.kv.get(SURVEYS)).toEqual([definition])
        expect(subscribe).not.toHaveBeenCalled()
        expect(extensions.generateSurveys).not.toHaveBeenCalled()
        expect(source.createEventReceiver).not.toHaveBeenCalled()

        await surveys.setup(client)
        getClient.mockClear()
        const callback = vi.fn()
        surveys.getSurveys(callback)
        expect(callback).toHaveBeenCalledWith([definition], { isLoaded: true })
        expect(getClient).not.toHaveBeenCalled()
        expect(subscribe).toHaveBeenCalledOnce()
        surveys.dispose()
    })

    it('does not acquire the supplied client after disposal', () => {
        const { client, source } = create()
        const getClient = vi.fn(() => client)
        const surveys = new PostHogSurveys(source, getClient)
        surveys.dispose()
        surveys.getSurveys(vi.fn())
        expect(getClient).not.toHaveBeenCalled()
    })

    it.each([true, false, [], [definition]])('uses remote surveys %j only as the renderer gate', async (remote) => {
        const { client, surveys, extensions, receiver } = create()
        await surveys.setup(client)
        expect(extensions.generateSurveys).not.toHaveBeenCalled()
        surveys.onRemoteConfig({
            ok: true,
            config: {
                surveys: remote,
                supportedCompression: [],
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
            },
        })
        expect(extensions.generateSurveys).toHaveBeenCalledWith(isBoolean(remote) ? remote : !!remote.length)
        expect(client.sentRequests).toEqual([])
        const result = await new Promise<Survey[]>((resolve) => surveys.getSurveys(resolve))
        expect(result).toEqual([definition])
        expect(client.sentRequests).toEqual([
            {
                path: '/api/surveys/',
                init: { method: 'GET', query: { token: client.projectToken }, sentAt: 'query', timeoutMs: 10000 },
            },
        ])
        expect(receiver.register).toHaveBeenCalledWith([definition])
        expect(client.kv.get(SURVEYS)).toEqual([definition])
        expect(client.kv.get(SURVEYS_LOADED_AT)).toEqual(expect.any(Number))
        surveys.dispose()
    })

    it('preserves synchronous loader completion and reacquires the installed renderer', () => {
        const { client, surveys, extensions, source, manager } = create({ advancedEnableSurveys: true })
        extensions.generateSurveys = undefined
        extensions.loadExternalDependency = vi.fn((callback) => {
            extensions.generateSurveys = vi.fn(() => manager)
            callback()
        })
        surveys.setup(client)
        expect(source.createEventReceiver).toHaveBeenCalledOnce()
        expect(extensions.generateSurveys).toHaveBeenCalledWith(true)
        surveys.dispose()
        expect(manager.dispose).toHaveBeenCalledOnce()
    })

    it('serves stale cache synchronously and backs off failed background requests', async () => {
        vi.useFakeTimers()
        const { client, surveys } = create()
        const request = vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 503 })
        client.kv.set({ [SURVEYS]: [definition], [SURVEYS_LOADED_AT]: Date.now() - SURVEYS_CACHE_TTL_MS - 1 })
        await surveys.setup(client)
        const callback = vi.fn()
        surveys.getSurveys(callback)
        expect(callback).toHaveBeenCalledWith([definition], { isLoaded: true })
        expect(request).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(0)
        surveys.getSurveys(callback)
        expect(request).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(SURVEYS_CACHE_TTL_MS)
        surveys.getSurveys(callback)
        expect(request).toHaveBeenCalledTimes(2)
        surveys.dispose()
    })

    it('shares an in-flight fetch and ignores completion after disposal', async () => {
        const { client, surveys } = create()
        let complete!: (response: ApiResponse) => void
        const request = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise((resolve) => {
                    complete = resolve
                })
        )
        await surveys.setup(client)
        const first = vi.fn()
        const second = vi.fn()
        surveys.getSurveys(first)
        surveys.getSurveys(second)
        expect(request).toHaveBeenCalledOnce()
        surveys.dispose()
        complete({ statusCode: 200, json: { surveys: [definition] } })
        await Promise.resolve()
        await Promise.resolve()
        expect(first).not.toHaveBeenCalled()
        expect(second).not.toHaveBeenCalled()
        expect(client.kv.get(SURVEYS)).toBeUndefined()
    })

    it('keeps cookieless consent gating and render-time capture gating', async () => {
        const { client, surveys, extensions, manager } = create({
            cookielessMode: true,
            advancedEnableSurveys: true,
        })
        client.isOptedOut = true
        expect(client.canCapture).toBe(true)
        await surveys.setup(client)
        expect(extensions.generateSurveys).not.toHaveBeenCalled()
        client.isOptedOut = false
        surveys.loadIfEnabled()
        expect(extensions.generateSurveys).toHaveBeenCalledOnce()
        client.canCapture = false
        surveys.renderSurvey(definition, '#target')
        expect(manager.renderSurvey).not.toHaveBeenCalled()
        expect(surveys.canRenderSurvey(definition).visible).toBe(false)
        surveys.dispose()
    })

    it('rechecks live capture permission before delayed rendering', async () => {
        vi.useFakeTimers()
        const { client, surveys, manager } = create({ advancedEnableSurveys: true })
        vi.stubGlobal('document', { querySelector: () => ({}) })
        await surveys.setup(client)
        const delayed = { ...definition, appearance: { surveyPopupDelaySeconds: 1 } }
        surveys.renderSurvey(delayed, '#target')
        client.canCapture = false
        await vi.advanceTimersByTimeAsync(1000)
        expect(manager.renderSurvey).not.toHaveBeenCalled()
        client.canCapture = true
        surveys.renderSurvey(delayed, '#target')
        await vi.advanceTimersByTimeAsync(1000)
        expect(manager.renderSurvey).toHaveBeenCalledOnce()
        surveys.dispose()
    })

    it('cancels delayed rendering on disposal and disposes the injected receiver once', async () => {
        vi.useFakeTimers()
        const { client, surveys, manager, receiver } = create({ advancedEnableSurveys: true })
        vi.stubGlobal('document', { querySelector: () => ({}) })
        await surveys.setup(client)
        surveys.renderSurvey({ ...definition, appearance: { surveyPopupDelaySeconds: 1 } }, '#target')
        surveys.dispose()
        surveys.dispose()
        await vi.advanceTimersByTimeAsync(1000)
        expect(manager.renderSurvey).not.toHaveBeenCalled()
        expect(manager.dispose).toHaveBeenCalledOnce()
        expect(receiver.dispose).toHaveBeenCalledOnce()
    })
})
