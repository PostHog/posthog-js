import type { Client } from '@posthog/browser-common'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'
import { BrowserClientAdapter } from '../../extensions/browser-client'
import type { PostHog } from '../../posthog-core'

/** Fill the lifecycle plumbing omitted by focused legacy logs fixtures. */
export function createLogsClient(instance: PostHog, overrides: Partial<Client> = {}): BrowserClientAdapter {
    instance._internalEventEmitter ??= new SimpleEventEmitter()
    if (instance.persistence && !instance.persistence.get_property) {
        instance.persistence.get_property = (key) => instance.persistence?.props[key]
    }
    return Object.assign(new BrowserClientAdapter(instance), overrides)
}
