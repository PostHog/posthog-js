import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import PostHog from 'posthog-react-native'

// Counting storage: every setItem is one disk write. We track the count and the
// bytes serialized so the screen can show what a burst of captures actually
// costs at the storage layer.
let writeCount = 0
let totalBytes = 0
const cache: Record<string, string> = {}
const countingStorage = {
    getItem: (key: string) => cache[key] ?? null,
    setItem: (key: string, value: string) => {
        writeCount += 1
        totalBytes += value.length
        cache[key] = value
    },
}

// Dedicated instance for this demo. flushAt is set high so a burst stays in one
// batch and we observe storage *write coalescing* rather than a flush-per-capture.
// (The main app instance in app/posthog.tsx uses flushAt: 1, which drains storage
// on every capture and would hide the effect.)
const burstPostHog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY ?? 'phc_storage_burst_demo', {
    host: process.env.EXPO_PUBLIC_POSTHOG_API_HOST,
    flushAt: 1000,
    captureAppLifecycleEvents: false,
    customStorage: countingStorage,
})

const BURST_SIZE = 100

export default function StorageBurstScreen() {
    const [result, setResult] = useState<{ writes: number; kb: string } | null>(null)
    const [running, setRunning] = useState(false)

    const fireBurst = async (): Promise<void> => {
        setRunning(true)
        setResult(null)
        const beforeWrites = writeCount
        const beforeBytes = totalBytes

        for (let i = 0; i < BURST_SIZE; i++) {
            burstPostHog.capture('storage_burst_event', { index: i })
        }

        // Writes are debounced, so the coalesced write lands on a later tick.
        // Wait past the window before reading the counters.
        await new Promise((resolve) => setTimeout(resolve, 300))

        setResult({
            writes: writeCount - beforeWrites,
            kb: ((totalBytes - beforeBytes) / 1024).toFixed(1),
        })
        setRunning(false)
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.title}>Storage write coalescing</Text>
            <Text style={styles.body}>
                Fires {BURST_SIZE} captures in a tight loop and counts the disk writes the SDK performs. With
                debounced coalescing, the burst collapses into a single write instead of one per capture.
            </Text>

            <Pressable
                style={[styles.button, running && styles.buttonDisabled]}
                onPress={fireBurst}
                disabled={running}
                testID="fire-burst"
            >
                <Text style={styles.buttonText}>{running ? 'Running…' : `Fire ${BURST_SIZE} events`}</Text>
            </Pressable>

            {result && (
                <View style={styles.result} testID="burst-result">
                    <Text style={styles.resultLine}>Captures fired: {BURST_SIZE}</Text>
                    <Text style={styles.resultBig}>Disk writes: {result.writes}</Text>
                    <Text style={styles.resultLine}>Bytes serialized: {result.kb} KB</Text>
                    <Text style={styles.resultHint}>Without coalescing this would be {BURST_SIZE} writes.</Text>
                </View>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { padding: 24, paddingTop: 80, gap: 16 },
    title: { fontSize: 22, fontWeight: '700' },
    body: { fontSize: 15, lineHeight: 21, opacity: 0.8 },
    button: { backgroundColor: '#1d4aff', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center' },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    result: { gap: 6, padding: 16, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.12)' },
    resultLine: { fontSize: 15 },
    resultBig: { fontSize: 24, fontWeight: '700', color: '#1d4aff' },
    resultHint: { fontSize: 13, opacity: 0.7, marginTop: 4 },
})
