import { PostHog } from './posthog-core'
import { CaptureResult, Properties, RemoteConfig, SiteApp, SiteAppGlobals, SiteAppLoader } from './types'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'
import { isArray } from './utils/type-utils'

const logger = createLogger('[SiteApps]')

export class SiteApps {
    apps: Record<string, SiteApp>

    private stopBuffering?: () => void
    private bufferedInvocations: SiteAppGlobals[]

    constructor(private instance: PostHog) {
        // events captured between loading posthog-js and the site app; up to 1000 events
        this.bufferedInvocations = []
        this.apps = {}
    }

    public get isEnabled(): boolean {
        return !!this.instance.config.opt_in_site_apps
    }

    private eventCollector(_eventName: string, eventPayload?: CaptureResult | undefined) {
        if (!eventPayload) {
            return
        }
        const globals = this.globalsForEvent(eventPayload)
        this.bufferedInvocations.push(globals)
        if (this.bufferedInvocations.length > 1000) {
            this.bufferedInvocations = this.bufferedInvocations.slice(10)
        }
    }

    init() {
        if (this.isEnabled) {
            const stop = this.instance._addCaptureHook(this.eventCollector.bind(this))
            this.stopBuffering = () => {
                stop()
                this.bufferedInvocations = []
                this.stopBuffering = undefined
            }
        }
    }

    globalsForEvent(event: CaptureResult): SiteAppGlobals {
        if (!event) {
            throw new Error('Event payload is required')
        }
        const groups: SiteAppGlobals['groups'] = {}
        const groupIds = this.instance.get_property('$groups') || []
        const groupProperties: Record<string, Properties> = this.instance.get_property('$stored_group_properties') || {}
        for (const [type, properties] of Object.entries(groupProperties)) {
            groups[type] = { id: groupIds[type], type, properties }
        }
        const { $set_once, $set, ..._event } = event
        const globals = {
            event: {
                ..._event,
                properties: {
                    ...event.properties,
                    ...($set ? { $set: { ...(event.properties?.$set ?? {}), ...$set } } : {}),
                    ...($set_once ? { $set_once: { ...(event.properties?.$set_once ?? {}), ...$set_once } } : {}),
                },
                elements_chain: event.properties?.['$elements_chain'] ?? '',
                // TODO:
                // - elements_chain_href: '',
                // - elements_chain_texts: [] as string[],
                // - elements_chain_ids: [] as string[],
                // - elements_chain_elements: [] as string[],
                distinct_id: event.properties?.['distinct_id'],
            },
            person: {
                properties: this.instance.get_property('$stored_person_properties'),
            },
            groups,
        }
        return globals
    }

    setupSiteApp(loader: SiteAppLoader) {
        const app: SiteApp = {
            id: loader.id,
            loaded: false,
            errored: false,
        }
        this.apps[loader.id] = app

        const onLoaded = (success: boolean) => {
            this.apps[loader.id].errored = !success
            this.apps[loader.id].loaded = true

            logger.info(`Site app with id ${loader.id} ${success ? 'loaded' : 'errored'}`)

            if (success && this.bufferedInvocations.length) {
                logger.info(`Processing ${this.bufferedInvocations.length} events for site app with id ${loader.id}`)
                this.bufferedInvocations.forEach((globals) => app.processEvent?.(globals))
            }

            for (const app of Object.values(this.apps)) {
                if (!app.loaded) {
                    // If any other apps are not loaded, we don't want to stop buffering
                    return
                }
            }

            this.stopBuffering?.()
        }

        try {
            const { processEvent } = loader.init({
                posthog: this.instance,
                callback: (success) => {
                    onLoaded(success)
                },
            })

            if (processEvent) {
                app.processEvent = processEvent
            }
        } catch (e) {
            logger.error(`Error while initializing PostHog app with config id ${loader.id}`, e)
            onLoaded(false)
        }
    }

    private onCapturedEvent(event: CaptureResult) {
        if (Object.keys(this.apps).length === 0) {
            return
        }

        const globals = this.globalsForEvent(event)

        for (const app of Object.values(this.apps)) {
            try {
                app.processEvent?.(globals)
            } catch (e) {
                logger.error(`Error while processing event ${event.event} for site app ${app.id}`, e)
            }
        }
    }

    onRemoteConfig(response: RemoteConfig): void {
        if (isArray(assignableWindow._POSTHOG_JS_APPS)) {
            if (!this.isEnabled) {
                logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
                return
            }

            for (const app of assignableWindow._POSTHOG_JS_APPS) {
                this.setupSiteApp(app)
            }

            if (!assignableWindow._POSTHOG_JS_APPS.length) {
                this.stopBuffering?.()
            } else {
                // NOTE: We could improve this to only fire if we actually have listeners for the event
                this.instance.on('eventCaptured', (event) => this.onCapturedEvent(event))
            }

            return
        }

        // NOTE: Below his is now only the fallback for legacy site app support. Once we have fully removed to the remote config loader we can get rid of this

        this.stopBuffering?.()

        if (!response['siteApps']?.length) {
            return
        }

        if (!this.isEnabled) {
            logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
            return
        }

        for (const { id, url } of response['siteApps']) {
            assignableWindow[`__$$ph_site_app_${id}`] = this.instance
            assignableWindow.__PosthogExtensions__?.loadSiteApp?.(this.instance, url, (err) => {
                if (err) {
                    return logger.error(`Error while initializing PostHog app with config id ${id}`, err)
                }
            })
        }
    }
}
