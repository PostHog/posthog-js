import { isObject } from '@posthog/core'
import type { PostHog } from '../../posthog-core'

const capturedInstances = new WeakMap<object, WeakSet<PostHog>>()

export function markExceptionCaptured(instance: PostHog, error: unknown): void {
    if (!isObject(error)) {
        return
    }

    let instances = capturedInstances.get(error)
    if (!instances) {
        instances = new WeakSet()
        capturedInstances.set(error, instances)
    }
    instances.add(instance)
}

export function isExceptionCaptured(instance: PostHog, error: unknown): boolean {
    return isObject(error) && capturedInstances.get(error)?.has(instance) === true
}
