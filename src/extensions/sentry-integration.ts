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
import { EventProcessor, Hub } from '@sentry/types'
import { Properties } from '../types'
import { PostHogLib } from '../posthog-core'

export class SentryIntegration {
    name: string
    setupOnce: (addGlobalEventProcessor: (callback: EventProcessor) => void, getCurrentHub: () => Hub) => void

    constructor(_posthog: PostHogLib, organization: string, projectId: number, prefix: string) {
        // setupOnce gets called by Sentry when it intializes the plugin
        // 'this' is not this: PostHogLib object, but the new class that's created.
        // TODO: refactor to a real class. The types
        this.name = 'posthog-js'
        this.setupOnce = function (addGlobalEventProcessor: (callback: EventProcessor) => void) {
            addGlobalEventProcessor((event) => {
                if (event.level !== 'error' || !_posthog.__loaded) return event
                if (!event.tags) event.tags = {}
                event.tags['PostHog Person URL'] = _posthog.config.api_host + '/person/' + _posthog.get_distinct_id()
                if (_posthog.sessionRecordingStarted()) {
                    event.tags['PostHog Recording URL'] =
                        _posthog.config.api_host +
                        '/recordings/#sessionRecordingId=' +
                        _posthog.sessionManager.checkAndGetSessionAndWindowId(true).sessionId
                }
                const data: Properties = {
                    $sentry_event_id: event.event_id,
                    $sentry_exception: event.exception,
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
