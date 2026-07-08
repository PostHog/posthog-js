import { useEffect, useState } from 'react'
import { AppState, Button, ScrollView, StyleSheet, View } from 'react-native'
import { PostHogPersistedProperty } from 'posthog-react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { beforeSendMode, posthog } from '../posthog'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type BeforeSendMode = 'pass' | 'drop' | 'throw'

interface DevStatus {
    distinctId: string | null
    sessionId: string | null
    appState: 'foreground' | 'background' | null
}

export default function LogsScreen() {
    const [status, setStatus] = useState('Idle')
    const [counter, setCounter] = useState(0)
    const [devStatus, setDevStatus] = useState<DevStatus>({
        distinctId: null,
        sessionId: null,
        appState: null,
    })
    // Mirror of `beforeSendMode.current` for UI display. The actual filter
    // reads from the module-level ref in posthog.tsx.
    const [beforeSendModeUI, setBeforeSendModeUI] = useState<BeforeSendMode>(beforeSendMode.current)
    const [queueDump, setQueueDump] = useState<string>('')

    const refresh = (): void => {
        setDevStatus({
            distinctId: posthog.getDistinctId() || null,
            sessionId: posthog.getSessionId() || null,
            appState: ((posthog as any)._currentAppState ?? null) as DevStatus['appState'],
        })
    }

    // Emit a log on every AppState transition so the SDK's `app.state`
    // tagging path can be exercised without manual taps. The PostHog
    // constructor registers its own AppState listener first, which updates
    // `_currentAppState` synchronously *before* this hook's body runs, so
    // the captured record reads the new state.
    useEffect(() => {
        let prev: string = AppState.currentState
        const sub = AppState.addEventListener('change', (next) => {
            posthog.logger.info(`AppState ${prev} → ${next}`, { from: prev, to: next })
            prev = next
            refresh()
        })
        refresh()
        return () => sub.remove()
    }, [])

    const bump = (message: string): void => {
        const next = counter + 1
        setCounter(next)
        setStatus(`${message} (#${next} @ ${new Date().toISOString().slice(11, 19)})`)
    }

    // ===== Existing capture buttons =====

    const sendOne = (level: LogLevel): void => {
        posthog.logger[level](`${level} log from example-expo-53`, {
            source: 'logs-tab',
            level,
            tsClient: Date.now(),
        })
        bump(`Sent ${level}`)
    }

    const sendAllLevels = (): void => {
        const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
        levels.forEach((level, i) => {
            posthog.logger[level](`Level-sweep message (${level}) #${i}`, { sweep: true, index: i })
        })
        bump(`Sent all 6 levels`)
    }

    const sendStructured = (): void => {
        posthog.captureLog({
            body: 'Structured attributes payload',
            level: 'info',
            attributes: {
                userId: 'user-42',
                feature: 'checkout',
                durationMs: 123,
                tags: ['beta', 'ios'],
                nested: { foo: 'bar', count: 3 },
            },
        })
        bump('Sent structured attrs')
    }

    const sendBurst = (): void => {
        for (let i = 0; i < 20; i++) {
            posthog.logger[i % 2 === 0 ? 'info' : 'debug'](`Burst log #${i}`, { i })
        }
        bump('Sent 20-burst')
    }

    const sendFlood = (): void => {
        // Hit the rate-cap window (default 500/10s on RN). Should emit
        // 500-ish and then warn + drop.
        for (let i = 0; i < 600; i++) {
            posthog.logger.info(`Flood #${i}`, { i, flood: true })
        }
        bump('Sent 600-flood (expect rate cap)')
    }

    const sendError = (): void => {
        posthog.logger.error('Simulated error with stack', {
            errorName: 'SimulatedError',
            errorMessage: 'Something bad happened',
            stack: new Error('Simulated').stack ?? '',
        })
        bump('Sent error+stack')
    }

    const flushNow = async (): Promise<void> => {
        try {
            // Drain BOTH pipelines — events on `flush()`, logs on `flushLogs()`.
            // Run in parallel so a slow events flush doesn't delay logs and
            // vice-versa.
            await Promise.all([posthog.flush(), posthog.flushLogs()])
            bump('Manual flush ok')
        } catch (e) {
            setStatus(`Flush error: ${e}`)
        }
    }

    // ===== Dev tools =====
    //
    // Status reads `_currentAppState` via a reach-in because there's no
    // public getter for the SDK's cached AppState. Reach-ins like this are
    // ONLY appropriate in dogfood-style examples; production wrappers
    // should stick to the public surface (`captureLog`, `logger.*`,
    // `flushLogs`).

    const setBefore = (mode: BeforeSendMode): void => {
        // Update the shared ref in posthog.tsx — the `beforeSend` closure
        // reads it on every capture, so behavior switches at runtime
        // without touching SDK internals. This is the public-API-only
        // pattern customers should follow for runtime-tunable filters.
        beforeSendMode.current = mode
        setBeforeSendModeUI(mode)
        bump(`beforeSend = ${mode}`)
    }

    const captureNoLevel = (): void => {
        // Verifies default-level INFO behaviour without a `level` arg.
        posthog.captureLog({ body: 'no-level test (defaults to INFO)' })
        bump('Sent no-level (default INFO)')
    }

    const captureEmptyBody = (): void => {
        posthog.captureLog({ body: '' })
        bump('Sent empty body (should be silently dropped)')
    }

    const captureNoBody = (): void => {
        posthog.captureLog({} as any)
        bump('Sent no body (should be silently dropped)')
    }

    const dumpQueue = (): void => {
        const queue = posthog.getPersistedProperty(PostHogPersistedProperty.LogsQueue) as unknown[] | undefined
        const text = queue
            ? `length=${queue.length}\n${JSON.stringify(queue, null, 2).slice(0, 4000)}`
            : '(empty/undefined)'
        setQueueDump(text)
    }

    const screenAndCapture = async (name: string): Promise<void> => {
        await posthog.screen(name)
        posthog.logger.info(`captured on ${name}`, { screenTagTest: true })
        bump(`screen('${name}') + capture`)
    }

    const callIdentify = (id: string): void => {
        posthog.identify(id, { source: 'logs-tab' })
        refresh()
        bump(`identify('${id}')`)
    }

    const callReset = (): void => {
        posthog.reset()
        refresh()
        bump('reset()')
    }

    const callOptOut = async (): Promise<void> => {
        await posthog.optOut()
        refresh()
        bump('optOut()')
    }

    const callOptIn = async (): Promise<void> => {
        await posthog.optIn()
        refresh()
        bump('optIn()')
    }

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#FFE6B3', dark: '#3D2E1D' }}
            headerImage={<IconSymbol size={310} color="#808080" name="text.bubble.fill" style={styles.headerImage} />}
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Logs</ThemedText>
            </ThemedView>
            <ThemedText>Status: {status}</ThemedText>
            <ScrollView style={styles.scroll}>
                <View style={styles.section}>
                    <ThemedText type="subtitle">Single level</ThemedText>
                    <View style={styles.row}>
                        <Button title="trace" onPress={() => sendOne('trace')} />
                        <Button title="debug" onPress={() => sendOne('debug')} />
                        <Button title="info" onPress={() => sendOne('info')} />
                    </View>
                    <View style={styles.row}>
                        <Button title="warn" onPress={() => sendOne('warn')} />
                        <Button title="error" onPress={() => sendOne('error')} />
                        <Button title="fatal" onPress={() => sendOne('fatal')} />
                    </View>
                </View>
                <View style={styles.section}>
                    <ThemedText type="subtitle">Mixed</ThemedText>
                    <Button title="All 6 levels" onPress={sendAllLevels} />
                    <Button title="Structured attributes" onPress={sendStructured} />
                    <Button title="Error + stack" onPress={sendError} />
                </View>
                <View style={styles.section}>
                    <ThemedText type="subtitle">Volume</ThemedText>
                    <Button title="Burst 20" onPress={sendBurst} />
                    <Button title="Flood 600 (rate cap)" onPress={sendFlood} />
                </View>
                <View style={styles.section}>
                    <ThemedText type="subtitle">Control</ThemedText>
                    <Button title="Flush now" onPress={flushNow} />
                </View>

                <View style={styles.divider} />
                <ThemedText type="subtitle">Dev tools</ThemedText>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">Status</ThemedText>
                    <ThemedText>distinctId: {devStatus.distinctId ?? '<none>'}</ThemedText>
                    <ThemedText>sessionId: {devStatus.sessionId ?? '<none>'}</ThemedText>
                    <ThemedText>app.state: {devStatus.appState ?? '<unknown>'}</ThemedText>
                    <ThemedText>beforeSend mode: {beforeSendModeUI}</ThemedText>
                    <Button title="Refresh status" onPress={refresh} />
                </View>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">Identity</ThemedText>
                    <View style={styles.row}>
                        <Button title="identify(alice)" onPress={() => callIdentify('alice')} />
                        <Button title="identify(bob)" onPress={() => callIdentify('bob')} />
                    </View>
                    <View style={styles.row}>
                        <Button title="reset()" onPress={callReset} />
                        <Button title="optOut()" onPress={callOptOut} />
                        <Button title="optIn()" onPress={callOptIn} />
                    </View>
                </View>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">Screen tagging</ThemedText>
                    <Button title="screen('Checkout') + capture" onPress={() => screenAndCapture('Checkout')} />
                    <Button title="screen('Profile') + capture" onPress={() => screenAndCapture('Profile')} />
                </View>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">Edge captures</ThemedText>
                    <Button title="captureLog (no level → INFO)" onPress={captureNoLevel} />
                    <Button title="captureLog (empty body)" onPress={captureEmptyBody} />
                    <Button title="captureLog (no body)" onPress={captureNoBody} />
                </View>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">beforeSend hook</ThemedText>
                    <View style={styles.row}>
                        <Button title="pass-through" onPress={() => setBefore('pass')} />
                        <Button title="drop (return null)" onPress={() => setBefore('drop')} />
                        <Button title="throw" onPress={() => setBefore('throw')} />
                    </View>
                </View>

                <View style={styles.section}>
                    <ThemedText type="defaultSemiBold">Storage</ThemedText>
                    <Button title="Dump LogsQueue" onPress={dumpQueue} />
                    <ScrollView style={styles.dump}>
                        <ThemedText>{queueDump || '(tap Dump to inspect)'}</ThemedText>
                    </ScrollView>
                </View>
            </ScrollView>
        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    headerImage: {
        color: '#808080',
        bottom: -90,
        left: -35,
        position: 'absolute',
    },
    titleContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    scroll: {
        marginTop: 12,
    },
    section: {
        marginBottom: 16,
        gap: 6,
    },
    row: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 6,
        flexWrap: 'wrap',
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(128,128,128,0.4)',
        marginVertical: 8,
    },
    dump: {
        marginTop: 6,
        maxHeight: 220,
        backgroundColor: 'rgba(0,0,0,0.05)',
        padding: 8,
    },
})
