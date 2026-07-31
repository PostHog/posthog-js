/* eslint-disable compat/compat */
import type { Logger } from '@posthog/core'

import type { Client } from '../src/client'
import type { Extension } from '../src/extension'
import { ExtensionRuntime } from '../src/extension-runtime'
import { createTestClient } from './helpers/test-client'

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
    dispose: (() => void) | undefined = jest.fn()
): Extension {
    return { name, setup, dispose }
}

function createRuntime(): {
    runtime: ExtensionRuntime
    client: Client
    add: (extension: Extension) => Promise<void>
} {
    const client = createTestClient()
    const runtime = new ExtensionRuntime(logger, client)
    const add = (extension: Extension): Promise<void> => runtime.add(extension)
    return { runtime, client, add }
}

describe('ExtensionRuntime', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('passes the client adapter and reserves names while setup is pending', async () => {
        const { add, client } = createRuntime()
        let receivedClient: Client | undefined
        let resolveSetup: (() => void) | undefined
        const registration = add(
            testExtension(
                'pending',
                (value) =>
                    new Promise<void>((resolve) => {
                        receivedClient = value
                        resolveSetup = resolve
                    })
            )
        )

        expect(receivedClient).toBe(client)
        await expect(add(testExtension('pending'))).rejects.toThrow('already registered')

        resolveSetup?.()
        await registration
    })

    it.each([
        {
            label: 'synchronous',
            setup: () => {
                throw new Error('setup failed')
            },
        },
        { label: 'asynchronous', setup: () => Promise.reject(new Error('setup failed')) },
    ])('releases names and cleans up after $label setup failure', async ({ setup }) => {
        const { add } = createRuntime()
        const dispose = jest.fn()

        await add(testExtension('failed', setup, dispose))

        expect(dispose).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalledWith('Failed to set up browser extension "failed"', expect.any(Error))

        await expect(add(testExtension('failed'))).resolves.toBeUndefined()
    })

    it.each(['resolve', 'reject'] as const)('cleans pending setup immediately after late %s', async (outcome) => {
        const { runtime, add } = createRuntime()
        let settle: (() => void) | undefined
        const dispose = jest.fn()
        const registration = add(
            testExtension(
                'pending',
                () =>
                    new Promise<void>((resolve, reject) => {
                        settle = () => (outcome === 'resolve' ? resolve() : reject(new Error('late failure')))
                    }),
                dispose
            )
        )

        runtime.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)

        settle?.()
        await registration
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    it('disposes extensions in reverse registration order', async () => {
        const { runtime, add } = createRuntime()
        let patched = 'host'
        const wrappingExtension = (name: string): Extension => {
            let previous = patched
            return testExtension(
                name,
                () => {
                    previous = patched
                    patched = `${name}(${patched})`
                },
                () => {
                    patched = previous
                }
            )
        }

        await add(wrappingExtension('first'))
        await add(wrappingExtension('second'))
        expect(patched).toBe('second(first(host))')

        runtime.dispose()

        expect(patched).toBe('host')
    })

    it('logs rejected asynchronous cleanup without waiting for it', async () => {
        const { runtime, add } = createRuntime()
        const error = new Error('async dispose failed')
        await add(
            testExtension('async', jest.fn(), async () => {
                throw error
            })
        )

        expect(() => runtime.dispose()).not.toThrow()
        await Promise.resolve()

        expect(logger.error).toHaveBeenCalledWith('Failed to dispose browser extension "async"', error)
    })

    it('isolates cleanup errors, cleans each extension once, and rejects later additions', async () => {
        const { runtime, add } = createRuntime()
        const successfulDispose = jest.fn()
        await add(
            testExtension('failing', jest.fn(), () => {
                throw new Error('dispose failed')
            })
        )
        await add(testExtension('successful', jest.fn(), successfulDispose))

        expect(() => runtime.dispose()).not.toThrow()
        runtime.dispose()

        expect(successfulDispose).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalledWith('Failed to dispose browser extension "failing"', expect.any(Error))
        await expect(add(testExtension('late'))).rejects.toThrow('disposed')
    })
})
