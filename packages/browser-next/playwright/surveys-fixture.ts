import { createPostHog } from '../src'
import { surveys } from '../src/surveys'
import { analytics } from '../src/analytics'
import { createAnalyticsExtension } from '../src/analytics-buffer'
import type { PostHog } from '../src/types'
import type { Survey } from '../src/surveys-options'

const survey: Survey = {
    id: 'browser-survey',
    name: 'Browser feedback',
    type: 'popover',
    questions: [{ id: 'answer', type: 'open', question: 'What can we improve?' }],
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    appearance: { displayThankYouMessage: false },
    conditions: null,
    start_date: '2025-01-01',
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
}
let client: PostHog | undefined
let events: { event: string; properties: Record<string, unknown> }[] = []
let requests = 0
let definitions: Survey[] = []

declare global {
    interface Window {
        surveysHarness: {
            initializeTeardown(projectToken: string, loading?: boolean): Promise<void>
            pagehide(): void
            initialize(
                mode: 'static' | 'dynamic',
                enabled: boolean,
                storage: boolean,
                automatic: boolean,
                eventTriggered?: boolean
            ): Promise<void>
            display(): void
            capture(): void
            optOut(): void
            optIn(): void
            dispose(): Promise<void>
            requests(): number
            events(): typeof events
        }
    }
}
export const surveysHarness: Window['surveysHarness'] = {
    async initialize(mode, enabled, storage, automatic, eventTriggered) {
        await client?.dispose()
        events = []
        requests = 0
        definitions = [
            {
                ...survey,
                ...(eventTriggered
                    ? {
                          conditions: {
                              events: { values: [{ name: 'trigger-survey' }] },
                              actions: null,
                              cancelEvents: null,
                          },
                      }
                    : {}),
            },
        ]
        const options = { automaticDisplay: automatic }
        client = await createPostHog({
            projectToken: 'ph_browser_surveys',
            persistenceKey: 'surveys-client',
            ...(storage ? {} : { storage: false as const }),
            navigator: false,
            capturePageview: false,
            analytics: false,
            flags: false,
            logs: false,
            ...(mode === 'static' ? { surveys: false, extensions: [surveys(options)] } : { surveys: options }),
            remoteConfig: {
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
                supportedCompression: [],
                surveys: enabled,
            },
            fetch: async (input) => {
                if (String(input).includes('/api/surveys/')) {
                    requests++
                    return new Response(JSON.stringify({ surveys: definitions }))
                }
                return new Response('{}')
            },
        })
        client.onEvent((event) => events.push({ event: event.event, properties: { ...event.properties } }))
    },
    async initializeTeardown(projectToken, loading = false) {
        await client?.dispose()
        events = []
        const definition: Survey = {
            ...survey,
            questions: [...survey.questions, { id: 'followup', type: 'open', question: 'Anything else?' }],
        }
        client = await createPostHog({
            projectToken,
            apiHost: window.location.origin,
            storage: false,
            navigator: false,
            capturePageview: false,
            analytics: false,
            flags: false,
            logs: false,
            remoteConfig: {
                supportedCompression: [],
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
                surveys: false,
            },
            extensions: [
                loading
                    ? createAnalyticsExtension({ flushInterval: 0 }, () => new Promise(() => {}))
                    : analytics({ flushInterval: 0 }),
                surveys({ automaticDisplay: false }),
            ],
            fetch: async (url, options) =>
                String(url).includes('/api/surveys/')
                    ? new Response(JSON.stringify({ surveys: [definition] }), { status: 200 })
                    : globalThis.fetch(url, options),
        })
        client.onEvent((event) => events.push({ event: event.event, properties: { ...event.properties } }))
        client.displaySurvey(survey.id)
    },
    pagehide() {
        window.dispatchEvent(new Event('pagehide'))
    },
    display: () => client?.displaySurvey(survey.id),
    capture: () => client?.capture('trigger-survey'),
    optOut: () => client?.optOut(),
    optIn: () => client?.optIn(),
    dispose: async () => {
        await client?.dispose()
    },
    requests: () => requests,
    events: () => events,
}
