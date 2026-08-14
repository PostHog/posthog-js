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
        dispose: jest.fn(),
    }
    const receiver = {
        dispose: jest.fn(),
        register: jest.fn(),
    }
    const extensions: SurveysExtensionHost = {
        generateSurveys: jest.fn(() => manager as any),
    }
    const source: SurveysConfigSource = {
        get: jest.fn(() => ({ ...config })),
        isOptedOut: jest.fn(() => false),
        getExtensions: jest.fn(() => extensions),
        createEventReceiver: jest.fn(() => receiver as any),
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
    const remoteConfigDispose = jest.fn()
    const client = {
        projectToken: 'test-token',
        kv: {
            initialize: jest.fn(options.initialize ?? (() => {})),
            get: (key: string) => values[key],
            set: jest.fn((keyOrValues: string | Record<string, unknown>, value?: unknown) => {
                Object.assign(values, typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues)
            }),
            remove: jest.fn(),
        },
        onRemoteConfig: jest.fn((handler: (result: RemoteConfigResult) => void): Disposable => {
            remoteConfigHandlers.add(handler)
            return {
                dispose: () => {
                    remoteConfigHandlers.delete(handler)
                    remoteConfigDispose()
                },
            }
        }),
        sendRequest: options.sendRequest ?? jest.fn(async () => ({ statusCode: 200, json: { surveys: [] } })),
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

    it('disposes synchronously and idempotently and blocks late remote config and request work', async () => {
        let resolveRequest!: (response: ApiResponse) => void
        const sendRequest = jest.fn(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        ) as Client['sendRequest']
        const { manager, receiver, source } = createConfigSource({ advancedEnableSurveys: true })
        const { client, publishRemoteConfig } = createClient({ sendRequest })
        const surveys = new PostHogSurveys(source)
        surveys.setup(client)
        const callback = jest.fn()
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
        const initialize = jest.fn(
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
