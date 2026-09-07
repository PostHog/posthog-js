import type { ApiResponse, Client, Disposable, RemoteConfigResult } from '@posthog/browser-common'

import { PostHogSurveys } from '../posthog-surveys'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from '../surveys-config'
import type { Survey } from '../posthog-surveys-types'

const createConfigSource = (overrides: Partial<SurveysConfig> = {}) => {
    const config: SurveysConfig = {
        disableSurveys: false,
        cookielessMode: false,
        advancedEnableSurveys: false,
        requestTimeoutMs: 10000,
        ...overrides,
    }
    const manager = {
        dispose: vi.fn(),
    }
    const receiver = {
        dispose: vi.fn(),
        register: vi.fn(),
        replace: vi.fn(),
    }
    const extensions: SurveysExtensionHost = {
        generateSurveys: vi.fn(() => manager as any),
    }
    const source: SurveysConfigSource = {
        get: vi.fn(() => ({ ...config })),
        isOptedOut: vi.fn(() => false),
        getExtensions: vi.fn(() => extensions),
        createEventReceiver: vi.fn(() => receiver as any),
    }
    return { config, manager, receiver, extensions, source }
}

const createClient = (
    options: {
        initialize?: () => void | Promise<void>
        sendRequest?: Client['sendRequest']
    } = {}
) => {
    const values: Record<string, unknown> = {}
    const remoteConfigHandlers = new Set<(result: RemoteConfigResult) => void>()
    const remoteConfigDispose = vi.fn()
    const client = {
        projectToken: 'test-token',
        kv: {
            initialize: vi.fn(options.initialize ?? (() => {})),
            get: (key: string) => values[key],
            set: vi.fn((keyOrValues: string | Record<string, unknown>, value?: unknown) => {
                Object.assign(values, typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues)
            }),
            remove: vi.fn(),
        },
        onRemoteConfig: vi.fn((handler: (result: RemoteConfigResult) => void): Disposable => {
            remoteConfigHandlers.add(handler)
            return {
                dispose: () => {
                    remoteConfigHandlers.delete(handler)
                    remoteConfigDispose()
                },
            }
        }),
        sendRequest: options.sendRequest ?? vi.fn(async () => ({ statusCode: 200, json: { surveys: [] } })),
    } as unknown as Client
    return {
        client,
        values,
        remoteConfigDispose,
        publishRemoteConfig: (result: RemoteConfigResult) => remoteConfigHandlers.forEach((handler) => handler(result)),
    }
}

