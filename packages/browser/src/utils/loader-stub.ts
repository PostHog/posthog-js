import type { PostHogConfig } from '@posthog/types'
import methods from 'virtual:posthog-loader-methods'

type QueuedCall = [string, ...unknown[]]
export type QueuedInit = [string, Partial<PostHogConfig>, string]

function createStub(instanceName = 'posthog') {
    const stub = Object.assign([] as QueuedCall[], { people: [] as QueuedCall[] })
    for (const method of methods.split(' ')) {
        const [namespace, nestedMethod] = method.split('.')
        const queue = nestedMethod ? stub.people : stub
        const name = nestedMethod || namespace
        Object.defineProperty(queue, name, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: (...args: unknown[]) => {
                queue.push([name, ...args])
            },
        })
    }
    const name = instanceName === 'posthog' ? 'posthog' : 'posthog.' + instanceName
    Object.defineProperty(stub, 'toString', { value: () => name + ' (stub)', configurable: true })
    Object.defineProperty(stub.people, 'toString', { value: () => name + '.people (stub)', configurable: true })
    return stub
}

export function createPostHogStub(initialization?: QueuedInit) {
    const posthog = Object.assign(createStub(), {
        __SV: 1,
        _i: initialization ? [initialization] : [],
    })
    Object.defineProperty(posthog, 'init', {
        value: (token: string, config: Partial<PostHogConfig> = {}, name?: string) => {
            const instanceName = name || 'posthog'
            const existing = Object.getOwnPropertyDescriptor(posthog, instanceName)?.value
            const instance = instanceName === 'posthog' ? posthog : existing || createStub(instanceName)
            if (instanceName !== 'posthog' && !existing) {
                Object.defineProperty(posthog, instanceName, {
                    value: instance,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                })
            }
            posthog._i.push([token, config, instanceName])
            return instance
        },
    })
    return posthog
}
