import { TestInfo } from '@playwright/test'
import { CaptureResult, PostHogConfig } from '@/types'
import { PostHog } from '@/posthog-core'
import { EventsPage, testEvents } from './events'
import { BasePage } from './page'

export const testPostHog = testEvents.extend<{
    posthog: PosthogPage
    posthogOptions: Partial<PostHogConfig>
}>({
    posthogOptions: [{ request_batching: false }, { option: true }],
    posthog: async ({ page, events, posthogOptions }, use, testInfo) => {
        const posthogPage = new PosthogPage(posthogOptions, page, events, testInfo)
        await use(posthogPage)
    },
})

const currentEnv = process.env
const {
    POSTHOG_PROJECT_API_KEY = 'public_key',
    POSTHOG_API_HOST = 'http://localhost:2345',
    BRANCH_NAME,
    RUN_ID,
    BROWSER,
} = currentEnv

export type WindowWithPostHog = typeof globalThis & {
    posthog?: PostHog
    capturedEvents?: CaptureResult[]
    [key: string]: any
}

export class PosthogPage {
    testSessionId: string

    constructor(
        private baseOptions: Partial<PostHogConfig>,
        private page: BasePage,
        private events: EventsPage,
        private testInfos: TestInfo
    ) {
        this.testSessionId = Math.random().toString(36).substring(2, 15)
    }

    getTestSessionId() {
        return this.testSessionId
    }

    getTestTitle() {
        return this.testInfos.title
    }

    private getHandle() {
        return this.page.evaluateHandle(() => {
            const instance = (window as WindowWithPostHog).posthog
            if (!instance) {
                throw new Error('PostHog instance not found')
            }
            return instance
        })
    }

    async evaluate<T, U>(fn: (posthog: PostHog, args: T) => U, args?: T): Promise<U> {
        const handle = await this.getHandle()
        return await handle.evaluate(fn as any, args)
    }

    async waitForLoaded() {
        await this.page.waitForFunction(() => {
            return (window as WindowWithPostHog).posthog?.__loaded ?? false
        })
    }

    async init(
        initOptions: Partial<Omit<PostHogConfig, 'before_send' | 'loaded'>> = {},
        beforeSendHandles: string[] = []
    ) {
        const additionalProperties = {
            testSessionId: this.getTestSessionId(),
            testName: this.testInfos.title,
            testBranchName: BRANCH_NAME,
            testRunId: RUN_ID,
            testBrowser: BROWSER,
        }
        const storeHandle = await this.page.createFunctionHandle((evt: CaptureResult) => {
            this.events.addEvent(evt)
        })
        await this.page.evaluate((storeHandle) => {
            ;(window as WindowWithPostHog)['last_before_send'] = (evt: CaptureResult) => {
                ;(window as WindowWithPostHog)[storeHandle](evt)
                return evt
            }
        }, storeHandle)
        await this.evaluate(
            // TS very unhappy with passing PostHogConfig here, so just pass an object
            (ph: PostHog, args: Record<string, any>) => {
                const posthogConfig: Partial<PostHogConfig> = {
                    api_host: args.apiHost,
                    debug: true,
                    ip: false, // Prevent IP deprecation warning in Playwright tests
                    ...args.options,
                    before_send: args.beforeSendHandles.map((h: any) => window[h]),
                    loaded: (ph) => {
                        if (ph.sessionRecording) {
                            ph.sessionRecording._forceAllowLocalhostNetworkCapture = true
                        }
                        ph.register(args.additionalProperties)
                        // playwright can't serialize functions to pass around from the playwright to browser context
                        // if we want to run custom code in the loaded function we need to pass it on the page's window,
                        // but it's a new window so we have to create it in the `before_posthog_init` option
                        ;(window as any).__ph_loaded?.(ph)
                    },
                    opt_out_useragent_filter: true,
                }
                ph.init(args.token, posthogConfig)
            },
            {
                token: POSTHOG_PROJECT_API_KEY,
                apiHost: POSTHOG_API_HOST,
                options: {
                    ...this.baseOptions,
                    ...initOptions,
                },
                beforeSendHandles: [...beforeSendHandles, 'last_before_send'],
                additionalProperties,
            } as Record<string, any>
        )
        await this.page.waitForLoadState('networkidle')
    }

    async capture(eventName: string, properties?: Record<string, any>) {
        await this.evaluate(
            (ph, args: { eventName: string; properties?: Record<string, any> }) => {
                ph.capture(args.eventName, args.properties)
            },
            { eventName, properties }
        )
    }

    async register(records: Record<string, string>) {
        await this.page.evaluate(
            // TS very unhappy with passing PostHogConfig here, so just pass an object
            (args: Record<string, any>) => {
                const windowPosthog = (window as WindowWithPostHog).posthog
                windowPosthog?.register(args)
            },
            records
        )
    }
}
