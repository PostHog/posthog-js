import { isUndefined } from '@posthog/core'

import type { Client, RemoteConfigResult } from '../../src'

export interface ClientConformanceHost {
    readonly client: Client
    publishRemoteConfig(result: RemoteConfigResult): void | Promise<void>
    dispose(): void | Promise<void>
}

export type ClientConformanceHostFactory = () => ClientConformanceHost | Promise<ClientConformanceHost>

/** Run the shared extension-facing Client contract against one host implementation. */
export const runClientConformanceSuite = (hostName: string, createHost: ClientConformanceHostFactory): void => {
    describe(`${hostName} shared Client conformance`, () => {
        let host: ClientConformanceHost | undefined

        beforeEach(async () => {
            host = await createHost()
        })

        afterEach(async () => {
            await host?.dispose()
        })

        it('exposes identity, SDK metadata, groups, and session context', () => {
            const { client } = host!
            expect(client.distinctId).toEqual(expect.any(String))
            expect(client.anonymousId).toEqual(expect.any(String))
            expect(isUndefined(client.deviceId) || typeof client.deviceId === 'string').toBe(true)
            expect(client.library).toEqual({ name: expect.any(String), version: expect.any(String) })
            expect(client.initialPersonProperties).toEqual(expect.any(Object))
            expect(client.groups).toEqual(expect.any(Object))
            expect(client.session).toEqual({
                sessionId: expect.any(String),
                windowId: expect.any(String),
                sessionStartTimestamp: expect.any(Number),
            })
            expect(client.projectToken).toEqual(expect.any(String))
            expect(client.logger).toBeDefined()
        })

        it('provides initialized synchronous key-value operations', async () => {
            const { kv } = host!.client
            await kv.initialize()

            kv.set({ first: { value: 1 }, second: 'value' })
            expect(
                kv.get<{ first: { value: number }; second: string; missing: unknown }>(['first', 'missing', 'second'])
            ).toEqual({ first: { value: 1 }, second: 'value' })
            expect(kv.get('first')).toEqual({ value: 1 })

            kv.remove(['first', 'second'])
            expect(kv.get<{ first: unknown; second: unknown }>(['first', 'second'])).toEqual({})
        })

        it('captures dynamic properties and publishes finalized events', async () => {
            const events: Array<{ event: string; properties: Readonly<Record<string, unknown>> }> = []
            const subscription = host!.client.onEvent((event) => events.push(event))
            const registration = host!.client.registerDynamicEventProperties(() => ({ dynamic: 'yes' }))

            await host!.client.capture('conformance_event', { explicit: true })

            expect(events).toHaveLength(1)
            expect(events[0]).toMatchObject({
                event: 'conformance_event',
                properties: { dynamic: 'yes', explicit: true },
            })
            registration.dispose()
            subscription.dispose()
        })

        it('replays remote config to late listeners and publishes it to active listeners', async () => {
            const earlyResults: RemoteConfigResult[] = []
            const early = host!.client.onRemoteConfig((result) => earlyResults.push(result as RemoteConfigResult))
            const result = {
                ok: true,
                config: {
                    supportedCompression: [],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar',
                    isAuthenticated: false,
                    siteApps: [],
                },
            } as RemoteConfigResult

            await host!.publishRemoteConfig(result)

            const lateResults: RemoteConfigResult[] = []
            const late = host!.client.onRemoteConfig((value) => lateResults.push(value as RemoteConfigResult))
            expect(earlyResults.at(-1)).toEqual(result)
            expect(lateResults).toEqual([result])
            early.dispose()
            late.dispose()
        })

        it('sends through the host request capability', async () => {
            await expect(host!.client.sendRequest('/conformance/')).resolves.toMatchObject({
                statusCode: expect.any(Number),
            })
        })
    })
}
