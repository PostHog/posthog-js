import { createPostHog } from '../src'
import { autocapture } from '../src/autocapture'
import { surveys } from '../src/surveys'
import type { PostHog } from '../src/types'
import type { Survey } from '../src/surveys-options'

let client: PostHog | undefined
let captured: { event: string; properties: Record<string, unknown> }[] = []
let definitions: Survey[] = []
let requests = 0
let release: (() => void) | undefined
const remote = {
    toolbarParams: {},
    toolbarVersion: 'toolbar' as const,
    isAuthenticated: false,
    siteApps: [],
    supportedCompression: [],
    autocapture_opt_out: false,
    surveys: true,
}
const actionSurvey: Survey = {
    id: 'action-survey',
    name: 'Click feedback',
    type: 'popover',
    questions: [{ type: 'open', question: 'How was that click?' }],
    start_date: '2025-01-01',
    end_date: null,
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    appearance: null,
    current_iteration: null,
    current_iteration_start_date: null,
    conditions: {
        events: null,
        cancelEvents: null,
        actions: {
            values: [{ id: 1, name: 'button action', steps: [{ event: '$autocapture', selector: '.trigger' }] }],
        },
    },
}
export const autocaptureHarness = {
    async initialize(
        mode: 'dynamic' | 'surveys-first' | 'autocapture-first',
        delayed = false,
        masked = false,
        urlFilter?: string
    ) {
        await client?.dispose()
        document.body.insertAdjacentHTML(
            'beforeend',
            '<button class="trigger" data-private="hidden"><span>Continue</span><svg width="24" height="24"><circle cx="12" cy="12" r="10"></circle></svg></button><div class="ph-no-capture"><button class="trigger" id="blocked">Private</button></div>'
        )
        captured = []
        requests = 0
        definitions = [
            {
                ...actionSurvey,
                ...(urlFilter
                    ? {
                          conditions: {
                              events: null,
                              cancelEvents: null,
                              actions: {
                                  values: [
                                      {
                                          id: 1,
                                          name: 'button action',
                                          steps: [
                                              {
                                                  event: '$autocapture',
                                                  selector: '.trigger',
                                                  url: urlFilter,
                                                  url_matching: 'contains',
                                              },
                                          ],
                                      },
                                  ],
                              },
                          },
                      }
                    : {}),
            },
        ]
        const gate = delayed
            ? new Promise<void>((resolve) => {
                  release = resolve
              })
            : Promise.resolve()
        const ac = autocapture({ maskAllText: masked, maskAllElementAttributes: masked })
        const surveyExtension = surveys({ automaticDisplay: false })
        const extensions =
            mode === 'dynamic' ? [] : mode === 'surveys-first' ? [surveyExtension, ac] : [ac, surveyExtension]
        client = await createPostHog({
            projectToken: 'ph_autocapture_browser',
            storage: false,
            navigator: false,
            capturePageview: false,
            flags: false,
            logs: false,
            analytics: false,
            surveys: { automaticDisplay: false },
            autocapture: { maskAllText: masked, maskAllElementAttributes: masked },
            extensions,
            remoteConfig: remote,
            fetch: async (input) => {
                if (String(input).includes('/api/surveys/')) {
                    requests++
                    await gate
                    return new Response(JSON.stringify({ surveys: definitions }))
                }
                return new Response('{}')
            },
        })
        client.onEvent((event) => captured.push({ event: event.event, properties: { ...event.properties } }))
        if (!delayed) await client.canRenderSurvey(actionSurvey.id)
        else void client.canRenderSurvey(actionSurvey.id)
    },
    release() {
        release?.()
    },
    async eligible() {
        return (await client?.canRenderSurvey(actionSurvey.id))?.visible
    },
    display() {
        client?.displaySurvey(actionSurvey.id)
    },
    optOut() {
        client?.optOut()
    },
    optIn() {
        client?.optIn()
    },
    async dispose() {
        await client?.dispose()
    },
    events() {
        return captured
    },
    requests() {
        return requests
    },
    async clearSelectors() {
        definitions = []
        await new Promise<void>((resolve) => client?.getSurveys(() => resolve(), true))
    },
}
declare global {
    interface Window {
        autocaptureHarness: typeof autocaptureHarness
    }
}