describe('PostHogSurveys shared extension lifecycle', () => {
    it('keeps construction side-effect free and starts through setup', () => {
        const { source } = createConfigSource()
        const { client } = createClient()

        const surveys = new PostHogSurveys(source)

        expect(source.getExtensions).not.toHaveBeenCalled()
        expect(source.createEventReceiver).not.toHaveBeenCalled()
        expect(client.onRemoteConfig).not.toHaveBeenCalled()

        surveys.setup(client)

        expect(client.kv.initialize).toHaveBeenCalledTimes(1)
        expect(client.onRemoteConfig).toHaveBeenCalledTimes(1)
    })

    it('keeps script loading deduplicated when remote config replays during setup', () => {
        const { extensions, manager, source } = createConfigSource()
        extensions.generateSurveys = undefined
        let finishLoading!: () => void
        extensions.loadExternalDependency = vi.fn((callback) => {
            finishLoading = () => {
                extensions.generateSurveys = vi.fn(() => manager as any)
                callback()
            }
        })
        const { client } = createClient()
        ;(client.onRemoteConfig as vi.Mock).mockImplementation((handler: (result: RemoteConfigResult) => void) => {
            handler({ ok: true, config: { surveys: true } as any })
            return { dispose: vi.fn() }
        })
        const surveys = new PostHogSurveys(source)

        surveys.setup(client)

        expect(extensions.loadExternalDependency).toHaveBeenCalledTimes(1)
        expect(surveys['_isInitializingSurveys']).toBe(true)

        finishLoading()

        expect(extensions.generateSurveys).toHaveBeenCalledTimes(1)
        expect(source.createEventReceiver).toHaveBeenCalledTimes(1)
        expect(surveys['_isInitializingSurveys']).toBe(false)
    })

    it('handles remote config once through the shared listener and preserves safe missing/failure behavior', () => {
        const { extensions, source } = createConfigSource()
        const { client, publishRemoteConfig } = createClient()
        const surveys = new PostHogSurveys(source)
        surveys.setup(client)

        publishRemoteConfig({ ok: false })
        publishRemoteConfig({ ok: true, config: {} as any })
        expect(extensions.generateSurveys).not.toHaveBeenCalled()

        publishRemoteConfig({ ok: true, config: { surveys: true } as any })
        expect(extensions.generateSurveys).toHaveBeenCalledTimes(1)
        expect(extensions.generateSurveys).toHaveBeenCalledWith(true)
    })

    it('leaves receiver registrations untouched when a refresh has no triggered surveys', async () => {
        const { receiver, source } = createConfigSource({ advancedEnableSurveys: true })
        const { client } = createClient()
        const surveys = new PostHogSurveys(source)
        surveys.setup(client)

        const result = await new Promise<Survey[]>((resolve) => surveys.getSurveys(resolve, true))

        expect(result).toEqual([])
        expect(receiver.register).not.toHaveBeenCalled()
        expect(receiver.replace).not.toHaveBeenCalled()
    })

    it('registers refreshed survey triggers without replacing receiver state', async () => {
        const survey = {
            id: 'event-survey',
            start_date: '2026-01-01T00:00:00.000Z',
            end_date: null,
            conditions: { events: { values: [{ name: 'trigger-event' }] } },
        } as Survey
        const sendRequest = vi.fn(async () => ({ statusCode: 200, json: { surveys: [survey] } }))
        const { receiver, source } = createConfigSource({ advancedEnableSurveys: true })
        const { client } = createClient({ sendRequest })
        const surveys = new PostHogSurveys(source)
        surveys.setup(client)

        const result = await new Promise<Survey[]>((resolve) => surveys.getSurveys(resolve, true))

        expect(result).toEqual([survey])
        expect(receiver.register).toHaveBeenCalledTimes(1)
        expect(receiver.register).toHaveBeenCalledWith([survey])
        expect(receiver.replace).not.toHaveBeenCalled()
    })

    it('disposes synchronously and idempotently and blocks late remote config and request work', async () => {
        let resolveRequest!: (response: ApiResponse) => void
        const sendRequest = vi.fn(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        ) as Client['sendRequest']
        const { manager, receiver, source } = createConfigSource({ advancedEnableSurveys: true })
        const { client, publishRemoteConfig } = createClient({ sendRequest })
        const surveys = new PostHogSurveys(source)
        surveys.setup(client)
        const callback = vi.fn()
        surveys.getSurveys(callback, true)

        surveys.dispose()
        surveys.dispose()
        publishRemoteConfig({ ok: true, config: { surveys: true } as any })
        resolveRequest({ statusCode: 200, json: { surveys: [{ id: 'late' } as Survey] } })
        await Promise.resolve()

        expect(callback).not.toHaveBeenCalled()
        expect(manager.dispose).toHaveBeenCalledTimes(1)
        expect(receiver.dispose).toHaveBeenCalledTimes(1)
        expect(client.kv.set).not.toHaveBeenCalled()
    })

    it('does not acquire resources when disposed during asynchronous KV initialization', async () => {
        let finishInitialization!: () => void
        const initialize = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finishInitialization = resolve
                })
        )
        const { source } = createConfigSource()
        const { client } = createClient({ initialize })
        const surveys = new PostHogSurveys(source)

        const setup = surveys.setup(client)
        surveys.dispose()
        finishInitialization()
        await setup

        expect(client.onRemoteConfig).not.toHaveBeenCalled()
        expect(source.getExtensions).not.toHaveBeenCalled()
    })
})
