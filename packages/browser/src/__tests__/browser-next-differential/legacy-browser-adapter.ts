import { isUndefined } from '@posthog/core'

import type { PostHog } from '../../posthog-core'
import type { CaptureResult, PostHogConfig, QueuedRequestWithOptions } from '../../types'
import { assignableWindow } from '../../utils/globals'

import {
    type BehaviorAdapter,
    type BehaviorClient,
    type BehaviorSetup,
    type ControlledRuntime,
    createGeneratedIdNormalizer,
    type IdentityObservation,
    type RecordedEvent,
} from './harness'

const copyProperties = (properties: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(properties)) as Record<string, unknown>

const createInstance = async (
    runtime: ControlledRuntime,
    capturedEvents: RecordedEvent[],
    setup: BehaviorSetup
): Promise<{ posthog: PostHog; removeCaptureHook: () => void }> => {
    assignableWindow._POSTHOG_REMOTE_CONFIG = {
        [runtime.projectToken]: {
            config: { autocapture_opt_out: true },
            siteApps: [],
        },
    } as typeof assignableWindow._POSTHOG_REMOTE_CONFIG

    let publicPostHog: PostHog | undefined
    await jest.isolateModulesAsync(async () => {
        publicPostHog = (await import('../../entrypoints/module.es')).default
    })
    if (!publicPostHog) {
        throw new Error('The canonical posthog-js module entry point did not initialize')
    }

    const posthog = await new Promise<PostHog>((resolve) => {
        publicPostHog!.init(runtime.projectToken, {
            api_host: 'https://us.i.posthog.com',
            persistence: 'localStorage',
            persistence_name: runtime.projectToken,
            request_batching: false,
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            advanced_disable_feature_flags: true,
            disable_session_recording: true,
            disable_surveys: true,
            disable_conversations: true,
            disable_external_dependency_loading: true,
            opt_out_capturing_by_default: setup.optOutByDefault,
            opt_out_capturing_persistence_type: 'localStorage',
            before_send: (event) => event,
            loaded: (loaded) => resolve(loaded as PostHog),
        } as Partial<PostHogConfig>)
    })

    const removeCaptureHook = posthog._addCaptureHook((_eventName, payload?: CaptureResult) => {
        if (payload) {
            capturedEvents.push({
                event: payload.event,
                properties: copyProperties({
                    ...payload.properties,
                    ...(isUndefined(payload.$set) ? {} : { $set: payload.$set }),
                    ...(isUndefined(payload.$set_once) ? {} : { $set_once: payload.$set_once }),
                    ...(isUndefined(payload.$unset) ? {} : { $unset: payload.$unset }),
                }),
            })
        }
    })
    posthog._send_retriable_request = (request: QueuedRequestWithOptions): void => {
        const url = new URL(request.url, posthog.config.api_host)
        runtime.recordRequest({
            kind: 'logical',
            url: url.toString(),
            path: url.pathname,
            method: request.method ?? 'GET',
            headers: request.headers ?? {},
            query: Object.fromEntries(url.searchParams.entries()),
            body: request.data,
        })
    }

    return { posthog, removeCaptureHook }
}

export const legacyBrowserAdapter: BehaviorAdapter = {
    name: 'legacy-browser',
    async create(runtime: ControlledRuntime, setup: BehaviorSetup = {}): Promise<BehaviorClient> {
        const capturedEvents: RecordedEvent[] = []
        const hadRemoteConfig = Object.prototype.hasOwnProperty.call(assignableWindow, '_POSTHOG_REMOTE_CONFIG')
        const previousRemoteConfig = assignableWindow._POSTHOG_REMOTE_CONFIG
        const previousExtensions = assignableWindow.__PosthogExtensions__
        const previousExternalLoader = previousExtensions?.loadExternalDependency
        let posthog: PostHog
        let removeCaptureHook: () => void
        try {
            ;({ posthog, removeCaptureHook } = await createInstance(runtime, capturedEvents, setup))
        } catch (error) {
            restoreRemoteConfig(hadRemoteConfig, previousRemoteConfig)
            restoreExternalLoader(previousExtensions, previousExternalLoader)
            throw error
        }
        let currentAnonymousId = posthog.get_distinct_id()
        const ids = createGeneratedIdNormalizer()
        ids.remember('anonymous', currentAnonymousId)

        return {
            async capture(event, properties): Promise<void> {
                posthog.capture(event, properties)
            },
            async identify(distinctId, set, setOnce): Promise<void> {
                posthog.identify(distinctId, set, setOnce)
            },
            async group(type, key, properties): Promise<void> {
                posthog.group(type, key, properties)
            },
            reset(): void {
                posthog.reset()
                currentAnonymousId = posthog.get_distinct_id()
                ids.remember('anonymous', currentAnonymousId)
            },
            optIn(): void {
                posthog.opt_in_capturing({ captureEventName: false })
            },
            optOut(): void {
                posthog.opt_out_capturing()
            },
            hasOptedOut(): boolean {
                return posthog.has_opted_out_capturing()
            },
            identity(): IdentityObservation {
                const isIdentified = posthog._isIdentified()
                return {
                    anonymousId: ids.normalize(currentAnonymousId, 'anonymous') as string,
                    distinctId: ids.normalize(posthog.get_distinct_id(), 'anonymous') as string,
                    isIdentified,
                }
            },
            groups(): Readonly<Record<string, string>> {
                return posthog.getGroups() as Record<string, string>
            },
            events(): readonly RecordedEvent[] {
                return capturedEvents.map((event) => ({
                    event: event.event,
                    properties: copyProperties(event.properties as Record<string, unknown>),
                }))
            },
            requests() {
                return runtime.requests()
            },
            normalizeId: ids.normalize,
            async dispose(): Promise<void> {
                removeCaptureHook()
                try {
                    await posthog.shutdown()
                    posthog.sessionManager?.destroy()
                    posthog.pageViewManager?.destroy()
                } finally {
                    restoreRemoteConfig(hadRemoteConfig, previousRemoteConfig)
                    restoreExternalLoader(previousExtensions, previousExternalLoader)
                }
            },
        }
    },
}

const restoreRemoteConfig = (
    hadRemoteConfig: boolean,
    previousRemoteConfig: typeof assignableWindow._POSTHOG_REMOTE_CONFIG
): void => {
    if (hadRemoteConfig) {
        assignableWindow._POSTHOG_REMOTE_CONFIG = previousRemoteConfig
    } else {
        delete assignableWindow._POSTHOG_REMOTE_CONFIG
    }
}

const restoreExternalLoader = (
    previousExtensions: typeof assignableWindow.__PosthogExtensions__,
    previousLoader: typeof assignableWindow.__PosthogExtensions__.loadExternalDependency | undefined
): void => {
    if (!previousExtensions) {
        delete assignableWindow.__PosthogExtensions__
        return
    }
    assignableWindow.__PosthogExtensions__ = previousExtensions
    if (previousLoader) {
        previousExtensions.loadExternalDependency = previousLoader
    } else {
        delete previousExtensions.loadExternalDependency
    }
}
