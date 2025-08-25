/**
 * @file Adapted from [posthog-js](https://github.com/PostHog/posthog-js/blob/8157df935a4d0e71d2fefef7127aa85ee51c82d1/src/extensions/sentry-integration.ts) with modifications for the Node SDK.
 */
/**
 * Integrate Sentry with PostHog. This will add a direct link to the person in Sentry, and an $exception event in PostHog.
 *
 * ### Usage
 *
 *     Sentry.init({
 *          dsn: 'https://example',
 *          integrations: [
 *              new PostHogSentryIntegration(posthog)
 *          ]
 *     })
 *
 *     Sentry.setTag(PostHogSentryIntegration.POSTHOG_ID_TAG, 'some distinct id');
 *
 * @param {Object} [posthog] The posthog object
 * @param {string} [organization] Optional: The Sentry organization, used to send a direct link from PostHog to Sentry
 * @param {Number} [projectId] Optional: The Sentry project id, used to send a direct link from PostHog to Sentry
 * @param {string} [prefix] Optional: Url of a self-hosted sentry instance (default: https://sentry.io/organizations/)
 * @param {SeverityLevel[] | '*'} [severityAllowList] Optional: send events matching the provided levels. Use '*' to send all events (default: ['error'])
 */
const NAME = 'posthog-node';
export function createEventProcessor(_posthog, { organization, projectId, prefix, severityAllowList = ['error'] } = {}) {
    return (event) => {
        const shouldProcessLevel = severityAllowList === '*' || severityAllowList.includes(event.level);
        if (!shouldProcessLevel) {
            return event;
        }
        if (!event.tags) {
            event.tags = {};
        }
        // Get the PostHog user ID from a specific tag, which users can set on their Sentry scope as they need.
        const userId = event.tags[PostHogSentryIntegration.POSTHOG_ID_TAG];
        if (userId === undefined) {
            // If we can't find a user ID, don't bother linking the event. We won't be able to send anything meaningful to PostHog without it.
            return event;
        }
        const uiHost = _posthog.options.host ?? 'https://us.i.posthog.com';
        const personUrl = new URL(`/project/${_posthog.apiKey}/person/${userId}`, uiHost).toString();
        event.tags['PostHog Person URL'] = personUrl;
        const exceptions = event.exception?.values || [];
        const exceptionList = exceptions.map((exception) => ({
            ...exception,
            stacktrace: exception.stacktrace
                ? {
                    ...exception.stacktrace,
                    type: 'raw',
                    frames: (exception.stacktrace.frames || []).map((frame) => {
                        return { ...frame, platform: 'node:javascript' };
                    }),
                }
                : undefined,
        }));
        const properties = {
            // PostHog Exception Properties,
            $exception_message: exceptions[0]?.value || event.message,
            $exception_type: exceptions[0]?.type,
            $exception_personURL: personUrl,
            $exception_level: event.level,
            $exception_list: exceptionList,
            // Sentry Exception Properties
            $sentry_event_id: event.event_id,
            $sentry_exception: event.exception,
            $sentry_exception_message: exceptions[0]?.value || event.message,
            $sentry_exception_type: exceptions[0]?.type,
            $sentry_tags: event.tags,
        };
        if (organization && projectId) {
            properties['$sentry_url'] =
                (prefix || 'https://sentry.io/organizations/') +
                    organization +
                    '/issues/?project=' +
                    projectId +
                    '&query=' +
                    event.event_id;
        }
        _posthog.capture({ event: '$exception', distinctId: userId, properties });
        return event;
    };
}
// V8 integration - function based
export function sentryIntegration(_posthog, options) {
    const processor = createEventProcessor(_posthog, options);
    return {
        name: NAME,
        processEvent(event) {
            return processor(event);
        },
    };
}
// V7 integration - class based
export class PostHogSentryIntegration {
    constructor(_posthog, organization, prefix, severityAllowList) {
        this.name = NAME;
        // setupOnce gets called by Sentry when it intializes the plugin
        this.name = NAME;
        this.setupOnce = function (addGlobalEventProcessor, getCurrentHub) {
            const projectId = getCurrentHub()?.getClient()?.getDsn()?.projectId;
            addGlobalEventProcessor(createEventProcessor(_posthog, {
                organization,
                projectId,
                prefix,
                severityAllowList,
            }));
        };
    }
}
PostHogSentryIntegration.POSTHOG_ID_TAG = 'posthog_distinct_id';
//# sourceMappingURL=sentry-integration.js.map