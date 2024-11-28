import { PostHog } from './posthog-core'
import { CaptureResult, DecideResponse } from './types'
import { assignableWindow } from './utils/globals'
import { logger } from './utils/logger'
import { isArray, isUndefined } from './utils/type-utils'

export class SiteApps {
    _decideServerSiteAppsResponse?: DecideResponse['siteApps']
    missedInvocations: Record<string, any>[]
    loaded: boolean
    appsLoading: Set<string>

    constructor(private readonly instance: PostHog) {
        // events captured between loading posthog-js and the site app; up to 1000 events
        this.missedInvocations = []
        // capture events until loaded
        this.loaded = false
        this.appsLoading = new Set()
    }

    eventCollector(_eventName: string, eventPayload?: CaptureResult | undefined) {
        // can't use if site apps are disabled, or if we're not asking /decide for site apps
        const enabled = this.instance.config.opt_in_site_apps && !this.instance.config.advanced_disable_decide
        if (!enabled) {
            return
        }
        if (!this.loaded && eventPayload) {
            const globals = this.globalsForEvent(eventPayload)
            this.missedInvocations.push(globals)
            if (this.missedInvocations.length > 1000) {
                this.missedInvocations = this.missedInvocations.slice(10)
            }
        }
    }

    init() {
        this.instance?._addCaptureHook(this.eventCollector.bind(this))
    }

    globalsForEvent(event: CaptureResult): Record<string, any> {
        if (!event) {
            throw new Error('Event payload is required')
        }
        const groups: Record<string, Record<string, any>> = {}
        const groupIds = this.instance.get_property('$groups') || []
        const groupProperties = this.instance.get_property('$stored_group_properties') || {}
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

    loadIfEnabled() {
        if (
            this._decideServerSiteAppsResponse &&
            isArray(this._decideServerSiteAppsResponse) &&
            this._decideServerSiteAppsResponse.length > 0
        ) {
            // can't use if site apps are disabled, or if we're not asking /decide for site apps
            const enabled = this.instance.config.opt_in_site_apps && !this.instance.config.advanced_disable_decide
            if (enabled) {
                const checkIfAllLoaded = () => {
                    // Stop collecting events once all site apps are loaded
                    if (this.appsLoading.size === 0) {
                        this.loaded = true
                        this.missedInvocations = []
                    }
                }
                for (const { id, type, url } of this._decideServerSiteAppsResponse) {
                    // if consent isn't given, skip site destinations
                    if (this.instance.consent.isOptedOut() && type === 'site_destination') continue
                    // if the site app is already loaded, skip it
                    if (!isUndefined(assignableWindow[`__$$ph_site_app_${id}_posthog`])) continue
                    this.appsLoading.add(id)
                    assignableWindow[`__$$ph_site_app_${id}_posthog`] = this.instance
                    assignableWindow[`__$$ph_site_app_${id}_missed_invocations`] = () => this.missedInvocations
                    assignableWindow[`__$$ph_site_app_${id}_callback`] = () => {
                        this.appsLoading.delete(id)
                        checkIfAllLoaded()
                    }
                    assignableWindow.__PosthogExtensions__?.loadSiteApp?.(this.instance, url, (err) => {
                        if (err) {
                            this.appsLoading.delete(id)
                            checkIfAllLoaded()
                            return logger.error(`Error while initializing PostHog app with config id ${id}`, err)
                        }
                    })
                }
                checkIfAllLoaded()
            } else if (this._decideServerSiteAppsResponse.length > 0) {
                logger.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.')
                this.loaded = true
            } else {
                this.loaded = true
            }
        } else {
            this.loaded = true
        }
    }

    afterDecideResponse(response: DecideResponse): void {
        this._decideServerSiteAppsResponse = response['siteApps']
        this.loadIfEnabled()
    }
}
