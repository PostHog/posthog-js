import { analytics } from '../../../../browser-next/src/analytics'
import { createPostHog } from '../../../../browser-next/src'

import {
    type BehaviorAdapter,
    type BehaviorClient,
    type BehaviorSetup,
    type ControlledRuntime,
    createGeneratedIdNormalizer,
    type IdentityObservation,
    type RecordedEvent,
} from './harness'

const copyProperties = (properties: Readonly<Record<string, unknown>>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(properties)) as Record<string, unknown>

export const browserNextAdapter: BehaviorAdapter = {
    name: 'browser-next',
    async create(runtime: ControlledRuntime, setup: BehaviorSetup = {}): Promise<BehaviorClient> {
        const capturedEvents: RecordedEvent[] = []
        const analyticsExtension = analytics()
        const posthog = await createPostHog({
            projectToken: runtime.projectToken,
            storage: localStorage,
            navigator: runtime.navigator,
            fetch: runtime.fetch,
            capturePageview: false,
            optOutByDefault: setup.optOutByDefault,
            extensions: [analyticsExtension],
        })
        let deliveryReady: Promise<unknown> | undefined = posthog.getExtension('analytics')
            ? Promise.resolve()
            : undefined
        const ids = createGeneratedIdNormalizer()
        ids.remember('anonymous', posthog.anonymousId)
        ids.remember('session', posthog.session.sessionId)
        ids.remember('window', posthog.session.windowId)
        const subscription = posthog.onEvent((event) => {
            capturedEvents.push({ event: event.event, properties: copyProperties(event.properties) })
        })

        const rememberCurrentState = (): void => {
            ids.remember('anonymous', posthog.anonymousId)
            ids.remember('session', posthog.session.sessionId)
            ids.remember('window', posthog.session.windowId)
        }

        return {
            async capture(event, properties): Promise<void> {
                await deliveryReady
                await posthog.capture(event, properties)
                await posthog.flush()
                rememberCurrentState()
            },
            async identify(distinctId, set, setOnce): Promise<void> {
                await deliveryReady
                await posthog.identify(distinctId, set, setOnce)
                await posthog.flush()
            },
            async group(type, key, properties): Promise<void> {
                await deliveryReady
                await posthog.group(type, key, properties)
                await posthog.flush()
            },
            reset(): void {
                posthog.reset()
                rememberCurrentState()
            },
            optIn() {
                posthog.optIn()
                deliveryReady ??= posthog.installExtension(analyticsExtension)
            },
            optOut: () => posthog.optOut(),
            hasOptedOut: () => posthog.hasOptedOut(),
            identity(): IdentityObservation {
                rememberCurrentState()
                return {
                    anonymousId: ids.normalize(posthog.anonymousId, 'anonymous') as string,
                    distinctId: ids.normalize(posthog.distinctId, 'anonymous') as string,
                    isIdentified: posthog.distinctId !== posthog.anonymousId,
                }
            },
            groups(): Readonly<Record<string, string>> {
                return posthog.groups
            },
            events(): readonly RecordedEvent[] {
                return capturedEvents.map((event) => ({
                    event: event.event,
                    properties: copyProperties(event.properties),
                }))
            },
            requests: () => runtime.requests(),
            normalizeId: ids.normalize,
            async dispose(): Promise<void> {
                subscription.dispose()
                await posthog.dispose()
            },
        }
    },
}
