/* eslint-disable compat/compat */
import type { Logger } from '@posthog/core'

import type { Client } from '../src/client'
import type { Extension } from '../src/extension'
import { ExtensionRuntime } from '../src/extension-runtime'
import type { ExtensionToken } from '../src/token'
import { InMemoryKeyValueStore } from './helpers/test-client'

const logger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    critical: jest.fn(),
    createLogger: jest.fn(() => logger),
}

function testExtension(
    name: string,
    setup: (client: Client) => void | Promise<void> = jest.fn(),
    dispose: () => void | Promise<void> = jest.fn(),
    provides?: readonly ExtensionToken<unknown>[]
): Extension {
    return { name, provides, setup, dispose }
}

function createRuntime(): {
    runtime: ExtensionRuntime
    add: (extension: Extension) => Promise<void>
    clientNames: string[]
} {
    const clientNames: string[] = []
    const runtime = new ExtensionRuntime(logger)
    const add = (extension: Extension): Promise<void> => {
        clientNames.push(extension.name)
        return runtime.add(extension, {
            apiRequest: async () => ({ statusCode: 200 }),
            getExtension: (token) => runtime.getExtension(token),
            kv: new InMemoryKeyValueStore(),
            logger,
        })
    }
    return { runtime, add, clientNames }
}

describe('ExtensionRuntime', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('publishes synchronous providers immediately using a client scoped to the extension', async () => {
        interface Capability {
            value: string
        }
        const token = 'posthog.test.sync' as ExtensionToken<Capability>
        const equivalentToken = 'posthog.test.sync' as ExtensionToken<Capability>
        const { runtime, add, clientNames } = createRuntime()
        let dependency: Capability | undefined
        const provider = testExtension('provider', jest.fn(), jest.fn(), [token]) as Extension & Capability
        provider.value = 'ready'

        const registration = add(provider)
        add(
            testExtension('dependent', (client) => {
                dependency = client.getExtension(equivalentToken)
            })
        )

        expect(runtime.getExtension(equivalentToken)).toBe(provider)
        expect(dependency).toBe(provider)
        expect(clientNames).toEqual(['provider', 'dependent'])
        await registration
        await runtime.dispose()
    })

    it('reserves asynchronous providers until setup succeeds and releases failed registrations', async () => {
        interface Capability {
            value: string
        }
        const token = 'posthog.test.async' as ExtensionToken<Capability>
        const equivalentToken = 'posthog.test.async' as ExtensionToken<Capability>
        const failedToken = 'posthog.test.failed' as ExtensionToken<Capability>
        const { runtime, add } = createRuntime()
        let resolveSetup: (() => void) | undefined
        const provider = testExtension(
            'provider',
            () => new Promise<void>((resolve) => (resolveSetup = resolve)),
            jest.fn(),
            [token]
        )

        const registration = add(provider)
        expect(runtime.getExtension(equivalentToken)).toBeUndefined()
        expect(() => add(testExtension('collision', jest.fn(), jest.fn(), [equivalentToken]))).toThrow(
            'token "posthog.test.async" is already registered'
        )

        resolveSetup?.()
        await registration
        expect(runtime.getExtension(equivalentToken)).toBe(provider)

        const failed = testExtension('failed', () => Promise.reject(new Error('setup failed')), jest.fn(), [
            failedToken,
        ])
        await add(failed)
        expect(runtime.getExtension(failedToken)).toBeUndefined()
        expect(failed.dispose).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalledWith('Failed to set up browser extension "failed"', expect.any(Error))

        const replacement = testExtension('failed', jest.fn(), jest.fn(), [failedToken])
        await add(replacement)
        expect(runtime.getExtension(failedToken)).toBe(replacement)
        await runtime.dispose()
    })

    it('cleans up synchronous setup failures and never publishes providers after disposal begins', async () => {
        const thrownToken = 'posthog.test.thrown' as ExtensionToken<Extension>
        const lateToken = 'posthog.test.late' as ExtensionToken<Extension>
        const { runtime, add } = createRuntime()
        const thrownDispose = jest.fn()

        await add(
            testExtension(
                'throws-synchronously',
                () => {
                    throw new Error('sync setup failure')
                },
                thrownDispose,
                [thrownToken]
            )
        )
        expect(runtime.getExtension(thrownToken)).toBeUndefined()
        expect(thrownDispose).toHaveBeenCalledTimes(1)

        let resolveLateSetup: (() => void) | undefined
        const late = testExtension(
            'late',
            () => new Promise<void>((resolve) => (resolveLateSetup = resolve)),
            jest.fn(),
            [lateToken]
        )
        const lateRegistration = add(late)
        const disposal = runtime.dispose()
        resolveLateSetup?.()

        await Promise.all([lateRegistration, disposal])
        expect(runtime.getExtension(lateToken)).toBeUndefined()
        expect(late.dispose).toHaveBeenCalledTimes(1)
    })

    it('rejects duplicate extension names and capability tokens', async () => {
        const token = 'posthog.test.shared' as ExtensionToken<unknown>
        const equivalentToken = 'posthog.test.shared' as ExtensionToken<unknown>
        const { runtime, add } = createRuntime()
        add(testExtension('first', jest.fn(), jest.fn(), [token]))

        expect(() => add(testExtension('first'))).toThrow('already registered')
        expect(() => add(testExtension('second', jest.fn(), jest.fn(), [equivalentToken]))).toThrow(
            'token "posthog.test.shared" is already registered'
        )
        await runtime.dispose()
    })

    it('coordinates setup failure with concurrent reverse-order disposal exactly once', async () => {
        const order: string[] = []
        const { runtime, add } = createRuntime()
        let rejectSetup: ((error: Error) => void) | undefined
        let resolveFailedDisposal: (() => void) | undefined
        const failedDispose = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    order.push('failed')
                    resolveFailedDisposal = resolve
                })
        )

        add(testExtension('first', jest.fn(), () => order.push('first')))
        add(
            testExtension(
                'failed',
                () => new Promise<void>((_resolve, reject) => (rejectSetup = reject)),
                failedDispose
            )
        )

        const firstDisposal = runtime.dispose()
        const secondDisposal = runtime.dispose()
        expect(firstDisposal).toBe(secondDisposal)
        rejectSetup?.(new Error('setup failed'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(failedDispose).toHaveBeenCalledTimes(1)
        resolveFailedDisposal?.()

        await Promise.all([firstDisposal, secondDisposal])
        expect(order).toEqual(['failed', 'first'])
        expect(failedDispose).toHaveBeenCalledTimes(1)
        expect(() => add(testExtension('late'))).toThrow('disposed')
    })
})
