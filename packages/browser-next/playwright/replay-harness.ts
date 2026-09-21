import type { Extension, PostHog, PostHogOptions, ReplayOptions, SessionContext } from '@posthog/browser'

type RecordedSnapshot = {
    event: string
    uuid: string
    timestamp: string
    properties: {
        distinct_id: string
        $session_id: string
        $window_id: string
        $snapshot_data: Array<{ type: number; timestamp: number; data: unknown }>
    }
}
interface ReplayHarness {
    initialize(options?: {
        enabled?: boolean
        denied?: boolean
        disabled?: boolean
        persistent?: boolean
        minimumDurationMs?: number
        reentrantStop?: 'mutate' | 'deny'
        replayOptions?: ReplayOptions
    }): Promise<void>
    ready(): boolean
    session(): SessionContext | undefined
    distinctId(): string | undefined
    identify(id: string): Promise<void>
    reset(): void
    optOut(): void
    optIn(): void
    flush(): Promise<void>
    shutdown(): Promise<void>
    snapshots(): RecordedSnapshot[]
    requests(): string[]
    handoffs(): number
    stopCallbacks(): number
    capturedEvents(): string[]
    playback(): Promise<string>
}

declare global {
    interface Window {
        replayHarness: ReplayHarness
    }
}

export const installReplayHarness = (
    create: (options: PostHogOptions) => Promise<PostHog>,
    staticReplay?: (options: ReplayOptions) => Extension
): void => {
    let client: PostHog | undefined
    const snapshots: RecordedSnapshot[] = []
    const requests: string[] = []
    let handoffs = 0
    let stopCallbacks = 0
    const capturedEvents: string[] = []
    const decode = async (body: Blob) => {
        const bytes = new Uint8Array(await body.arrayBuffer())
        const text =
            bytes[0] === 31 && bytes[1] === 139
                ? await new Response(body.stream().pipeThrough(new DecompressionStream('gzip'))).text()
                : await body.text()
        return JSON.parse(text) as RecordedSnapshot[]
    }
    window.replayHarness = {
        async initialize(options = {}) {
            await client?.shutdown(0)
            snapshots.length = 0
            requests.length = 0
            handoffs = 0
            stopCallbacks = 0
            capturedEvents.length = 0
            const replayOptions: ReplayOptions = {
                compressEvents: false,
                ...options.replayOptions,
                ...(options.reentrantStop
                    ? {
                          maskAttributeFn: (_name: string, value: string) => {
                              if (value.includes('.deferred-tail')) {
                                  stopCallbacks++
                                  client?.capture('reentrant-stop')
                                  void client?.identify('reentrant-stop')
                                  client?.reset()
                                  void client?.shutdown(100)
                                  if (options.reentrantStop === 'deny') {
                                      client?.optOut()
                                      client?.optIn()
                                  }
                              }
                              return value
                          },
                      }
                    : {}),
            }
            client = await create({
                projectToken: 'ph_replay_browser_test',
                apiHost: location.origin,
                ...(options.persistent ? {} : { storage: false as const }),
                navigator: {
                    sendBeacon: (_url, data) => {
                        handoffs++
                        void decode(data as Blob).then((batch) => snapshots.push(...batch))
                        return true
                    },
                },
                disableBotDetection: true,
                capturePageview: false,
                analytics: false,
                autocapture: false,
                flags: false,
                logs: false,
                surveys: false,
                replay: options.disabled ? false : replayOptions,
                ...(staticReplay ? { extensions: [staticReplay(replayOptions)] } : {}),
                optOutByDefault: options.denied ?? false,
                remoteConfig: {
                    supportedCompression: ['gzip-js'],
                    toolbarParams: {},
                    toolbarVersion: 'toolbar',
                    isAuthenticated: false,
                    siteApps: [],
                    sessionRecording:
                        options.enabled === false
                            ? false
                            : { sampleRate: '1', minimumDurationMilliseconds: options.minimumDurationMs ?? 0 },
                },
                fetch: async (url, init) => {
                    requests.push(String(url))
                    if (init?.body instanceof Blob) snapshots.push(...(await decode(init.body)))
                    return new Response('{}')
                },
            })
            client.onEvent((event) => capturedEvents.push(event.event))
        },
        ready: () => !!client?.session.sessionId,
        session: () => client?.session,
        distinctId: () => client?.distinctId,
        identify: async (id) => {
            await client?.identify(id)
        },
        reset: () => client?.reset(),
        optOut: () => client?.optOut(),
        optIn: () => client?.optIn(),
        flush: async () => {
            await client?.flush()
        },
        shutdown: async () => {
            await client?.shutdown(100)
        },
        snapshots: () => snapshots,
        requests: () => requests,
        handoffs: () => handoffs,
        stopCallbacks: () => stopCallbacks,
        capturedEvents: () => capturedEvents,
        async playback() {
            const { Replayer } = await import('@posthog/rrweb')
            const events = snapshots.flatMap((snapshot) => snapshot.properties.$snapshot_data)
            const root = document.createElement('div')
            document.body.appendChild(root)
            const replayer = new Replayer(events as ConstructorParameters<typeof Replayer>[0], { root })
            replayer.pause(Math.max(0, events.at(-1)!.timestamp - events[0]!.timestamp))
            const html = replayer.iframe.contentDocument?.documentElement.outerHTML ?? ''
            replayer.destroy()
            root.remove()
            return html
        },
    }
}
