/**
 * Integrate Sentry with PostHog. This will add a direct link to the person in Sentry, and an $exception event in PostHog
 *
 * ### Usage
 *
 *     Sentry.init({
 *          dsn: 'https://example',
 *          integrations: [
 *              new posthog.SentryIntegration(posthog)
 *          ]
 *     })
 *
 * @param {Object} [posthog] The posthog object
 * @param {string} [organization] Optional: The Sentry organization, used to send a direct link from PostHog to Sentry
 * @param {Number} [projectId] Optional: The Sentry project id, used to send a direct link from PostHog to Sentry
 * @param {string} [prefix] Optional: Url of a self-hosted sentry instance (default: https://sentry.io/organizations/)
 */
import { Event, EventProcessor, Hub, Integration } from '@sentry/types'
import { Properties } from '../types'
import { PostHog } from '../posthog-core'

export class SentryIntegration implements Integration {
    name: string

    setupOnce: (addGlobalEventProcessor: (callback: EventProcessor) => void, getCurrentHub: () => Hub) => void

    constructor(_posthog: PostHog, organization?: string, projectId?: number, prefix?: string) {
        // setupOnce gets called by Sentry when it intializes the plugin
        // 'this' is not this: PostHogLib object, but the new class that's created.
        // TODO: refactor to a real class. The types
        this.name = 'posthog-js'
        this.setupOnce = function (addGlobalEventProcessor: (callback: EventProcessor) => void) {
            addGlobalEventProcessor((event: Event) => {
                if (event.level !== 'error' || !_posthog.__loaded) return event
                if (!event.tags) event.tags = {}
                const host = _posthog.config.ui_host || _posthog.config.api_host
                event.tags['PostHog Person URL'] = host + '/person/' + _posthog.get_distinct_id()
                if (_posthog.sessionRecordingStarted()) {
                    event.tags['PostHog Recording URL'] =
                        host +
                        '/recordings/#sessionRecordingId=' +
                        _posthog.sessionManager.checkAndGetSessionAndWindowId(true).sessionId
                }
                const exceptions = event.exception?.values || []
                const data: Properties = {
                    $sentry_event_id: event.event_id,
                    $sentry_exception: event.exception,
                    $sentry_exception_message: exceptions[0]?.value,
                    $sentry_exception_type: exceptions[0]?.type,
                    $sentry_tags: event.tags,
                }
                if (organization && projectId)
                    data['$sentry_url'] =
                        (prefix || 'https://sentry.io/organizations/') +
                        organization +
                        '/issues/?project=' +
                        projectId +
                        '&query=' +
                        event.event_id
                _posthog.capture('$exception', data)
                return event
            })
        }
    }
}
