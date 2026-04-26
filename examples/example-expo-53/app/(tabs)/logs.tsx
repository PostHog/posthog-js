import { useState } from 'react'
import { Button, ScrollView, StyleSheet, View } from 'react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { posthog } from '../posthog'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export default function LogsScreen() {
    const [status, setStatus] = useState('Idle')
    const [counter, setCounter] = useState(0)

    const bump = (message: string) => {
        const next = counter + 1
        setCounter(next)
        setStatus(`${message} (#${next} @ ${new Date().toISOString().slice(11, 19)})`)
    }

    const sendOne = (level: LogLevel) => {
        posthog.logger[level](`${level} log from example-expo-53`, {
            source: 'logs-tab',
            level,
            tsClient: Date.now(),
        })
        bump(`Sent ${level}`)
    }

    const sendAllLevels = () => {
        const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
        levels.forEach((level, i) => {
            posthog.logger[level](`Level-sweep message (${level}) #${i}`, { sweep: true, index: i })
        })
        bump(`Sent all 6 levels`)
    }

    const sendStructured = () => {
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

    const sendBurst = () => {
        for (let i = 0; i < 20; i++) {
            posthog.logger[i % 2 === 0 ? 'info' : 'debug'](`Burst log #${i}`, { i })
        }
        bump('Sent 20-burst')
    }

    const sendFlood = () => {
        // Hit the rate-cap window (default 500/10s on RN). Should emit
        // 500-ish and then warn + drop.
        for (let i = 0; i < 600; i++) {
            posthog.logger.info(`Flood #${i}`, { i, flood: true })
        }
        bump('Sent 600-flood (expect rate cap)')
    }

    const sendError = () => {
        posthog.logger.error('Simulated error with stack', {
            errorName: 'SimulatedError',
            errorMessage: 'Something bad happened',
            stack: new Error('Simulated').stack ?? '',
        })
        bump('Sent error+stack')
    }

    const flushNow = async () => {
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
    },
})
