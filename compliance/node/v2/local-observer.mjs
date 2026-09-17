import { AsyncLocalStorage } from 'node:async_hooks'
import { types } from 'node:util'

const promiseThen = Promise.prototype.then
// Inspect only data properties: private seam accessors are not an observation contract.
const data = (object, key) => {
    try {
        return Object.getOwnPropertyDescriptor(object, key)?.value
    } catch {
        return undefined
    }
}

export class LocalObserver {
    context = new AsyncLocalStorage()
    constructor(sdkVersion) {
        this.implementation = `posthog-node@${sdkVersion}:FeatureFlagsPoller.computeFlagAndPayloadLocally`
    }
    attach(client) {
        let poller, original
        try {
            poller = client?.featureFlagsPoller
            original = poller?.computeFlagAndPayloadLocally
        } catch {
            return false
        }
        if (typeof original !== 'function') return false
        const context = this.context
        const implementation = this.implementation
        const wrapped = function (...args) {
            const scope = context.getStore()
            const key = data(args[0], 'key')
            if (scope?.active) scope.calls++
            const result = original.apply(this, args)
            // Never assimilate a thenable or replace the SDK's result. An incompatible
            // private seam leaves a provenance gap, not an instrumentation exception.
            if (scope?.active && types.isPromise(result)) {
                try {
                    promiseThen.call(result, (value) => {
                        const observed = data(value, 'value')
                        if (scope.active && typeof key === 'string' && ['boolean', 'string'].includes(typeof observed)) {
                            scope.observation = {
                                layer: 'native_component', implementation,
                                call_id: scope.callId, key, resolution: 'local', value: observed,
                            }
                        }
                    }, () => {})
                } catch {
                    // A Promise subclass with an incompatible species cannot be observed.
                }
            }
            return result
        }
        try {
            const descriptor = Object.getOwnPropertyDescriptor(poller, 'computeFlagAndPayloadLocally')
            Object.defineProperty(poller, 'computeFlagAndPayloadLocally', {
                configurable: true, writable: true, value: wrapped,
            })
            this.restore = () => {
                if (descriptor) Object.defineProperty(poller, 'computeFlagAndPayloadLocally', descriptor)
                else delete poller.computeFlagAndPayloadLocally
            }
            return true
        } catch {
            return false
        }
    }
    async run(callId, operation) {
        const scope = { callId, active: true, calls: 0 }
        try {
            const completion = await this.context.run(scope, operation)
            return { completion, ...(scope.calls === 1 && scope.observation ? { provenance: scope.observation } : {}) }
        } finally {
            scope.active = false
        }
    }
    close() {
        this.restore?.()
        this.context.disable()
    }
}
