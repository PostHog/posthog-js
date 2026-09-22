import { logger } from '@posthog/browser-common/utils/logger'

import { assignableWindow } from '../utils/globals'

/**
 * `customizations.full.js` publishes `window.posthogCustomizations` when it runs. A page that
 * loads the script with `defer` runs it after the inline `posthog.init(...)`, so the `loaded`
 * callback finds no global and the customization never runs.
 *
 * The snippet bootstrap installs a stub that queues those calls, in the same way the snippet
 * queues calls on `window.posthog`. The bundle replays the queue when it lands.
 *
 * Only a customization that acts on the instance it receives can be queued. The ones that
 * return a value the caller uses at once - the sampling `before_send` builders and the Redux
 * and Kea loggers - need the bundle to be there already, so a page must not defer the script
 * when it uses them.
 */
const QUEUEABLE_CUSTOMIZATIONS = ['setAllPersonProfilePropertiesAsPersonPropertiesForFlags'] as const

type QueueableCustomization = (typeof QUEUEABLE_CUSTOMIZATIONS)[number]
type QueuedCall = [QueueableCustomization, any[]]

// a single leading underscore is mangled per bundle, and this key crosses the boundary
// between the snippet bundle and customizations.full.js
const QUEUE_KEY = '__queuedCalls'

export function installCustomizationsQueue(): void {
    if (assignableWindow.posthogCustomizations) {
        return
    }

    const queue: QueuedCall[] = []
    const stub: Record<string, any> = { [QUEUE_KEY]: queue }

    QUEUEABLE_CUSTOMIZATIONS.forEach((name) => {
        stub[name] = (...args: any[]) => queue.push([name, args])
    })

    assignableWindow.posthogCustomizations = stub
}

export function publishCustomizations(customizations: Record<string, any>): void {
    const queued: QueuedCall[] = assignableWindow.posthogCustomizations?.[QUEUE_KEY] || []

    assignableWindow.posthogCustomizations = customizations

    queued.forEach(([name, args]) => {
        try {
            customizations[name](...args)
        } catch (err) {
            logger.critical(`queued customization \`${name}\` failed`, err)
        }
    })
}
