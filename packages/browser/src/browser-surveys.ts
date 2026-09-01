import type { ApiResponse, Client, KeyValueStore, SendRequestInit } from '@posthog/browser-common'
import { isUndefined } from '@posthog/core'

import type { PostHog } from './posthog-core'
import { PostHogSurveys } from './posthog-surveys'
import { extendURLParams } from './request'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from './surveys-config'
import type { Properties, QueuedRequestWithOptions } from './types'
import { assignableWindow } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'

class InitialSurveysKeyValueStore implements KeyValueStore {
    constructor(private readonly _instance: PostHog) {}

    initialize(): void {}

    get<T = unknown>(key: string): T | undefined
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get(keyOrKeys: string | readonly string[]): unknown {
        if (typeof keyOrKeys === 'string') {
            return this._instance.get_property(keyOrKeys)
        }
        const values: Record<string, unknown> = {}
        for (const key of keyOrKeys) {
            const value = this._instance.get_property(key)
            if (!isUndefined(value)) {
                values[key] = value
            }
        }
        return values
    }

    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
        this._instance.register(
            (typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues) as Properties
        )
    }

    remove(keyOrKeys: string | readonly string[]): void {
        if (typeof keyOrKeys === 'string') {
            this._instance.unregister(keyOrKeys)
            return
        }
        keyOrKeys.forEach((key) => this._instance.unregister(key))
    }
}

const createInitialSurveysClientState = (instance: PostHog): Pick<Client, 'projectToken' | 'kv'> => ({
    get projectToken() {
        return instance.config.token
    },
    kv: new InitialSurveysKeyValueStore(instance),
})

class BrowserSurveysConfigSource implements SurveysConfigSource {
    constructor(private readonly _instance: PostHog) {}

    get(): SurveysConfig {
        const config = this._instance.config
        return {
            disableSurveys: config.disable_surveys,
            cookielessMode: !!config.cookieless_mode,
            advancedEnableSurveys: config.advanced_enable_surveys,
            requestTimeoutMs: config.surveys_request_timeout_ms,
        }
    }

    isOptedOut(): boolean {
        return this._instance.consent.isOptedOut()
    }

    getExtensions(): SurveysExtensionHost | undefined {
        const extensions = assignableWindow?.__PosthogExtensions__
        if (!extensions) {
            return
        }
        const { generateSurveys, loadExternalDependency } = extensions
        return {
            generateSurveys: generateSurveys
                ? (isSurveysEnabled) => generateSurveys(this._instance, isSurveysEnabled)
                : undefined,
            loadExternalDependency: loadExternalDependency
                ? (callback) => loadExternalDependency(this._instance, 'surveys', callback)
                : undefined,
        }
    }

    createEventReceiver(): SurveyEventReceiver {
        return new SurveyEventReceiver(this._instance)
    }
}

/** Browser-v1 compatibility wrapper for the shared surveys extension. */
export class BrowserSurveys extends PostHogSurveys {
    constructor(private readonly _instance: PostHog) {
        super(new BrowserSurveysConfigSource(_instance), createInitialSurveysClientState(_instance))
    }

    protected override _sendSurveysRequest(path: string, init: SendRequestInit): Promise<ApiResponse> {
        const pathWithQuery = init.query ? extendURLParams(path, init.query) : path
        // eslint-disable-next-line compat/compat -- Shared extension transport is intentionally Promise-based.
        return new Promise((resolve) => {
            this._instance._send_request({
                method: init.method,
                url: this._instance.requestRouter.endpointFor(init.target ?? 'api', pathWithQuery),
                data: init.body as QueuedRequestWithOptions['data'],
                headers: init.headers,
                timeout: init.timeoutMs,
                fireCallbackOnDrop: true,
                transport: init.transport,
                compression: init.compression,
                timestampMode: init.sentAt,
                callback: resolve,
            })
        })
    }
}
