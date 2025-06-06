import { PostHog } from './posthog-core'
import { CaptureResult, Properties, RemoteConfig, SiteApp, SiteAppGlobals, SiteAppLoader } from './types'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'

const logger = createLogger('[SiteApps]')

export class SiteApps {
    apps: Record<string, SiteApp>

    private _stopBuffering?: () => void
    private _bufferedInvocations: SiteAppGlobals[]

    constructor(private _instance: PostHog) {
        // events captured between loading posthog-js and the site app; up to 1000 events
        this._bufferedInvocations = []
        this.apps = {}
    }

    public get isEnabled(): boolean {
        return !!this._instance.config.opt_in_site_apps
    }

    private _eventCollector(_eventName: string, eventPayload?: CaptureResult | undefined) {
        if (!eventPayload) {
            return
        }
        const globals = this.globalsForEvent(eventPayload)
        this._bufferedInvocations.push(globals)
        if (this._bufferedInvocations.length > 1000) {
            this._bufferedInvocations = this._bufferedInvocations.slice(10)
        }
    }

    get siteAppLoaders(): SiteAppLoader[] | undefined {
        return assignableWindow._POSTHOG_REMOTE_CONFIG?.[this._instance.config.token]?.siteApps
    }

    init() {
        if (this.isEnabled) {
            const stop = this._instance._addCaptureHook(this._eventCollector.bind(this))
            this._stopBuffering = () => {
                stop()
                this._bufferedInvocations = []
                this._stopBuffering = undefined
            }
        }
    }

    globalsForEvent(event: CaptureResult): SiteAppGlobals {
        if (!event) {
            throw new Error('Event payload is required')
        }
        const groups: SiteAppGlobals['groups'] = {}
        const groupIds = this._instance.get_property('$groups') || []
        const groupProperties: Record<string, Properties> =
            this._instance.get_property('$stored_group_properties') || {}
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
                properties: this._instance.get_property('$stored_person_properties'),
            },
            groups,
        }
        return globals
    }

    setupSiteApp(loader: SiteAppLoader) {
        const app = this.apps[loader.id]
        const processBufferedEvents = () => {
            if (!app.errored && this._bufferedInvocations.length) {
                logger.info(`Processing ${this._bufferedInvocations.length} events for site app with id ${loader.id}`)
                this._bufferedInvocations.forEach((globals) => app.processEvent?.(globals))
                app.processedBuffer = true
            }

            if (Object.values(this.apps).every((app) => app.processedBuffer || app.errored)) {
                this._stopBuffering?.()
            }
        }

        let hasInitReturned = false
        const onLoaded = (success: boolean) => {
            app.errored = !success
            app.loaded = true
            logger.info(`Site app with id ${loader.id} ${success ? 'loaded' : 'errored'}`)
            // ensure that we don't call processBufferedEvents until after init() returns and we've set up processEvent
            if (hasInitReturned) {
                processBufferedEvents()
            }
        }

        try {
            const { processEvent } = loader.init({
                posthog: this._instance,
                callback: (success) => {
                    onLoaded(success)
                },
            })
            if (processEvent) {
                app.processEvent = processEvent
            }
            hasInitReturned = true
        } catch (e) {
            logger.error(`Error while initializing PostHog app with config id ${loader.id}`, e)
            onLoaded(false)
        }

        // if the app loaded synchronously, process the events now
        if (hasInitReturned && app.loaded) {
            try {
                processBufferedEvents()
            } catch (e) {
                logger.error(`Error while processing buffered events PostHog app with config id ${loader.id}`, e)
                app.errored = true
            }
        }
    }

    private _setupSiteApps() {
        const siteAppLoaders = this.siteAppLoaders || []

        // do this in 2 passes, so that this.apps is populated before we call init
        for (const loader of siteAppLoaders) {
            this.apps[loader.id] = {
                id: loader.id,
                loaded: false,
                errored: false,
                processedBuffer: false,
            }
        }
        for (const loader of siteAppLoaders) {
            this.setupSiteApp(loader)
        }
    }

    private _onCapturedEvent(event: CaptureResult) {
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
        if (this.siteAppLoaders?.length) {
            if (!this.isEnabled) {
                logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
                return
            }

            this._setupSiteApps()

            // NOTE: We could improve this to only fire if we actually have listeners for the event
            this._instance.on('eventCaptured', (event) => this._onCapturedEvent(event))

            return
        }

        // NOTE: Below this is now only the fallback for legacy site app support. Once we have fully removed to the remote config loader we can get rid of this

        this._stopBuffering?.()

        if (!response['siteApps']?.length) {
            return
        }

        if (!this.isEnabled) {
            logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
            return
        }

        for (const { id, url } of response['siteApps']) {
            assignableWindow[`__$$ph_site_app_${id}`] = this._instance
            assignableWindow.__PosthogExtensions__?.loadSiteApp?.(this._instance, url, (err) => {
                if (err) {
                    return logger.error(`Error while initializing PostHog app with config id ${id}`, err)
                }
            })
        }
    }
}
